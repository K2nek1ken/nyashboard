import {
  db, auth, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, orderBy, limit, where, writeBatch, serverTimestamp
} from "./firebase.js";
import { currentUser } from "./auth.js";
import { resolveUserHandle } from "./data.js";
import { generateUniqueNuid } from "./nuid.js";
import { markOwned } from "./ownership.js";
import { addSubscription, removeSubscription } from "./subscriptions.js";

// ================== Создание канала ==================
// Требует настоящий (не анонимный) аккаунт — иначе некому будет потом управлять
// каналом. Сам документ /channels/{id} при этом НЕ содержит creatorUid вообще —
// связь "ты создатель" живёт только в channelSecrets, который никто, кроме тебя,
// прочитать не может (см. firestore.rules). Это и есть настоящая анонимность
// создателя, а не просто "спрятано в интерфейсе".
export async function createChannel(name, description, avatarUrl = null) {
  if (!currentUser) throw new Error("Нужен аккаунт, чтобы создать канал");

  const nuid = await generateUniqueNuid(4);
  let handle = "ch_" + Math.random().toString(36).slice(2, 8);
  while (await getDoc(doc(db, "usernames", handle.toLowerCase())).then(s => s.exists())) {
    handle = "ch_" + Math.random().toString(36).slice(2, 8);
  }

  const channelRef = doc(collection(db, "channels")); // предгенерируем id
  const batch = writeBatch(db);
  batch.set(channelRef, {
    publicUid: nuid,
    username: handle,
    name: name.trim(),
    description: (description || "").trim(),
    avatarUrl: avatarUrl || null,
    avatarShape: "circle",   // как у профилей: форма задаётся, а не жёстко квадрат
    adminUids: [],
    adminSince: {},          // когда каждый управляющий получил доступ
    createdAt: serverTimestamp()
  });
  batch.set(doc(db, "channelSecrets", channelRef.id), { creatorUid: currentUser.uid });
  batch.set(doc(db, "usernames", handle.toLowerCase()), { type: "channel", ownerId: channelRef.id });
  await batch.commit();
  // У каналов идентификатор публичный (он и так виден на странице канала),
  // поэтому в защищённое хранилище его класть не нужно — только в индекс,
  // чтобы работал поиск по U4xxxxxx.
  await setDoc(doc(db, "nuidIndex", nuid), { uid: channelRef.id, type: "channel" }).catch(() => {});
  return channelRef.id;
}

