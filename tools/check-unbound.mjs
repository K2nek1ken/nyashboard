// Имена, которые модуль берёт у других, не подключив их.
//
// Проверка вызовов ловит только пропавшие функции. А здесь — любое
// использование: переменная, константа, объект. Так однажды тихо сломались
// треки в записях (не подключён currentUser) и отметки упоминаний
// (не подключён currentUserDoc): код падал, ошибку ловили, а пользователь
// просто ничего не видел.
//
//   node tools/check-unbound.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
process.chdir(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

const files = [
  ...fs.readdirSync("js").filter(f => f.endsWith(".js")).map(f => "js/" + f),
  ...fs.readdirSync("js/modules").filter(f => f.endsWith(".js")).map(f => "js/modules/" + f)
];

// Убираем комментарии, строки, а ещё строки импорта и пересылки:
// в них имена упоминаются, но не используются.
const strip = (c) => c
  .replace(/\/\/[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*(?:import|export)\s*\{[^}]*\}\s*from\s*["'][^"']+["'];?/gm, "")
  .replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');

const exporters = new Map();
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/^export\s+(?:async\s+)?(?:function|let|const|class)\s+(\w+)/gm)) {
    if (!exporters.has(m[1])) exporters.set(m[1], new Set());
    exporters.get(m[1]).add(path.basename(f));
  }
}

const problems = [];
for (const f of files) {
  const raw = fs.readFileSync(f, "utf8");
  const s = strip(raw);
  const known = new Set();
  const add = (n) => { n = n.trim().split(":").pop().trim().split("=")[0].trim().replace(/[{}\[\]. ]/g, ""); if (n) known.add(n); };

  for (const m of raw.matchAll(/import\s*\{([^}]+)\}/g)) m[1].split(",").forEach(n => add(n.split(" as ").pop()));
  for (const m of s.matchAll(/\{([^{}]+)\}\s*=\s*await\s+import/g)) m[1].split(",").forEach(add);
  for (const m of s.matchAll(/\.then\(\s*\(?\{([^}]+)\}/g)) m[1].split(",").forEach(add);
  for (const m of s.matchAll(/\[([^\[\]]*\{[^\[\]]*\}[^\[\]]*)\]\s*=/g))
    for (const inner of m[1].matchAll(/\{([^{}]+)\}/g)) inner[1].split(",").forEach(add);
  for (const m of s.matchAll(/(?:function|let|const|var|class)\s+(\w+)/g)) known.add(m[1]);
  for (const m of s.matchAll(/\(([^()]{0,200})\)\s*=>/g)) m[1].split(",").forEach(add);
  for (const m of s.matchAll(/\b(\w+)\s*=>/g)) known.add(m[1]);
  for (const m of s.matchAll(/function\s*\w*\s*\(([^()]*)\)/g)) m[1].split(",").forEach(add);
  for (const m of s.matchAll(/\{([^{}]{0,200})\}\s*=(?!=)/g)) m[1].split(",").forEach(add);

  const me = path.basename(f);
  for (const [name, owners] of exporters) {
    if (owners.has(me) || known.has(name)) continue;
    // Использование как самостоятельного имени — не свойство (.name),
    // не ключ объекта (name:) и не часть другого слова.
    const re = new RegExp("(?<![\\w$.])" + name + "(?![\\w$]|\\s*:(?!:))");
    if (re.test(s)) problems.push(`${me}: ${name} (есть в ${[...owners].join(", ")})`);
  }
}

if (problems.length) {
  console.log("  ✗ " + problems.join("\n  ✗ "));
  process.exitCode = 1;
} else {
  console.log("  всё подключено");
}
