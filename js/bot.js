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

// Прошедшее время с учётом пола: «обнял» / «обняла» / «обнял(а)».
const past = (m, f) => gendered(m, f, `${m}(${f.slice(m.length) || "а"})`);

const COMMANDS = [
  // ---------- тёплое ----------
  { names: ["обнять", "обними", "обнимашки"], needsTarget: true,
    text: (a, b) => `${a} ${past("обнял", "обняла")} ${b} ♡` },

  { names: ["погладить", "погладь"], needsTarget: true,
    text: (a, b) => `${a} ${past("погладил", "погладила")} ${b}` },

  { names: ["пат-пат", "патпат", "пат"], needsTarget: true,
    text: (a, b) => `${a} делает ${b} пат-пат ♡ (๑˃ᴗ˂)ﾉ` },

  { names: ["поцеловать", "поцелуй", "чмок"], needsTarget: true,
    text: (a, b) => `${a} ${past("поцеловал", "поцеловала")} ${b} ♡` },

  { names: ["покормить", "покорми"], needsTarget: true,
    text: (a, b) => `${a} ${past("покормил", "покормила")} ${b}` },

  { names: ["кусь", "куснуть", "кусни"], needsTarget: true,
    text: (a, b) => `${a} делает ${b} кусь! (＾• ω •＾)` },

  { names: ["укусить", "укуси"], needsTarget: true,
    text: (a, b) => `${a} ${past("укусил", "укусила")} ${b}` },

  { names: ["облизать", "оближи"], needsTarget: true,
    text: (a, b) => `${a} ${past("облизал", "облизала")} ${b}` },

  // ---------- шуточная расправа ----------
  { names: ["ударить", "ударь"], needsTarget: true,
    text: (a, b) => `${a} ${past("ударил", "ударила")} ${b}` },

  { names: ["уебать", "уебал"], needsTarget: true,
    text: (a, b) => `${a} ${past("уебал", "уебала")} ${b}` },

  { names: ["шлёпнуть", "шлепнуть", "шлёпни", "шлепни"], needsTarget: true,
    text: (a, b) => `${a} ${past("шлёпнул", "шлёпнула")} ${b}` },

  { names: ["выпороть", "выпори"], needsTarget: true,
    text: (a, b) => `${a} ${past("выпорол", "выпорола")} ${b}` },

  { names: ["убить", "убей"], needsTarget: true,
    text: (a, b) => `${a} ${past("убил", "убила")} ${b}` },

  { names: ["расстрелять", "расстреляй"], needsTarget: true,
    text: (a, b) => `${a} ${past("расстрелял", "расстреляла")} ${b}` },

  { names: ["зарубить", "заруби"], needsTarget: true,
    text: (a, b) => `${a} ${past("зарубил", "зарубила")} ${b}` },

  { names: ["сжечь", "сожги"], needsTarget: true,
    text: (a, b) => `${a} ${past("сжёг", "сожгла")} ${b}` },

  { names: ["отравить", "отрави"], needsTarget: true,
    text: (a, b) => `${a} ${past("отравил", "отравила")} ${b}` },

  { names: ["взорвать", "взорви"], needsTarget: true,
    text: (a, b) => `${a} ${past("взорвал", "взорвала")} ${b}` },

  { names: ["уничтожить", "уничтожь"], needsTarget: true,
    text: (a, b) => `${a} ${past("уничтожил", "уничтожила")} ${b}` },

  { names: ["порвать", "порви"], needsTarget: true,
    text: (a, b) => `${a} ${past("порвал", "порвала")} ${b}` },

  { names: ["кастрировать", "кастрируй"], needsTarget: true,
    text: (a, b) => `${a} ${past("кастрировал", "кастрировала")} ${b}` },

  { names: ["закопать", "закопай"], needsTarget: true,
    text: (a, b) => `${a} ${past("закопал", "закопала")} ${b}` },

  { names: ["повесить", "повесь"], needsTarget: true,
    text: (a, b) => `${a} ${past("повесил", "повесила")} ${b}` },

  // ---------- прочее ----------
  { names: ["связать", "свяжи"], needsTarget: true,
    text: (a, b) => `${a} ${past("связал", "связала")} ${b}` },

  { names: ["арестовать", "арестуй"], needsTarget: true,
    text: (a, b) => `${a} ${past("арестовал", "арестовала")} ${b}` },

  { names: ["продать", "продай"], needsTarget: true,
    text: (a, b) => `${a} ${past("продал", "продала")} ${b} за ${Math.floor(Math.random() * 500) + 10}¢` },

  // «дать леща», «дать ядерную боеголовку» — что угодно после слова
  { names: ["дать", "дай"], needsTarget: true, takesRest: true,
    text: (a, b, rest) => rest
      ? `${a} ${past("дал", "дала")} ${rest} ${b}`
      : `${a} ${past("дал", "дала")} что-то ${b}` },

  // ---------- без цели ----------
  { names: ["мяу", "мяукнуть"], needsTarget: false,
    text: (a) => `${a} ${past("мяукнул", "мяукнула")}` },

  { names: ["команды", "помощь", "хелп"], needsTarget: false, isHelp: true }
];

export function parseCommand(text, author, target) {
  const raw = (text || "").trim();
  if (!raw) return null;

  // Знаки в конце допускаются: «обнять!» — всё ещё команда.
  const clean = raw.replace(/[!.,?…\s]+$/u, "");
  const lower = clean.toLowerCase();

  // Сначала точное совпадение: сообщение состоит из одной команды.
  let cmd = COMMANDS.find(c => c.names.includes(lower));
  let rest = "";

  // Потом команды с продолжением: «дать леща». Берём первое слово и смотрим,
  // не команда ли это — остальное уходит в текст.
  if (!cmd) {
    const firstSpace = lower.indexOf(" ");
    if (firstSpace > 0) {
      const head = lower.slice(0, firstSpace);
      const candidate = COMMANDS.find(c => c.takesRest && c.names.includes(head));
      if (candidate) {
        cmd = candidate;
        rest = clean.slice(firstSpace + 1).trim();
      }
    }
  }

  if (!cmd) return null;

  // Список команд — отдельный случай: цель не нужна, и текст собирается сам.
  if (cmd.isHelp) return { text: helpText() };

  if (cmd.needsTarget && !target) {
    return { error: `Команда «${lower}» работает только в ответ на чьё-то сообщение` };
  }
  return { text: cmd.text(author, target, rest) };
}

// Список команд по «.команды». Собирается из самого списка, чтобы не
// расходиться с ним: добавил команду — она сразу здесь.
function helpText() {
  const withTarget = [];
  const alone = [];

  for (const c of COMMANDS) {
    if (c.isHelp) continue;
    const name = c.names[0] + (c.takesRest ? " <что-нибудь>" : "");
    (c.needsTarget ? withTarget : alone).push(name);
  }

  return [
    "Команды бота",
    "",
    "В ответ на чьё-то сообщение:",
    withTarget.join(" · "),
    "",
    "Просто так:",
    alone.join(" · "),
    "",
    "У многих есть короткая форма: «обними», «погладь», «кусни»."
  ].join("\n");
}

// Все названия команд — нужны подсказке при наборе.
export function commandNames() {
  return COMMANDS.flatMap(c => c.names);
}
