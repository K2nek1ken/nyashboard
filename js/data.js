import {
  db, doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where,
  writeBatch, limit
} from "./firebase.js";

// ================== NUID ==================
// Логика вынесена в nuid.js: идентификатор хранится отдельно от профиля,
// чтобы настройка приватности работала на уровне базы, а не интерфейса.
// ================== Реестр юзернеймов (общий для users и channels) ==================
// Документ usernames/{имя в нижнем регистре} — атомарная уникальность гарантируется
// самим правилом Firestore (allow create только если ещё не существует), но для
// нормального UX (сказать "занято" ДО отправки формы) есть и клиентская проверка.
export async function isUsernameTaken(username) {
  const snap = await getDoc(doc(db, "usernames", username.toLowerCase()));
  return snap.exists();
}

export async function reserveUsername(username, type, ownerId) {
  await setDoc(doc(db, "usernames", username.toLowerCase()), { type, ownerId });
}

// ================== Пользователи ==================
export async function ensureUserDoc(fbUser) {
  const ref = doc(db, "users", fbUser.uid);

  // Чтение профиля вынесено в отдельную попытку: если падает именно оно,
  // причина почти всегда одна — правила базы не залиты или залиты старые.
  // Сообщение об этом должно быть внятным, а не «профиль не загрузился».
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (e) {
    throw new Error(`не удалось прочитать профиль (${e.code || e.message}). ` +
                    `Скорее всего, правила Firestore не задеплоены`);
  }

  if (snap.exists()) {
    const data = snap.data();
    // аккаунты, созданные до отдельного хранилища NUID, переносим на лету
    if (data.publicUid) migrateLegacyNuid(data);
    else ensureNuidExists(fbUser.uid);   // NUID мог не записаться при регистрации
    return data;
  }

  let username = "user_" + fbUser.uid.slice(0, 6);
  // на случай маловероятного совпадения дефолтного юзернейма — дописываем хвост.
  // Проверка не должна мешать созданию аккаунта: если реестр недоступен,
  // просто берём имя как есть.
  try {
    let guard = 0;
    while (await isUsernameTaken(username) && guard++ < 5) {
      username = "user_" + Math.random().toString(36).slice(2, 8);
    }
  } catch (e) {
    console.warn("Реестр юзернеймов недоступен:", e.message);
  }

  const base = {
    uid: fbUser.uid,
    username,
    nickname: fbUser.displayName || "Новый неко",
    avatarUrl: fbUser.photoURL || "",
    avatarShape: "circle",   // форма применяетсяCSS-ом поверх, фото хранится необрезанным
    bio: "",
    statusEmoji: "",
    nuidVisibility: "friends",     // everyone | friends | nobody
    repostVisibility: "everyone",  // кто видит меня автором в репостах
    gender: "x",                   // m | f | x — родовые окончания в интерфейсе

    createdAt: Date.now()
  };

  // ПОРЯДОК ВАЖЕН: сам профиль создаётся первым и отдельно от всего остального.
  // Раньше сначала подбирался NUID, и его неудача (например, при незалитых
  // правилах) означала, что документ users/{uid} не появлялся вообще — а потом
  // любое сохранение профиля падало с «No document to update».
  try {
    await setDoc(ref, base);
  } catch (e) {
    throw new Error(`не удалось создать профиль (${e.code || e.message}). ` +
                    `Проверь, что правила Firestore задеплоены`);
  }

  // Бронь юзернейма — уже не критично: без неё профиль просто останется с
  // именем по умолчанию, но работать будет.
  await setDoc(doc(db, "usernames", username.toLowerCase()),
               { type: "user", ownerId: fbUser.uid })
    .catch(e => console.warn("Юзернейм не забронирован:", e.message));

  // NUID — тоже отдельно и необязательно, допишется при следующем входе
  const nuid = await generateUniqueNuid(1);
  await registerNuid(fbUser.uid, nuid, "user").catch(e => {
    console.warn("NUID не записался (проверь правила firestore):", e.message);
  });
  return base;
}

export async function getUserDoc(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// setDoc с merge, а не updateDoc: у аккаунтов, созданных до исправления выше,
// документа могло не быть вовсе, и обновление падало с «No document to update».
// Так профиль сам восстановится при первом же сохранении.
export async function updateUserDoc(uid, patch) {
  // undefined в любом поле Firestore не принимает и падает с невнятной
  // ошибкой — вычищаем заранее (например, если загрузка картинки вернула пусто)
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([, v]) => v !== undefined)
  );
  try {
    await setDoc(doc(db, "users", uid), clean, { merge: true });
  } catch (e) {
    throw new Error(`${e.code || e.message}. Если это про доступ — проверь, ` +
                    `что правила Firestore задеплоены`);
  }
}

// Смена юзернейма — старая бронь освобождается, новая занимается, само поле в
// users/{uid} обновляется — всё одним батчем, чтобы не было промежуточного
// рассинхрона (звучит как оверинжиниринг, но реестр — это как раз тот случай,
// где рассинхрон означает "юзернейм навсегда потерян и никому не принадлежит").
export async function changeUsername(uid, oldUsername, newUsername, ownerType = "user") {
  const batch = writeBatch(db);
  if (oldUsername) batch.delete(doc(db, "usernames", oldUsername.toLowerCase()));
  batch.set(doc(db, "usernames", newUsername.toLowerCase()), { type: ownerType, ownerId: uid });
  if (ownerType === "user") {
    batch.update(doc(db, "users", uid), { username: newUsername });
  } else {
    batch.update(doc(db, "channels", uid), { username: newUsername });
  }
  await batch.commit();
}

// Универсальный резолвер @хэндла (юзер ИЛИ канал) — нужен для кликабельных
// упоминаний в тексте постов/ответов/чата.
export async function resolveHandle(handle) {
  const clean = handle.trim().replace(/^@/, "");
  const snap = await getDoc(doc(db, "usernames", clean.toLowerCase()));
  if (!snap.exists()) return null;
  return { type: snap.data().type, ownerId: snap.data().ownerId };
}

// Найти FUID пользователя по его @юзернейму или NUID — нужно для упоминаний (@ник)
// и для назначения админов канала "по юзернейму или UID".
export async function resolveUserHandle(handle) {
  const clean = handle.trim().replace(/^@/, "");
  if (/^U1\d{6}$/i.test(clean)) {
    const { resolveNuid } = await import("./nuid.js");
    const hit = await resolveNuid(clean);
    if (!hit) return null;
    const userSnap = await getDoc(doc(db, "users", hit.uid));
    return userSnap.exists() ? { uid: hit.uid, ...userSnap.data() } : null;
  }
  const unameSnap = await getDoc(doc(db, "usernames", clean.toLowerCase()));
  if (!unameSnap.exists() || unameSnap.data().type !== "user") return null;
  const uid = unameSnap.data().ownerId;
  const userSnap = await getDoc(doc(db, "users", uid));
  return userSnap.exists() ? { uid, ...userSnap.data() } : null;
}

// Лимит обязателен: без него вкладка «Люди» вычитывала бы вообще всех
// пользователей при каждом заходе — это прямой путь спалить бесплатный лимит
// чтений Firestore, как только людей станет больше пары десятков.
export async function listAllUsers(max = 200) {
  const snap = await getDocs(query(collection(db, "users"), limit(max)));
  return snap.docs.map(d => d.data());
}
