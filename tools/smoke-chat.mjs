// Живая проверка чата: загружается ли модуль и собираются ли сообщения.
//
// Статические проверки видят не всё: однажды пропала функция, которую
// звали только изнутри шаблонной строки, — синтаксис верный, импорты
// сходятся, а чат не грузился. Здесь модуль по-настоящему выполняется
// на образцах, и такое падение видно сразу.
//
//   node tools/smoke-chat.mjs
// Берём весь chat.js, подменяем внешние модули заглушками и зовём messageHtml.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

let src = fs.readFileSync("js/chat.js", "utf8");

// импорты → заглушки, которые возвращают что-нибудь безобидное
const stub = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : stub),
  apply: () => stub
});
src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*"[^"]+";/gm, (m, names) =>
  names.split(",").map(n => n.trim().split(" as ").pop()).filter(Boolean)
    .map(n => `const ${n} = __stub;`).join("\n"));
src = src.replace(/^export /gm, "");

// наружу — то, что хотим позвать
src += "\n;globalThis.__messageHtml = messageHtml;";

globalThis.__stub = stub;
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, innerHeight: 800, dispatchEvent() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: { style: { setProperty() {} } }, createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }) };
globalThis.localStorage = { getItem: () => null, setItem() {} };


try {
  (0, eval)(src);
} catch (e) {
  console.log("ОШИБКА ПРИ ЗАГРУЗКЕ МОДУЛЯ:", e.message);
  process.exit(1);
}

const samples = [
  { id: "1", text: "привет", nickname: "неко", authorUid: "A", createdAt: { toMillis: () => Date.now() } },
  { id: "2", text: "неко обнял кого-то", isBot: true, botActor: { name: "неко", uid: "A" }, createdAt: { toMillis: () => Date.now() } },
  { id: "3", text: "старое сообщение бота", isBot: true, createdAt: { toMillis: () => Date.now() } }
];
for (const m of samples) {
  try {
    const html = globalThis.__messageHtml(m, samples, new Set());
    console.log("  сообщение", m.id, "— собрано,", String(html).length, "знаков");
  } catch (e) {
    console.log("  сообщение", m.id, "— ОШИБКА:", e.message);
    process.exitCode = 1;
  }
}
