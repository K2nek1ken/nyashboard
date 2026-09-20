import { db, collection, query, where, orderBy, limit, getDocs } from "./firebase.js";
import { currentUser, authReady } from "./auth.js";
import { getSubscriptionsSync, loadSubscriptions } from "./subscriptions.js";
import { getFriendsSync, loadFriends } from "./friends.js";

// ============================================================
//  Отметки о новом на вкладках
//
//  Считаем без отдельной коллекции уведомлений: сравниваем время последнего
//  события с моментом, когда человек в последний раз открывал эту вкладку.
//  Так не нужно писать запись в базу на каждое действие каждого человека —
//  это самый дорогой путь и по лимитам, и по сложности.
//
//  Цена решения: отметка появляется при загрузке страницы, а не мгновенно.
//  Для кружка «есть новое» этого достаточно.
// ============================================================

const SEEN_KEY = "nyash_tabs_seen";

function readSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; }
  catch { return {}; }
}

function writeSeen(data) {
  localStorage.setItem(SEEN_KEY, JSON.stringify(data));
}

// Отмечаем вкладку просмотренной — вызывается при открытии соответствующей страницы.
export function markTabSeen(tab) {
  const seen = readSeen();
  seen[tab] = Date.now();
  writeSeen(seen);
}

// Пока человек смотрит на вкладку, отметка обновляется: иначе сообщения,
// пришедшие во время чтения, оставались бы «непрочитанными» навсегда, и точка
// зажигалась бы снова при каждой проверке.
let seenTimer = null;
let seenHandler = null;

export function keepTabSeen(tab) {
  // Прошлый отсчёт останавливаем: без перезагрузки страницы вкладку можно
  // открыть много раз, и таймеры копились бы с каждым переходом.
  stopKeepingSeen();

  const touch = () => { if (!document.hidden) markTabSeen(tab); };
  touch();
  seenTimer = setInterval(touch, 10000);
  seenHandler = touch;
  document.addEventListener("visibilitychange", touch);
  window.addEventListener("focus", touch);
}

export function stopKeepingSeen() {
  if (seenTimer) { clearInterval(seenTimer); seenTimer = null; }
  if (seenHandler) {
    document.removeEventListener("visibilitychange", seenHandler);
    window.removeEventListener("focus", seenHandler);
    seenHandler = null;
  }
}

function seenAt(tab) {
  return readSeen()[tab] || 0;
}

async function hasNewerThan(collectionName, field, since, extra = []) {
  const parts = [collection(db, collectionName), ...extra, orderBy(field, "desc"), limit(1)];
  const snap = await getDocs(query(...parts));
  if (snap.empty) return false;
  const ts = snap.docs[0].data()[field];
  return (ts?.toMillis?.() || 0) > since;
}

