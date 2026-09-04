import {
  db, collection, doc, setDoc, deleteDoc, getDoc, getDocs, serverTimestamp
} from "./firebase.js";
import { currentUser, authReady, onAuthChange } from "./auth.js";
import { getUserDoc } from "./data.js";

// ============================================================
//  Друзья
//
//  Дружба односторонняя, как подписка на канал: ты добавляешь человека — его
//  посты появляются в твоей ленте, и он получает доступ к твоему NUID
//  (если стоит режим «только друзья»).
//
//  Список лежит в users/{uid}/friends и читается ТОЛЬКО владельцем. Поэтому
//  прятаться, как в каналах, не от кого: никто и не видит, кто у тебя в друзьях.
//  При этом правила базы могут проверить exists() по этому пути — именно так
//  работает выдача NUID друзьям, без раскрытия самого списка.
//
//  Личный чат открывается только при взаимности: оба добавили друг друга.
// ============================================================

let cache = new Set();
let ready = null;

export function getFriendsSync() {
  return [...cache];
}

export function isFriend(uid) {
  return cache.has(uid);
}

export function loadFriends() {
  if (ready) return ready;
  ready = (async () => {
    await authReady;
    if (!currentUser) { cache = new Set(); return []; }
    try {
      const snap = await getDocs(collection(db, "users", currentUser.uid, "friends"));
      cache = new Set(snap.docs.map(d => d.id));
    } catch (e) {
      console.warn("Не смогла загрузить друзей:", e.message);
    }
    return getFriendsSync();
  })();
  return ready;
}

export async function addFriend(uid) {
  if (!currentUser) throw new Error("Нужен аккаунт");
  if (uid === currentUser.uid) throw new Error("Себя в друзья добавить нельзя");
  await setDoc(doc(db, "users", currentUser.uid, "friends", uid), { addedAt: serverTimestamp() });
  cache.add(uid);
}

export async function removeFriend(uid) {
  if (!currentUser) return;
  await deleteDoc(doc(db, "users", currentUser.uid, "friends", uid));
  cache.delete(uid);
}

// Взаимность: спрашиваем ровно один документ — «есть ли Я в друзьях у него».
// Правила разрешают точечное чтение своей записи в чужом списке, но запрещают
// перечислять список целиком. Поэтому узнать «добавил ли он меня» можно,
// а посмотреть, кто ещё у него в друзьях — нет.
export async function isMutualFriend(uid) {
  if (!currentUser) return false;
  try {
    const snap = await getDoc(doc(db, "users", uid, "friends", currentUser.uid));
    return snap.exists();
  } catch {
    return false;
  }
}

export function dmChatId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

export async function loadFriendProfiles() {
  await loadFriends();
  const uids = getFriendsSync();
  const profiles = await Promise.all(uids.map(async uid => {
    const u = await getUserDoc(uid);
    return u ? { uid, ...u } : { uid, nickname: "неизвестный", username: "???" };
  }));
  return profiles;
}

onAuthChange((user) => {
  if (!user) { cache = new Set(); ready = null; }
});
