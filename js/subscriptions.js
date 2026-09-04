import {
  db, collection, doc, setDoc, deleteDoc, getDocs, serverTimestamp
} from "./firebase.js";
import { currentUser, authReady, onAuthChange } from "./auth.js";

// ============================================================
//  Подписки на каналы
//
//  Где что лежит и почему:
//
//  users/{uid}/subscriptions/{channelId}  — ЛИЧНЫЙ список «на что я подписан».
//      Приватный: по правилам базы читать и писать может только сам владелец.
//      Синхронизируется между устройствами, потому что привязан к аккаунту.
//
//  channels/{id}/subscribers/{uid}        — ПУБЛИЧНЫЙ (для админов канала) список.
//      Именно он показывается в разделе «Люди» канала, и именно его удаляет
//      кнопка «Скрыться». Живёт отдельно, поэтому скрыться можно, не теряя
//      саму подписку.
//
//  localStorage                            — только для гостей без аккаунта плюс
//      оффлайн-кэш, чтобы лента ранжировалась мгновенно, не дожидаясь сети.
// ============================================================

const LOCAL_KEY = "nyash_channel_subs";
const MIGRATED_KEY = "nyash_subs_migrated";

let cache = readLocal();          // синхронный доступ для ранжирования ленты
let ready = null;

function readLocal() {
  try { return new Set(JSON.parse(localStorage.getItem(LOCAL_KEY)) || []); }
  catch { return new Set(); }
}

function writeLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify([...cache]));
}

// Синхронный снимок — нужен ранжированию ленты, которое не может ждать сеть.
export function getSubscriptionsSync() {
  return [...cache];
}

export function isSubscribed(channelId) {
  return cache.has(channelId);
}

// Загружает подписки из аккаунта (если человек вошёл) и объединяет с локальными.
// Вызывается один раз при старте страницы; повторный вызов вернёт тот же промис.
export function loadSubscriptions() {
  if (ready) return ready;
  ready = (async () => {
    await authReady;
    if (!currentUser) return getSubscriptionsSync();   // гость — только локально

    try {
      const snap = await getDocs(collection(db, "users", currentUser.uid, "subscriptions"));
      const remote = new Set(snap.docs.map(d => d.id));

      // Первый вход после появления серверных подписок: то, что человек
      // насобирал гостем в этом браузере, переносим в аккаунт, чтобы ничего
      // не потерялось. Делается один раз на устройство.
      const migrationKey = MIGRATED_KEY + ":" + currentUser.uid;
      if (!localStorage.getItem(migrationKey)) {
        const onlyLocal = [...cache].filter(id => !remote.has(id));
        await Promise.all(onlyLocal.map(id =>
          setDoc(doc(db, "users", currentUser.uid, "subscriptions", id),
                 { subscribedAt: serverTimestamp() })
        ));
        onlyLocal.forEach(id => remote.add(id));
        localStorage.setItem(migrationKey, "1");
      }

      cache = remote;
      writeLocal();   // оффлайн-кэш, чтобы следующая загрузка была мгновенной
    } catch (e) {
      console.warn("Не смогла загрузить подписки из аккаунта, работаю с локальными:", e.message);
    }
    return getSubscriptionsSync();
  })();
  return ready;
}

export async function addSubscription(channelId) {
  cache.add(channelId);
  writeLocal();
  if (currentUser) {
    await setDoc(doc(db, "users", currentUser.uid, "subscriptions", channelId),
                 { subscribedAt: serverTimestamp() });
  }
}

export async function removeSubscription(channelId) {
  cache.delete(channelId);
  writeLocal();
  if (currentUser) {
    await deleteDoc(doc(db, "users", currentUser.uid, "subscriptions", channelId)).catch(() => {});
  }
}

// При выходе из аккаунта чистим кэш, чтобы чужие подписки не «прилипли»
// к следующему человеку на этом же устройстве.
onAuthChange((user) => {
  if (!user) {
    cache = new Set();
    writeLocal();
    ready = null;
  }
});
