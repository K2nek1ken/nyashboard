// ============================================================
//  Свои имена для людей
//
//  Как записанные контакты: можно переименовать человека для себя, и видеть
//  привычное имя вместо того, что он поставил. Хранится локально и никуда
//  не отправляется — это твоя пометка, а не изменение чужого профиля.
// ============================================================

const KEY = "nyash_aliases";

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

export function getAlias(uid) {
  return uid ? (readAll()[uid] || null) : null;
}

export function setAlias(uid, name) {
  const all = readAll();
  if (name && name.trim()) all[uid] = name.trim();
  else delete all[uid];
  localStorage.setItem(KEY, JSON.stringify(all));
}

// Имя для показа: своё, если задано, иначе то, что человек поставил сам.
export function displayName(user, fallback = "???") {
  if (!user) return fallback;
  return getAlias(user.uid) || user.nickname || fallback;
}
