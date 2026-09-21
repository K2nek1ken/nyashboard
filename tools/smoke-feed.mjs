// Живая проверка ленты: загружается ли модуль и собираются ли карточки.
//
//   node tools/smoke-feed.mjs
//
// Как и у чата: статика видит не всё, а здесь модуль по-настоящему
// выполняется на образцах записей.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

let src = fs.readFileSync("js/feed.js", "utf8");

const stub = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : k === Symbol.iterator ? [][Symbol.iterator] : stub),
  apply: () => stub
});
src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*"[^"]+";/gm, (m, names) =>
  names.split(",").map(n => n.trim().split(" as ").pop()).filter(Boolean)
    .map(n => `const ${n} = __stub;`).join("\n"));
src = src.replace(/^export\s*\{[^}]*\}\s*from\s*"[^"]+";/gm, "");
src = src.replace(/^export /gm, "");
src += "\n;globalThis.__postToHtml = postToHtml;";

globalThis.__stub = stub;
globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, innerWidth: 400, innerHeight: 800, dispatchEvent() {} };
globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, documentElement: { style: { setProperty() {} }, dataset: {} }, createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, dataset: {} }) };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.location = { origin: "https://example.test", pathname: "/index.html", search: "", href: "https://example.test/index.html" };

try {
  (0, eval)(src);
} catch (e) {
  console.log("  ОШИБКА ПРИ ЗАГРУЗКЕ МОДУЛЯ:", e.message);
  process.exit(1);
}

const now = { toMillis: () => Date.now() };
const samples = [
  { id: "p1", text: "обычная запись", authorUid: "A", authorNickname: "неко", createdAt: now, likedBy: [], dislikedBy: [] },
  { id: "p2", text: "анонимная", isAnonymous: true, createdAt: now, likedBy: [], dislikedBy: [] },
  { id: "p3", text: "с картинкой #тег", authorUid: "B", imageUrls: ["x.png"], createdAt: now, likedBy: [], dislikedBy: [] }
];
for (const p of samples) {
  try {
    const html = globalThis.__postToHtml(p);
    console.log("  запись", p.id, "— собрана,", String(html).length, "знаков");
  } catch (e) {
    console.log("  запись", p.id, "— ОШИБКА:", e.message);
    process.exitCode = 1;
  }
}
