import { gendered } from "./ui.js";
import { COMMANDS } from "./modules/bot-commands.js";

// ============================================================
//  Движок бота
//
//  Здесь только разбор: как понять, что человек написал команду, как
//  подставить имена и склонить глагол. Сами команды лежат в bot-commands.js —
//  их можно править, не заглядывая сюда.
//
//  Работает целиком в браузере: сообщение разбирается перед отправкой, и если
//  это команда — вместо обычного сообщения уходит готовая фраза с пометкой
//  бота. Ни сервера, ни оплаты.
//
//  Честное следствие: логика в браузере, значит её можно обойти и отправить
//  что угодно вручную. Для шуточных команд это неважно — тут нечего защищать.
//  Всё, где важна честность (кошелёк, ставки), проверяется правилами базы.
// ============================================================

// Склонение по полу: «обнял|обняла» → нужная форма.
// Для гостей без указанного пола получается «обнял(а)».
function conjugate(form) {
  const [m, f] = String(form).split("|");

  // Одна форма — значит она и нужна, как написана. Это удобно для слов
  // без рода: «крутанул барабан» склоняется, а «мяу» — нет.
  if (!f) return m;
  const both = m + "(" + (f.startsWith(m) ? f.slice(m.length) : f) + ")";
  return gendered(m, f, both);
}

// Склонение по полу для команд со своим текстом: past("дал", "дала").
export const past = (m, f) => conjugate(`${m}|${f}`);

// Собирает готовую фразу из описания команды.
function build(rule, kind, author, target, rest) {
  const recipe = rule[kind];

  // Своим текстом тоже нужно склонение: четвёртым даём помощника,
  // чтобы можно было написать past("дал", "дала").
  if (typeof recipe === "function") return recipe(author, target, rest, past);

  const verb = conjugate(recipe);
  const tail = rule.tail ? ` ${rule.tail}` : "";
  return kind === "self"
    ? `${author} ${verb}${tail}`
    : `${author} ${verb} ${target}${tail}`;
}

// Какие команды отключены. Список задаёт владелец в настройках через запятую.
function blockedSet() {
  try {
    const raw = JSON.parse(localStorage.getItem("nyash_settings") || "{}").blockedCommands || "";
    return new Set(raw.split(/[,\n]/).map(x => x.trim().toLowerCase()).filter(Boolean));
  } catch { return new Set(); }
}

const isBlocked = (rule, blocked) => rule.cmd.some(n => blocked.has(n));

// Свои команды подмешиваются к встроенным. Держим их отдельно и обновляем
// при входе: разбор должен оставаться быстрым и не ходить в базу.
let customRules = [];

export function setCustomRules(rules) { customRules = rules || []; }

export function parseCommand(text, author, target) {
  const raw = (text || "").trim();
  if (!raw) return null;

  // Точка, слэш или восклицательный знак в начале — привычный способ
  // отмечать команду: «.команды», «/обнять». Убираем их, чтобы такие
  // сообщения тоже срабатывали.
  //
  // Знаки в конце тоже допускаются: «обнять!» — всё ещё команда.
  const clean = raw
    .replace(/^[./!]+/u, "")
    .replace(/[!.,?…\s]+$/u, "");
  const lower = clean.toLowerCase();

  // Свои команды идут первыми: человек добавил их сам, значит и ждёт
  // именно их — даже если имя совпало со встроенной.
  const all = [...customRules, ...COMMANDS];

  // Сначала точное совпадение: сообщение состоит из одной команды.
  let rule = all.find(c => c.cmd.includes(lower));
  let rest = "";

  // Потом команды с продолжением: «дать леща», «казик 10 к».
  if (!rule) {
    const space = lower.indexOf(" ");
    if (space > 0) {
      const head = lower.slice(0, space);
      const candidate = all.find(c => c.rest && c.cmd.includes(head));
      if (candidate) {
        rule = candidate;
        rest = clean.slice(space + 1).trim();
      }
    }
  }

  if (!rule) return null;

  // Отключённая команда ведёт себя так, будто её нет: сообщение уйдёт
  // обычным текстом, а не превратится в ошибку.
  if (isBlocked(rule, blockedSet())) return null;

  if (rule.help) return { text: helpText() };

  // Цель нужна всем командам с «to», кроме тех, что помечены иначе.
  const needsTarget = rule.needsTarget ?? !!rule.to;
  if (needsTarget && !target) {
    return { error: `Команда «${lower}» работает только в ответ на чьё-то сообщение` };
  }

  // Команды с кошельком требуют базы — отдаём их наверх.
  if (rule.runs) return { async: rule.runs, rest, author, target };

  const kind = rule.self ? "self" : "to";
  return { text: build(rule, kind, author, target, rest) };
}

