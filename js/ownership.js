// Секреты владения (postSecrets/replySecrets/chatMessageSecrets) никогда не читаются
// клиентом — они существуют только для правил Firestore. Поэтому UI ("это мой пост,
// показать редактирование/удаление") ориентируется на локальный список ID, которые
// сам же браузер и создал. Это работает надёжно, ПОКА не очищено хранилище браузера
// и не сменился Firebase auth uid (см. предупреждение в README про гостей).
const KEYS = {
  post: "nyash_owned_posts",
  reply: "nyash_owned_replies",
  chatMessage: "nyash_owned_messages"
};

function getSet(type) {
  try { return new Set(JSON.parse(localStorage.getItem(KEYS[type])) || []); }
  catch { return new Set(); }
}

function saveSet(type, set) {
  localStorage.setItem(KEYS[type], JSON.stringify([...set]));
}

export function markOwned(type, id) {
  const set = getSet(type);
  set.add(id);
  saveSet(type, set);
}

export function isOwned(type, id) {
  return getSet(type).has(id);
}

export function forgetOwned(type, id) {
  const set = getSet(type);
  set.delete(id);
  saveSet(type, set);
}
