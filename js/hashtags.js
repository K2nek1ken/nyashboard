// Хештеги хранятся отдельным массивом в документе поста — так их можно искать
// запросом array-contains, не вычитывая всю ленту и не фильтруя её на клиенте.
// NUID (#U1666777) хештегом НЕ считается: это ссылка на аккаунт, см. mentions.js.
const TAG_RE = /#([A-Za-zА-Яа-яЁё0-9_]{2,30})/g;

export function extractHashtags(text) {
  const found = new Set();
  for (const m of (text || "").matchAll(TAG_RE)) {
    const tag = m[1];
    if (/^U[14]\d{6}$/i.test(tag)) continue;   // это NUID, а не тег
    found.add(tag.toLowerCase());
  }
  return [...found].slice(0, 20);  // разумный потолок на один пост
}
