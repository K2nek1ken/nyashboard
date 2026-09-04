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
  return identity;
}