// Что считается новым для каждой вкладки:
//   чат     — сообщения после последнего захода
//   друзья  — сообщения в личных переписках
//   контент — записи каналов из подписок
//   лента   — ответы на твои записи
export async function checkTabs() {
  await authReady;
  const result = { chat: false, friends: false, content: false, feed: false };

  try {
    // Смотрим последние сообщения, а не одно: последнее вполне может быть
    // своим, и тогда точка загоралась от собственной же реплики.
    const snap = await getDocs(query(collection(db, "chatMessages"),
      orderBy("createdAt", "desc"), limit(5)));
    const since = seenAt("chat");
    const { isOwned } = await import("./ownership.js");
    // Точка загорается, только когда обращаются к тебе: ответили на твоё
    // сообщение или упомянули. Любое новое сообщение в общем чате — это
    // просто жизнь чата, и отмечать его как непрочитанное значит держать
    // точку зажжённой постоянно.
    const myUsername = currentUserDoc?.username;
    const myNickname = currentUserDoc?.nickname;

    result.chat = snap.docs.some(d => {
      const m = d.data();
      const ts = m.createdAt?.toMillis?.() || 0;
      if (ts <= since) return false;

      const mine = isOwned("chatMessage", d.id)
        || (currentUser && m.authorUid === currentUser.uid)
        || m.isBot;
      if (mine) return false;

      // ответ на твоё сообщение
      if (m.replyToId && isOwned("chatMessage", m.replyToId)) return true;
      if (m.replyToNickname && myNickname && m.replyToNickname === myNickname) return true;

      // упоминание по юзернейму
      if (myUsername && new RegExp(`@${myUsername}\\b`, "i").test(m.text || "")) return true;

      return false;
    });
  } catch {}

  if (!currentUser) return result;

  try {
    await Promise.all([loadSubscriptions(), loadFriends()]);

    // личные переписки: последнее сообщение отмечено прямо в документе чата
    const chats = await getDocs(query(collection(db, "dmChats"),
      where("participants", "array-contains", currentUser.uid)));
    const since = seenAt("friends");
    result.friends = chats.docs.some(d => {
      const data = d.data();
      const ts = data.lastAt?.toMillis?.() || 0;
      return ts > since && data.lastSender !== currentUser.uid;
    });

    // Заявки в друзья — их видно только адресату, поэтому проверяем отдельно.
    //
    // Заявкой считается только тот, кого нет у тебя в друзьях. Иначе
    // получалось так: человек тебя добавил, ты добавил в ответ — вы уже
    // друзья, а запись о его заявке осталась, и точка горела вечно.
    if (!result.friends) {
      const incoming = await getDocs(query(
        collection(db, "users", currentUser.uid, "incoming"), limit(20)));

      const mine = new Set(getFriendsSync().map(f => f.uid || f));
      result.friends = incoming.docs.some(d => !mine.has(d.id));
    }

    // записи подписок и друзей
    const subs = getSubscriptionsSync();
    const friends = getFriendsSync();
    if (subs.length || friends.length) {
      const snap = await getDocs(query(collection(db, "posts"),
        orderBy("createdAt", "desc"), limit(30)));
      const sinceContent = seenAt("content");
      result.content = snap.docs.some(d => {
        const p = d.data();
        const ts = p.createdAt?.toMillis?.() || 0;
        if (ts <= sinceContent) return false;
        // Своё сюда не попадает: отмечать собственную публикацию как
        // непрочитанную незачем — точка загоралась от собственных действий.
        if (currentUser && p.authorUid === currentUser.uid) return false;
        if (isOwned("post", d.id)) return false;

        return (p.channelId && subs.includes(p.channelId))
            || (p.authorUid && friends.includes(p.authorUid));
      });
    }

    // ответы на свои записи
    const myPosts = await getDocs(query(collection(db, "posts"),
      where("authorUid", "==", currentUser.uid), limit(20)));
    if (!myPosts.empty) {
      const ids = myPosts.docs.map(d => d.id);
      const sinceFeed = seenAt("feed");
      // Firestore ограничивает список значений, поэтому берём первые десять:
      // для отметки «есть новое» этого достаточно
      const replies = await getDocs(query(collection(db, "replies"),
        where("postId", "in", ids.slice(0, 10)), limit(20)));
      result.feed = replies.docs.some(d => {
        const r = d.data();
        return (r.createdAt?.toMillis?.() || 0) > sinceFeed && r.authorUid !== currentUser.uid;
      });
    }
  } catch (e) {
    console.warn("Не смогла проверить новое:", e.message);
  }

  return result;
}

// Рисует точку на вкладках. Вызывается из навигации после её построения.
export async function paintTabDots() {
  const marks = await checkTabs();

  // Заглушённые вкладки отметку не показывают — так человек и просил,
  // удерживая вкладку и выбирая «отключить уведомления».
  let muted = new Set();
  try {
    muted = new Set(JSON.parse(localStorage.getItem("nyash_muted_tabs") || "[]"));
  } catch {}

  for (const tab of muted) marks[tab] = false;
  const map = { feed: "index.html", chat: "chat.html", friends: "friends.html", content: "content.html" };
  for (const [tab, href] of Object.entries(map)) {
    const btn = document.querySelector(`.navBtn[href="${href}"]`);
    if (!btn) continue;
    btn.classList.toggle("has-new", !!marks[tab]);
  }
}

// Периодическая проверка. Без неё точка появлялась только при загрузке
// страницы — то есть ровно тогда, когда человек и так всё видит.
//
// Раз в 15 секунд: чаще незачем (это лишние обращения к базе на каждого
// открытого посетителя), реже — уже заметно запаздывает. Пока вкладка скрыта,
// опрос останавливается: фоновые вкладки не должны жечь лимит.
let pollTimer = null;

export function startTabPolling(intervalMs = 15000) {
  stopTabPolling();
  const tick = () => { if (!document.hidden) paintTabDots(); };
  pollTimer = setInterval(tick, intervalMs);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}

export function stopTabPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
