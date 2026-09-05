// Гостевая личность — рандомный ID + ник, хранится только в localStorage этого браузера.
// Она НИКОГДА не отправляется вместе с UID аккаунта, поэтому даже если ты залогинена,
// в чате/анонимных постах тебя не спалить, пока сама не назовёшь свой @username.

const KEY = "nyash_guest_identity";

function randomId() {
  return "g_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const ADJ = ["пушистый", "сонный", "тихий", "загадочный", "лунный", "мятный", "звёздный"];
const NOUN = ["котик", "неко", "дух", "странник", "бродяга", "мур", "призрак"];

function randomNick() {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}_${n}_${Math.floor(Math.random() * 900 + 100)}`;
}

export function getGuestIdentity() {
  let raw = localStorage.getItem(KEY);
  if (!raw) {
    const identity = { id: randomId(), nickname: randomNick(), avatar: "" };
    localStorage.setItem(KEY, JSON.stringify(identity));
    return identity;
  }
  return JSON.parse(raw);
}

export function setGuestNickname(nickname) {
  const identity = getGuestIdentity();
  identity.nickname = nickname;
  localStorage.setItem(KEY, JSON.stringify(identity));
  saveChatNickToAccount(nickname);
  return identity;
}

// Ник в чате должен переживать чистку браузера и переход на другое устройство,
// поэтому у вошедших он дублируется в приватную часть аккаунта. Локальная копия
// остаётся: она нужна гостям и как мгновенный кэш.
async function saveChatNickToAccount(nickname) {
  try {
    const { currentUser } = await import("./auth.js");
    if (!currentUser) return;
    const { db, doc, setDoc } = await import("./firebase.js");
    await setDoc(doc(db, "users", currentUser.uid, "private", "chat"),
                 { nickname }, { merge: true });
  } catch (e) {
    console.warn("Ник чата не сохранился в аккаунт:", e.message);
  }
}

// При входе подтягиваем сохранённый ник. Если человек до этого писал гостем,
// его текущий ник переносится в аккаунт — иначе привычное имя терялось бы
// в момент входа.
export async function syncChatNickname() {
  try {
    const { currentUser, authReady } = await import("./auth.js");
    await authReady;
    if (!currentUser) return getGuestIdentity().nickname;

    const { db, doc, getDoc, setDoc } = await import("./firebase.js");
    const ref = doc(db, "users", currentUser.uid, "private", "chat");
    const snap = await getDoc(ref);

    if (snap.exists() && snap.data().nickname) {
      const identity = getGuestIdentity();
      identity.nickname = snap.data().nickname;
      localStorage.setItem(KEY, JSON.stringify(identity));
      return identity.nickname;
    }
    // в аккаунте ника ещё нет — переносим тот, под которым человек писал гостем
    const current = getGuestIdentity().nickname;
    await setDoc(ref, { nickname: current }, { merge: true });
    return current;
  } catch (e) {
    console.warn("Ник чата не синхронизировался:", e.message);
    return getGuestIdentity().nickname;
  }
}
