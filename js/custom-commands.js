import { db, doc, getDoc, setDoc, updateDoc, deleteField } from "./firebase.js";
import { currentUser } from "./auth.js";

// ============================================================
//  Свои команды бота
//
//  Человек добавляет их сам, прямо из чата:
//
//      +бот погладить|гладить погладил|погладила
//        └── названия через «|»   └── формы прошедшего времени
//
//      -бот погладить            — убрать
//
//  Хранятся в аккаунте, а не в браузере: иначе пропадали бы при переходе
//  на другое устройство, а смысл их в том, чтобы были всегда под рукой.
//
//  Работают только у того, кто их создал. Общие команды для всех — это
//  уже другая задача: там нужно решать, кто имеет право их менять.
// ============================================================

const MAX_COMMANDS = 40;
const MAX_NAME = 24;
const MAX_FORM = 40;

let cache = null;

// ---------- чтение ----------

export async function loadCustomCommands() {
  if (!currentUser) return {};
  if (cache) return cache;

  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid, "settings", "botCommands"));
    cache = snap.exists() ? (snap.data().items || {}) : {};
  } catch (e) {
    console.warn("Свои команды не загрузились:", e.message);
    cache = {};
  }
  return cache;
}

export function forgetCustomCommands() { cache = null; }

// ---------- разбор строки добавления ----------

// «+бот погладить|гладить погладил|погладила» →
//   { names: ["погладить", "гладить"], forms: "погладил|погладила" }
export function parseAddCommand(text) {
  const m = /^\+\s*бот\s+(\S+)\s+(.+)$/i.exec(text.trim());
  if (!m) return null;

  const names = m[1].split("|").map(n => n.trim().toLowerCase()).filter(Boolean);
  const forms = m[2].trim();

  if (!names.length) return { error: "Не поняла название команды" };
  if (names.some(n => n.length > MAX_NAME)) return { error: "Название слишком длинное" };
  if (forms.length > MAX_FORM) return { error: "Ответ слишком длинный" };

  // Ответ может быть с формами («дал|дала») или одним словом — тогда
  // он не склоняется, как и в обычных командах.
  return { names, forms };
}

export function parseRemoveCommand(text) {
  const m = /^-\s*бот\s+(\S+)/i.exec(text.trim());
  return m ? m[1].trim().toLowerCase() : null;
}

// ---------- изменение ----------

export async function addCustomCommand({ names, forms }) {
  if (!currentUser) throw new Error("Свои команды привязаны к аккаунту — нужно войти");

  const current = await loadCustomCommands();
  const key = names[0];

  if (!(key in current) && Object.keys(current).length >= MAX_COMMANDS) {
    throw new Error(`Больше ${MAX_COMMANDS} своих команд не выйдет — убери лишние через «-бот»`);
  }

  const ref = doc(db, "users", currentUser.uid, "settings", "botCommands");
  const next = { ...current, [key]: { names, forms } };

  await setDoc(ref, { items: next }, { merge: true });
  cache = next;
  return key;
}

export async function removeCustomCommand(name) {
  if (!currentUser) throw new Error("Нужно войти");

  const current = await loadCustomCommands();
  // Ищем и по основному имени, и по любому из названий: убирать хочется
  // тем же словом, каким пользовались.
  const key = (name in current)
    ? name
    : Object.keys(current).find(k => current[k].names?.includes(name));

  if (!key) throw new Error(`Команды «${name}» у тебя нет`);

  await updateDoc(doc(db, "users", currentUser.uid, "settings", "botCommands"), {
    [`items.${key}`]: deleteField()
  });

  const next = { ...current };
  delete next[key];
  cache = next;
  return key;
}

// ---------- для движка ----------

// Приводит свои команды к тому же виду, что и встроенные, — движок
// не должен знать, откуда они взялись.
export function asRules(items) {
  return Object.values(items || {}).map(item => ({
    cmd: item.names,
    to: item.forms,
    custom: true
  }));
}