// Список команд по «.команды». Собирается из самого набора, поэтому
// не расходится с ним: добавил команду — она сразу здесь.
function helpText() {
  const blocked = blockedSet();
  const withTarget = [];
  const alone = [];

  for (const rule of [...customRules, ...COMMANDS]) {
    if (rule.help || isBlocked(rule, blocked)) continue;
    const name = rule.cmd[0] + (rule.rest ? " …" : "") + (rule.custom ? "*" : "");
    ((rule.needsTarget ?? !!rule.to) ? withTarget : alone).push(name);
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
    "У многих есть короткая форма: «обними», «погладь», «кусни».",
    customRules.length ? "\nСо звёздочкой — твои: добавить «+бот имя форма|форма», убрать «-бот имя»."
                       : "\nСвою команду: «+бот обнимашки обнял|обняла»"
  ].join("\n");
}

// Список команд для окна подсказки — тот же текст, что и по «.команды».
export function commandsHelp() {
  return helpText();
}

// Все названия — нужны подсказке при наборе.
export function commandNames() {
  return COMMANDS.flatMap(c => c.cmd);
}

// ============================================================
//  Команды, которым нужна база
// ============================================================

export async function runAsyncCommand(kind, { rest, author, target, targetUid }) {
  const casino = await import("./casino.js");
  const past = (m, f) => conjugate(`${m}|${f}`);

  try {
    switch (kind) {
      case "balance": {
        const w = await casino.getWallet();
        return { text: `У ${author} на счету ${w.balance}¢` };
      }
      case "bonus": {
        const amount = await casino.dailyBonus();
        const w = await casino.getWallet();
        return { text: `${author} ${past("получил", "получила")} бонус: +${amount}¢ (всего ${w.balance}¢)` };
      }
      case "gift": {
        if (!targetUid) return { error: "Подарить можно только вошедшему — у гостя нет кошелька" };
        const given = await casino.giftCoins(targetUid, parseInt(rest, 10));
        return { text: `${author} ${past("подарил", "подарила")} ${target} ${given}¢` };
      }
      case "roulette": {
        const dead = casino.russianRoulette() === "dead";
        return dead
          ? { text: `${author} ${past("крутанул", "крутанула")} барабан… выстрел. Минута молчания`, effect: "dead" }
          : { text: `${author} ${past("крутанул", "крутанула")} барабан… щелчок. Повезло!`, effect: "alive" };
      }
      case "casino": {
        const r = await casino.spinRoulette(rest);
        const sign = r.delta >= 0 ? "+" : "";

        // Пишем как рассказывают: кто поставил, что выпало, чем кончилось.
        // Раньше был сухой перечень без имени — в общем чате непонятно,
        // чей это результат.
        const bets = r.lines.length === 1
          ? r.lines[0]
          : r.lines.join(", ");

        return { text: [
          `${author} ${past("поставил", "поставила")} ${bets}. Выпало ${r.number} (${r.color})`,
          `${sign}${r.delta}¢, остаток: ${r.balance}¢`
        ].join("\n") };
      }
    }
  } catch (e) {
    return { error: e.message };
  }
  return null;
}
