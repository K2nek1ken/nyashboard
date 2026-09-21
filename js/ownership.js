// ============================================================
//  Что создал этот человек
//
//  Секреты владения (postSecrets/replySecrets/chatMessageSecrets) клиент
//  не читает — они нужны только правилам базы, чтобы разрешить правку
//  и удаление. А сайту, чтобы показать кнопки «изменить» и «удалить»,
//  нужно самому знать, что вещь твоя.
//
//  Раньше это знание жило только в браузере. Сменил устройство, вышел
//  и зашёл, почистил данные — и свои же записи и сообщения становились
//  «чужими»: кнопок нет, хотя удалить сервер разрешил бы.
//
//  Теперь отметка пишется ещё и в личный документ учётки — его читает
//  только сам человек, правило базы никого больше не пустит. Работает
//  и для гостевой учётки, пока она та же. В сами записи и сообщения,
//  открытые всем на чтение, ничего не пишется: анонимность не страдает.
// ============================================================

const KEYS = {
  post: "nyash_owned_posts",
  reply: "nyash_owned_replies",
  chatMessage: "nyash_owned_messages"
};

// Сколько помнить в личном документе. Больше незачем: давние сообщения
// давно пролистаны, а документ не должен расти бесконечно.
const KEEP = 500;

// Загруженное из личного документа: тип → набор идентификаторов.
let remote = null;
let remoteFor = null;       // для какой учётки загружено

function getSet(type) {
  try { return new Set(JSON.parse(localStorage.getItem(KEYS[type])) || []); }
  catch { return new Set(); }
}

function saveSet(type, set) {
  try { localStorage.setItem(KEYS[type], JSON.stringify([...set])); } catch {}
}

export function markOwned(type, id) {
  const set = getSet(type);
  set.add(id);
  saveSet(type, set);

  // И в личный документ — в фоне: отправка сообщения ждать этого не должна.
  rememberRemote(type, id).catch(() => {});
}

export function isOwned(type, id) {
  return getSet(type).has(id) || !!remote?.[type]?.has(id);
}

export function forgetOwned(type, id) {
  const set = getSet(type);
  set.delete(id);
  saveSet(type, set);

  remote?.[type]?.delete(id);
  forgetRemote(type, id).catch(() => {});
}

// ---------- личный документ ----------

async function ownedRef() {
  const { db, doc } = await import("./firebase.js");
  const { auth } = await import("./firebase.js");
  const uid = auth.currentUser?.uid;
  return uid ? { ref: doc(db, "users", uid, "settings", "owned"), uid } : null;
}

// Загружает список своего. Сообщает странице, когда готово, — чтобы
// кнопки у своих сообщений появились, не дожидаясь следующего обновления.
export async function loadOwnedRemote() {
  const target = await ownedRef();
  if (!target) return;
  if (remoteFor === target.uid && remote) return;

  try {
    const { getDoc } = await import("./firebase.js");
    const snap = await getDoc(target.ref);
    const data = snap.exists() ? snap.data() : {};

    remote = {};
    for (const type of Object.keys(KEYS)) remote[type] = new Set(data[type] || []);
    remoteFor = target.uid;

    window.dispatchEvent(new CustomEvent("nyash:owned"));
  } catch (e) {
    console.warn("Список своего не загрузился:", e.message);
  }
}

async function rememberRemote(type, id) {
  const target = await ownedRef();
  if (!target) return;

  const { setDoc, arrayUnion } = await import("./firebase.js");

  if (remote && remoteFor === target.uid) {
    remote[type].add(id);

    // Список уже загружен — пишем его целиком, обрезав до последних:
    // так документ не растёт бесконечно.
    const list = [...remote[type]].slice(-KEEP);
    remote[type] = new Set(list);
    await setDoc(target.ref, { [type]: list }, { merge: true });
  } else {
    // Ещё не загружен — просто дописываем.
    await setDoc(target.ref, { [type]: arrayUnion(id) }, { merge: true });
  }
}

async function forgetRemote(type, id) {
  const target = await ownedRef();
  if (!target) return;
  const { setDoc, arrayRemove } = await import("./firebase.js");
  await setDoc(target.ref, { [type]: arrayRemove(id) }, { merge: true });
}

// Другая учётка — другой список.
export function resetOwnedRemote() {
  remote = null;
  remoteFor = null;
}
