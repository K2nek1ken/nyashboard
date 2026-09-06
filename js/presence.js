import { db, doc, setDoc, getDocs, collection, serverTimestamp } from "./firebase.js";
import { currentUser, authReady } from "./auth.js";

// ============================================================
//  Кто сейчас в сети
//
//  Держать постоянное соединение ради этого слишком дорого, поэтому просто
//  отмечаемся раз в минуту, пока вкладка открыта. Человек считается в сети,
//  если отметка свежее двух минут: так короткая пауза или переход между
//  страницами не выключают его из списка.
//
//  Отметка обновляется только при открытой вкладке — в фоне не пишем ничего.
// ============================================================

const ONLINE_WINDOW = 2 * 60 * 1000;
const HEARTBEAT = 60 * 1000;
let timer = null;

export async function startPresence() {
  await authReady;
  if (!currentUser) return;

  const ping = async () => {
    if (document.hidden) return;
    try {
      await setDoc(doc(db, "presence", currentUser.uid), { lastSeen: serverTimestamp() });
    } catch (e) {
      console.warn("Отметка присутствия не записалась:", e.message);
    }
  };

  ping();
  timer = setInterval(ping, HEARTBEAT);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) ping(); });
}

export function stopPresence() {
  if (timer) { clearInterval(timer); timer = null; }
}

// Возвращает набор идентификаторов тех, кто сейчас в сети.
export async function fetchOnline(uids) {
  if (!uids.length) return new Set();
  try {
    const snap = await getDocs(collection(db, "presence"));
    const now = Date.now();
    const online = new Set();
    snap.docs.forEach(d => {
      if (!uids.includes(d.id)) return;
      const ts = d.data().lastSeen?.toMillis?.() || 0;
      if (now - ts < ONLINE_WINDOW) online.add(d.id);
    });
    return online;
  } catch {
    return new Set();
  }
}
