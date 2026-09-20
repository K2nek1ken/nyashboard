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

// Свой знак перед командами — из настроек. Пусто, если не задан.
function commandPrefix() {
  try {
    const raw = JSON.parse(localStorage.getItem("nyash_settings") || "{}").commandPrefix || "";
    return raw.trim().slice(0, 3);   // длиннее трёх знаков — уже не знак
  } catch { return ""; }
}

// Имена команды в том виде, в каком их нужно писать сейчас.
// Со своим знаком точка из имени убирается: «!команды», а не «!.команды».
function namesOf(rule) {
  const prefix = commandPrefix();
  return prefix ? rule.cmd.map(n => n.replace(/^\./, "")) : rule.cmd;
}

export function parseCommand(text, author, target) {
  const raw = (text || "").trim();
  if (!raw) return null;

  // Знаки в конце допускаются: «обнять!» — всё ещё команда.
  let clean = raw.replace(/[!,?…\s]+$/u, "").replace(/\.+$/u, "");

  // Свой знак перед командами, если человек его задал.
  //
  // Смысл в том, чтобы бот вообще не заглядывал в обычные сообщения:
  // с заданным знаком «!» команда — это «!обнять», а просто «обнять» —
  // уже разговор. Точка из имён при этом не нужна: «!команды», а не
  // «!.команды» — два знака подряд выглядели бы нелепо.
  const prefix = commandPrefix();
  if (prefix) {
    if (!clean.startsWith(prefix)) return null;
    clean = clean.slice(prefix.length).trim();
    if (!clean) return null;
  }
  const lower = clean.toLowerCase();

  // Свои команды идут первыми: человек добавил их сам, значит и ждёт
  // именно их — даже если имя совпало со встроенной.
  const all = [...customRules, ...COMMANDS];

  // Сначала точное совпадение: сообщение состоит из одной команды.
  let rule = all.find(c => namesOf(c).includes(lower));
  let rest = "";

  // Потом команды с продолжением: «дать леща», «казик 10 к».
  if (!rule) {
    const space = lower.indexOf(" ");
    if (space > 0) {
      const head = lower.slice(0, space);
      const candidate = all.find(c => c.rest && namesOf(c).includes(head));
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
    const prefix = commandPrefix();
    const shown = prefix ? prefix + namesOf(rule)[0] : rule.cmd[0];
    const name = shown + (rule.rest ? " …" : "") + (rule.custom ? "*" : "");
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
    "Команды с точкой — «.го», «.баланс» — пишутся с ней: так бот не сработает на обычную речь.",
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

// Показывать ли баланс в самом сообщении.
//
// Кошелёк привязан к аккаунту, а ник в чате может быть анонимным — и по
// продолжающемуся остатку видно, что за разными именами один человек.
// Поэтому под анонимом баланс уходит в подсказку, видную только тебе.
function balanceIsPublic(anonymous) {
  if (anonymous) return false;
  try {
    return JSON.parse(localStorage.getItem("nyash_settings") || "{}").publicBalance !== "off";
  } catch { return true; }
}

export async function runAsyncCommand(kind, { rest, author, target, targetUid, anonymous }) {
  const casino = await import("./casino.js");
  const past = (m, f) => conjugate(`${m}|${f}`);

  try {
    switch (kind) {
      case "balance": {
        const w = await casino.getWallet();
        return balanceIsPublic(anonymous)
          ? { text: `У ${author} на счету ${w.balance}¢` }
          : { quiet: `На счету ${w.balance}¢` };   // только тебе
      }

      case "roundBet": {
        const round = await import("./casino-round.js");
        const { total, count } = await round.placeBet(rest, author);
        return {
          quiet: `Ставка принята: ${total}¢. В круге ${count} — пиши «.го», когда все готовы`
        };
      }

      case "roundGo": {
        const round = await import("./casino-round.js");
        const casinoMod = await import("./casino.js");

        const data = await round.readRound();
        const players = Object.entries(data.bets || {});
        if (!players.length) return { quiet: "Ставок пока нет. Начни с «ставка 100 чёт»" };

        const left = await round.waitLeft();
        if (left > 0) {
          return { quiet: `Ещё рано — подожди ${Math.ceil(left / 1000)} с, пусть все поставят` };
        }

        const number = Math.floor(Math.random() * 37);
        const color = round.colorOf(number);
        const marks = { red: "\u{1F534}", black: "\u26AB\uFE0F", zero: "\u{1F7E2}" };

        // Считаем каждому: по строке на ставку, как и договаривались.
        const rows = [];
        for (const [uid, entry] of players) {
          for (const bet of entry.list || []) {
            const hit = round.checkBet(bet.kind, number);
            const payout = round.payoutOf(bet.kind);

            // Французское правило действует и здесь.
            const halfBack = !hit && number === 0 && payout === 2;
            const gain = hit ? bet.amount * payout : (halfBack ? Math.floor(bet.amount / 2) : 0);

            await casinoMod.settleRound(uid, gain - bet.amount).catch(() => {});

            rows.push(
              `${entry.nickname} (${bet.amount}¢, ${bet.kind}) — ` +
              (hit ? "вин" : halfBack ? "зеро, половина назад" : "луз")
            );
          }
        }

        await round.clearRound();
        await casinoMod.pushSpin(number).catch(() => {});

        return {
          wheel: number,
          text: [`выпало: ${number}${marks[color]}`, ...rows].join("\n")
        };
      }

      case "history": {
        const list = await casino.spinHistory();
        if (!list.length) return { quiet: "Рулетку ещё никто не крутил" };

        // У чёрного кружка приходится просить цветной вид отдельно:
        // в шрифте сайта есть свой чёрно-белый глиф, и он перебивает
        // эмодзи — вместо кружка выходила мелкая точка.
        // «\uFE0F» — как раз такая просьба.
        const marks = {
          red:   "\u{1F534}",
          black: "\u26AB\uFE0F",
          zero:  "\u{1F7E2}"
        };
        const rows = list.map(n => `${n}${marks[casino.colorOf(n)]}`).join("\n");

        // История общая, поэтому уходит сообщением: её интересно видеть всем.
        return { text: ["Последние выпадения", rows].join("\n") };
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
        const put = past("поставил", "поставила");

        // Разлиновка: сначала что поставили и чем кончилось, отдельной
        // строкой — что выпало и как изменился счёт. Так читается сразу,
        // без выискивания чисел в сплошном тексте.
        // Сумму выигрыша не повторяем: итог всё равно строкой ниже,
        // и дважды одно число читается как ошибка.
        const bets = r.lines.map(b => {
          const outcome = b.hit ? "вин"
            : b.halfBack ? "зеро, половина назад"
            : "луз";
          return `${b.amount}¢ на ${b.kind} (x${b.payout}) — ${outcome}`;
        });

        const open = balanceIsPublic(anonymous);

        return {
          // Число отдаём наверх: колесо должно остановиться ровно на нём,
          // а не выбирать своё — иначе картинка и результат разойдутся.
          wheel: r.number,
          text: [
            `${author} ${put} ${bets.join("; ")}`,
            open
              ? `выпало: ${r.number} (${r.color}). ${sign}${r.delta}¢, остаток: ${r.balance}¢`
              : `выпало: ${r.number} (${r.color}). ${sign}${r.delta}¢`
          ].join("\n"),
          // Остаток — только себе, если баланс скрыт.
          quiet: open ? null : `Остаток: ${r.balance}¢`
        };
      }
    }
  } catch (e) {
    return { error: e.message };
  }
  return null;
}