export async function getChannel(channelId) {
  const snap = await getDoc(doc(db, "channels", channelId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Единственный способ узнать "я ли создатель" — попробовать прочитать channelSecrets
// напрямую. Правило разрешает это только если request.auth.uid === creatorUid, так что
// успех/отказ чтения и есть ответ на вопрос (данные секрета в клиент даже не попадают
// при отказе — просто ошибка permission-denied).
export async function isChannelCreator(channelId) {
  if (!currentUser) return false;
  try {
    const snap = await getDoc(doc(db, "channelSecrets", channelId));
    return snap.exists() && snap.data().creatorUid === currentUser.uid;
  } catch {
    return false;
  }
}

export async function listChannels() {
  const q = query(collection(db, "channels"), orderBy("createdAt", "desc"), limit(200));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Только создатель может это делать — проверяется правилом Firestore через
// channelSecrets, тут просто отправляем запрос.
export async function updateChannel(channelId, patch) {
  await updateDoc(doc(db, "channels", channelId), patch);
}

export async function changeChannelUsername(channelId, oldUsername, newHandle) {
  const handle = newHandle.startsWith("ch_") ? newHandle : "ch_" + newHandle;
  const batch = writeBatch(db);
  if (oldUsername) batch.delete(doc(db, "usernames", oldUsername.toLowerCase()));
  batch.set(doc(db, "usernames", handle.toLowerCase()), { type: "channel", ownerId: channelId });
  batch.update(doc(db, "channels", channelId), { username: handle });
  await batch.commit();
  return handle;
}

// ================== "Мои каналы" ==================
// Создатель — через channelSecrets (там правило читает только "если это ты и есть
// creatorUid", то есть безопасно для query). Админ — через adminUids array-contains,
// это обычное публичное поле канала, читается свободно.
export async function fetchManagedChannels() {
  if (!currentUser) return { created: [], admin: [] };

  const createdQ = query(collection(db, "channelSecrets"), where("creatorUid", "==", currentUser.uid));
  const adminQ = query(collection(db, "channels"), where("adminUids", "array-contains", currentUser.uid));
  const [createdSnap, adminSnap] = await Promise.all([getDocs(createdQ), getDocs(adminQ)]);

  const createdIds = createdSnap.docs.map(d => d.id);
  const createdChannels = await Promise.all(createdIds.map(id => getChannel(id)));
  const admin = adminSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  return { created: createdChannels.filter(Boolean), admin };
}

export async function fetchManagedChannelIds() {
  const { created, admin } = await fetchManagedChannels();
  return new Set([...created.map(c => c.id), ...admin.map(c => c.id)]);
}

// ================== Подписки ==================
// Сама логика хранения — в subscriptions.js. Тут только действия над каналом,
// которые дополнительно управляют ВИДИМОСТЬЮ подписки для админов канала.
//
// Две независимые вещи:
//   подписка   — твой личный список, лежит в аккаунте (приватно), синкается
//   видимость  — запись в channels/{id}/subscribers, её видят админы канала
// «Скрыться» убирает только вторую: канал остаётся в твоей ленте, но
// администрация больше не знает, что ты подписан.

export { getSubscriptionsSync as getSubscriptions, isSubscribed as isSubscribedLocal,
         loadSubscriptions } from "./subscriptions.js";

// Подписаться: личная запись + (если есть аккаунт) видимая запись у канала.
export async function subscribeToChannel(channelId) {
  await addSubscription(channelId);
  if (currentUser) {
    await setDoc(doc(db, "channels", channelId, "subscribers", currentUser.uid), {
      subscribedAt: serverTimestamp()
    }).catch(() => {});   // не смогли показаться — подписка всё равно осталась
  }
}

// Отписаться: убираем и личную запись, и видимую.
export async function unsubscribeFromChannel(channelId) {
  await removeSubscription(channelId);
  if (currentUser) {
    await deleteDoc(doc(db, "channels", channelId, "subscribers", currentUser.uid)).catch(() => {});
  }
}

// "Скрыться" — удаляет ТОЛЬКО видимую запись. Подписка остаётся.
export async function hideFromChannel(channelId) {
  if (!currentUser) return;
  await deleteDoc(doc(db, "channels", channelId, "subscribers", currentUser.uid));
}

export async function revealToChannel(channelId) {
  if (!currentUser) return;
  await setDoc(doc(db, "channels", channelId, "subscribers", currentUser.uid), {
    subscribedAt: serverTimestamp()
  });
}

export async function isIdentifiedSubscriber(channelId) {
  if (!currentUser) return false;
  const snap = await getDoc(doc(db, "channels", channelId, "subscribers", currentUser.uid));
  return snap.exists();
}

// Для панели "Люди" — доступно только создателю/админам (см. правило read).
export async function listChannelSubscribers(channelId) {
  const snap = await getDocs(collection(db, "channels", channelId, "subscribers"));
  const uids = snap.docs.map(d => d.id);
  const users = await Promise.all(uids.map(async uid => {
    const u = await getDoc(doc(db, "users", uid));
    return u.exists() ? { uid, ...u.data() } : { uid, nickname: "???", username: "???" };
  }));
  return users;
}

// "Добавить людей" / "назначить управляющих" — принимают @юзернейм или NUID (U1xxxxxx).
export async function addPersonToChannel(channelId, handle) {
  const user = await resolveUserHandle(handle);
  if (!user) throw new Error("Не нашла такого пользователя");
  await setDoc(doc(db, "channels", channelId, "subscribers", user.uid), {
    subscribedAt: serverTimestamp()
  });
  return user;
}

export async function assignChannelAdmin(channelId, handle) {
  const user = await resolveUserHandle(handle);
  if (!user) throw new Error("Не нашла такого пользователя");
  const channel = await getChannel(channelId);
  if ((channel.adminUids || []).includes(user.uid)) throw new Error("Уже управляющий");

  // Дата назначения нужна правилам: свежий управляющий первые три дня не может
  // трогать записи, опубликованные до его прихода.
  await updateDoc(doc(db, "channels", channelId), {
    adminUids: [...(channel.adminUids || []), user.uid],
    adminSince: { ...(channel.adminSince || {}), [user.uid]: Date.now() }
  });
  return user;
}

export async function removeChannelAdmin(channelId, uid) {
  const channel = await getChannel(channelId);
  const since = { ...(channel.adminSince || {}) };
  delete since[uid];
  await updateDoc(doc(db, "channels", channelId), {
    adminUids: (channel.adminUids || []).filter(u => u !== uid),
    adminSince: since
  });
}

// ================== Публикация от имени канала ==================
// Владение постом (для редактирования/удаления) остаётся за тем, кто физически нажал
// "опубликовать" — тот же механизм postSecrets, что и у обычных постов. Кто именно
// это был из админов/создателя — в самом посте не сохраняется, только у него в браузере.
export async function createChannelPost(channelId, text, imageUrls) {
  const channel = await getChannel(channelId);
  const ref = await addDoc(collection(db, "posts"), {
    authorUid: null,
    channelId,
    channelName: channel.name,
    channelAvatar: channel.avatarUrl,
    channelUsername: channel.username,
    isAnonymous: false,
    text,
    imageUrls,
    likesCount: 0,
    likedBy: [],
    createdAt: serverTimestamp()
  });
  await setDoc(doc(db, "postSecrets", ref.id), { ownerUid: auth.currentUser.uid });
  markOwned("post", ref.id);
  return ref.id;
}

// ================== Простая рекомендация по схожести описаний ==================
const STOPWORDS = new Set(["и", "в", "на", "с", "по", "для", "не", "что", "как", "это", "к", "о", "из", "за", "то", "а", "но", "же"]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .match(/[a-zа-яё0-9]+/g)?.filter(w => w.length > 2 && !STOPWORDS.has(w)) || [];
}

export function suggestChannels(allChannels, subscribedIds, excludeSubscribed = true) {
  const subscribed = allChannels.filter(c => subscribedIds.includes(c.id));
  const candidates = excludeSubscribed
    ? allChannels.filter(c => !subscribedIds.includes(c.id))
    : allChannels;

  if (!subscribed.length) return candidates.slice(0, 6);

  const subWords = new Set(subscribed.flatMap(c => tokenize(c.description)));
  const scored = candidates.map(c => ({
    channel: c,
    score: tokenize(c.description).filter(w => subWords.has(w)).length
  }));

  const withScore = scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score);
  if (withScore.length) return withScore.slice(0, 6).map(s => s.channel);
  return candidates.slice(0, 6);
}
