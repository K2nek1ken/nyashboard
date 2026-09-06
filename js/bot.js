import { gendered } from "./ui.js";

// ============================================================
//  Бот чата
//
//  Работает целиком на клиенте: сообщение разбирается перед отправкой, и если
//  это команда — вместо обычного сообщения отправляется готовая фраза с
//  пометкой, что её собрал бот. Ни сервера, ни Cloud Functions, ни копейки.
//
//  Честное следствие такого подхода: логика лежит в браузере, поэтому
//  технически её можно обойти и отправить что угодно вручную. Для шуточных
//  команд это неважно — тут нечего защищать.
//
//  Команда срабатывает, если сообщение начинается со слова из списка и при
//  этом оно отправлено в ответ на чьё-то сообщение (кроме команд без цели).
// ============================================================

const COMMANDS = [
  {
    names: ["обнять", "обними"],
    needsTarget: true,
    text: (a, b) => `${a} обня${gendered("л", "ла", "л(а)")} ${b} ♡`
  },
  {
    names: ["погладить", "погладь"],
    needsTarget: true,
    text: (a, b) => `${a} поглади${gendered("л", "ла", "л(а)")} ${b}`
  },
  {
    names: ["пнуть", "пни"],
    needsTarget: true,
    text: (a, b) => `${a} пну${gendered("л", "ла", "л(а)")} ${b}`
  },
  {
    names: ["укусить", "укуси"],
    needsTarget: true,
    text: (a, b) => `${a} укуси${gendered("л", "ла", "л(а)")} ${b}`
  },
  {
    names: ["покормить", "покорми"],
    needsTarget: true,
    text: (a, b) => `${a} накорми${gendered("л", "ла", "л(а)")} ${b}`
  },
  {
    names: ["трахнуть", "трахни"],
    needsTarget: true,
    text: (a, b) => `${a} трахну${gendered("л", "ла", "л(а)")} ${b}`
  },
  {
    names: ["мяукнуть", "мяу"],
    needsTarget: false,
    text: (a) => `${a} мяукнул${gendered("", "а", "(а)")}`
  },
  {
    names: ["кубик", "кинуть", "кинь"],
    needsTarget: false,
    text: (a) => {
      const n = Math.floor(Math.random() * 6) + 1;
      return `${a} бросает кубик: выпало ${n}`;
    }
  },
  {
    names: ["монетка", "орёл"],
    needsTarget: false,
    text: (a) => `${a} подбрасывает монетку: ${Math.random() < 0.5 ? "орёл" : "решка"}`
  }
];

export function listCommands() {
  return COMMANDS.map(c => ({
    name: c.names[0],
    needsTarget: c.needsTarget,
    aliases: c.names
  }));
}

// Разбирает текст. Возвращает готовую фразу либо null, если это не команда.
// author — ник отправителя, target — ник того, кому отвечают (может быть пуст).
export function parseCommand(text, author, target) {
  const clean = (text || "").trim().toLowerCase();
  if (!clean) return null;

  const first = clean.split(/\s+/)[0].replace(/[!.,]+$/, "");
  const cmd = COMMANDS.find(c => c.names.includes(first));
  if (!cmd) return null;

  if (cmd.needsTarget && !target) {
    return { error: `Команда «${first}» работает только в ответ на чьё-то сообщение` };
  }
  return { text: cmd.text(author, target) };
}
