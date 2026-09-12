import { db, collection, query, where, orderBy, limit, getDocs } from "./firebase.js";
import { currentUser, authReady } from "./auth.js";
import { notify } from "./web-notify.js";
import { getSettings } from "./settings.js";

// ============================================================
//  События о тебе: лайки, ответы, заявки, личные сообщения
//
//  Уведомления не сыплются по одному. Однотипные складываются в одно и
//  заменяют друг друга: «твою запись отметили» → «твою запись отметили (3)».
//  Так работает замена по метке — браузер показывает только последнее
//  уведомление с той же меткой, а не копит стопку.
//
//  Важное приходит сразу: ответ на запись, сообщение в личке, заявка.
//  Остальное (лайки) ждёт сводки раз в час — иначе запись с сотней отметок
//  превратится в сотню уведомлений, и человек отключит их совсем.
//
//  Всё держится на опросе: сервера рассылки нет, поэтому события видны,
//  пока сайт открыт хотя бы в фоновой вкладке.
// ============================================================

const STATE_KEY = "nyash_notify_state";
const DIGEST_PERIOD = 60 * 60 * 1000;      // сводка раз в час

function readState() {
  try { return JSON.parse(localStorage.getItem(STATE_KEY)) || {}; }
  catch { return {}; }
}

function writeState(next) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(next)); } catch {}
}

// ---------- накопление ----------

// Складывает событие к уже показанному и обновляет уведомление.
// Метка одна на вид события, поэтому новое заменяет прошлое, а не добавляется.
function bump(kind, count, build) {
  const state = readState();
  const pending = state.pending || {};
  pending[kind] = (pending[kind] || 0) + count;
  state.pending = pending;
  writeState(state);

  const total = pending[kind];
  notify(build(total), "", { tag: "nyash-" + kind });
}

// После того как человек зашёл и всё увидел, счётчики обнуляются.
export function clearPending(kind = null) {
  const state = readState();
  if (!state.pending) return;
  if (kind) delete state.pending[kind];
  else state.pending = {};
  writeState(state);
}

// ---------- проверка событий ----------

export async function checkPersonalEvents() {
  await authReady;
  if (!currentUser) return;
  if (getSettings().webNotify !== "on") return;

  const state = readState();
  const seen = state.seen || {};
  let changed = false;

  try {
    // ---- лайки своих записей ----
    // Считаем сумму отметок по своим записям и сравниваем с прошлым разом:
    // так не нужно хранить, кто именно и что отметил.
    const myPosts = await getDocs(query(
      collection(db, "posts"),
      where("authorUid", "==", currentUser.uid),
      orderBy("createdAt", "desc"), limit(20)
    ));
    const likes = myPosts.docs.reduce((sum, d) => sum + (d.data().likesCount || 0), 0);

    if (seen.likes !== undefined && likes > seen.likes) {
      // Лайки не показываем сразу — копим до сводки.
      const state2 = readState();
      state2.digest = state2.digest || {};
      state2.digest.likes = (state2.digest.likes || 0) + (likes - seen.likes);
      writeState(state2);
    }
    if (seen.likes !== likes) { seen.likes = likes; changed = true; }

    // ---- ответы на свои записи ----
    if (!myPosts.empty) {
      const ids = myPosts.docs.map(d => d.id).slice(0, 10);
      const replies = await getDocs(query(
        collection(db, "replies"),
        where("postId", "in", ids),
        orderBy("createdAt", "desc"), limit(20)
      ));
      const fresh = replies.docs.filter(d => {
        const r = d.data();
        return r.authorUid !== currentUser.uid
          && (r.createdAt?.toMillis?.() || 0) > (seen.repliesAt || Date.now());
      });

      if (fresh.length && seen.repliesAt !== undefined) {
        bump("replies", fresh.length, (n) =>
          n === 1 ? "Тебе ответили на запись" : `Тебе ответили на записи (${n})`);
      }
      const newest = replies.docs[0]?.data().createdAt?.toMillis?.() || Date.now();
      if (seen.repliesAt !== newest) { seen.repliesAt = newest; changed = true; }
    }

    // ---- заявки в друзья ----
    const incoming = await getDocs(query(
      collection(db, "users", currentUser.uid, "incoming"), limit(20)
    ));
    if (seen.requests !== undefined && incoming.size > seen.requests) {
      bump("requests", incoming.size - seen.requests, (n) =>
        n === 1 ? "Тебя добавили в друзья" : `Тебя добавили в друзья (${n})`);
    }
    if (seen.requests !== incoming.size) { seen.requests = incoming.size; changed = true; }

    // ---- личные сообщения ----
    const chats = await getDocs(query(
      collection(db, "dmChats"),
      where("participants", "array-contains", currentUser.uid)
    ));
    const lastIncoming = chats.docs.reduce((max, d) => {
      const data = d.data();
      if (data.lastSender === currentUser.uid) return max;
      return Math.max(max, data.lastAt?.toMillis?.() || 0);
    }, 0);

    if (seen.dmAt !== undefined && lastIncoming > seen.dmAt) {
      bump("dm", 1, (n) =>
        n === 1 ? "Новое сообщение в личке" : `Новые сообщения в личке (${n})`);
    }
    if (seen.dmAt !== lastIncoming) { seen.dmAt = lastIncoming; changed = true; }

  } catch (e) {
    console.warn("События не проверились:", e.message);
  }

  if (changed) {
    const next = readState();
    next.seen = seen;
    writeState(next);
  }

  maybeShowDigest();
}

// ---------- сводка ----------

// Раз в час показываем накопленное одним уведомлением — то, что не стоит
// сообщать сразу, но о чём приятно узнать.
function maybeShowDigest() {
  const state = readState();
  const digest = state.digest || {};
  const parts = [];

  if (digest.likes) parts.push(`отметок: ${digest.likes}`);
  if (digest.reactions) parts.push(`реакций: ${digest.reactions}`);
  if (!parts.length) return;

  if (getSettings().hourlyDigest === "off") return;

  const last = state.digestAt || 0;
  if (Date.now() - last < DIGEST_PERIOD) return;

  notify("Что нового за час", parts.join(" · "), { tag: "nyash-digest" });

  state.digest = {};
  state.digestAt = Date.now();
  writeState(state);
}

// ---------- запуск ----------

let timer = null;

export function startPersonalWatch(intervalMs = 30000) {
  stopPersonalWatch();
  const tick = () => { if (!document.hidden) checkPersonalEvents(); };
  tick();
  timer = setInterval(tick, intervalMs);
}

export function stopPersonalWatch() {
  if (timer) { clearInterval(timer); timer = null; }
}
