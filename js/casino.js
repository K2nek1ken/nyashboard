import { db, doc, getDoc, setDoc, updateDoc, serverTimestamp, increment } from "./firebase.js";
import { currentUser } from "./auth.js";

// ============================================================
//  Кошелёк и рулетка
//
//  Монеты живут в базе, привязаны к человеку и считаются на сервере —
//  иначе баланс правился бы в консоли за пять секунд, и смысла в игре
//  не осталось бы.
//
//  Ставки разбираются из текста: «казик 10 к» — десять на красное.
//  Несколько ставок через «&&» или «&»: «казино 10 ч && 20 одд».
// ============================================================

const START_BALANCE = 100;
const BONUS_MIN = 10;
const BONUS_MAX = 50;
const DAY = 24 * 60 * 60 * 1000;

// Выплаты как в настоящей рулетке: чем реже случай, тем больше выигрыш.
const BETS = {
  красное:  { match: (n) => n > 0 && isRed(n),        payout: 2, names: ["к", "красное", "red", "кр"] },
  чёрное:   { match: (n) => n > 0 && !isRed(n),       payout: 2, names: ["ч", "чёрное", "черное", "black", "чер"] },
  чётное:   { match: (n) => n > 0 && n % 2 === 0,     payout: 2, names: ["чёт", "чет", "ивен", "even"] },
  нечётное: { match: (n) => n % 2 === 1,              payout: 2, names: ["нечёт", "нечет", "одд", "odd"] },
  малое:    { match: (n) => n >= 1 && n <= 18,        payout: 2, names: ["мало", "малое", "low"] },
  большое:  { match: (n) => n >= 19 && n <= 36,       payout: 2, names: ["много", "большое", "high"] },
  зеро:     { match: (n) => n === 0,                  payout: 36, names: ["зеро", "zero", "0"] }
};

// Красные числа на европейском колесе — порядок не по возрастанию, поэтому списком.
const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function isRed(n) { return RED.has(n); }

// ---------- кошелёк ----------

export async function getWallet() {
  if (!currentUser) throw new Error("Нужен аккаунт: кошелёк привязан к нему");

  const ref = doc(db, "wallets", currentUser.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    // Первый заход — выдаём стартовые монеты.
    await setDoc(ref, { balance: START_BALANCE, bonusAt: 0, createdAt: serverTimestamp() });
    return { balance: START_BALANCE, bonusAt: 0 };
  }
  return snap.data();
}

export async function dailyBonus() {
  const wallet = await getWallet();
  const last = wallet.bonusAt?.toMillis?.() || wallet.bonusAt || 0;
  const left = DAY - (Date.now() - last);

  if (left > 0) {
    const hours = Math.ceil(left / (60 * 60 * 1000));
    throw new Error(`Бонус уже брали. Следующий через ${hours} ч`);
  }

  const amount = BONUS_MIN + Math.floor(Math.random() * (BONUS_MAX - BONUS_MIN + 1));
  await updateDoc(doc(db, "wallets", currentUser.uid), {
    balance: increment(amount),
    bonusAt: serverTimestamp()
  });
  return amount;
}

export async function giftCoins(toUid, amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Сколько именно подарить?");
  if (toUid === currentUser?.uid) throw new Error("Себе дарить незачем");

  const wallet = await getWallet();
  if (wallet.balance < amount) throw new Error(`Не хватает: у тебя ${wallet.balance}¢`);

  // Получателю кошелёк заводим, если его ещё нет — иначе подарок пропал бы.
  const toRef = doc(db, "wallets", toUid);
  const toSnap = await getDoc(toRef);
  if (!toSnap.exists()) {
    await setDoc(toRef, { balance: START_BALANCE + amount, bonusAt: 0, createdAt: serverTimestamp() });
  } else {
    await updateDoc(toRef, { balance: increment(amount) });
  }

  await updateDoc(doc(db, "wallets", currentUser.uid), { balance: increment(-amount) });
  return amount;
}

// ---------- разбор ставок ----------

export function parseBets(text) {
  const parts = text.split(/&&?|,/).map(p => p.trim()).filter(Boolean);
  const bets = [];

  for (const part of parts) {
    const words = part.split(/\s+/);
    // «олл 10» — всё на что-то; «10 к» — десять на красное
    // «олл», «оллин», «олл-ин», «ва-банк», «all in» — всё это одно и то же
    const allIn = /^(олл|олл-?ин|all|all-?in|ва-?банк)$/i.test(words[0]);
    const amountWord = allIn ? null : words[0];
    const target = (allIn ? words[1] : words[1])?.toLowerCase();

    const amount = allIn ? "all" : parseInt(amountWord, 10);
    if (!allIn && (!Number.isInteger(amount) || amount <= 0)) continue;
    if (!target) continue;

    // Диапазон: «10-20». Выплата тем больше, чем уже диапазон —
    // как и на настоящем колесе, где ставка на один номер даёт больше всего.
    const range = /^(\d{1,2})[-–—](\d{1,2})$/.exec(target);
    if (range) {
      const from = Math.min(+range[1], +range[2]);
      const to = Math.max(+range[1], +range[2]);
      if (from >= 0 && to <= 36) {
        const count = to - from + 1;
        bets.push({
          amount,
          kind: `${from}–${to}`,
          match: (n) => n >= from && n <= to,
          // 36 делим на число попаданий: ставка на половину колеса даёт
          // около двойного, на один номер — тридцатишестикратный.
          payout: Math.max(2, Math.floor(36 / count))
        });
        continue;
      }
    }

    // ставка на конкретное число, включая зеро
    const asNumber = parseInt(target, 10);
    if (!isNaN(asNumber) && String(asNumber) === target && asNumber >= 0 && asNumber <= 36) {
      bets.push({ amount, kind: "число " + asNumber, match: (n) => n === asNumber, payout: 36 });
      continue;
    }

    const found = Object.entries(BETS).find(([, b]) => b.names.includes(target));
    if (found) {
      const [kind, b] = found;
      bets.push({ amount, kind, match: b.match, payout: b.payout });
    }
  }
  return bets;
}

// ---------- игра ----------

export async function spinRoulette(text) {
  const bets = parseBets(text);
  if (!bets.length) {
    throw new Error("Не поняла ставку. Например: «казик 10 к» или «казино 10 ч && 20 одд»");
  }

  const wallet = await getWallet();
  let balance = wallet.balance;

  // «олл» ставит всё, что осталось на этот момент
  const resolved = bets.map(b => {
    const amount = b.amount === "all" ? balance : b.amount;
    return { ...b, amount };
  });

  const total = resolved.reduce((sum, b) => sum + b.amount, 0);
  if (total > balance) throw new Error(`Не хватает: ставишь ${total}¢, а есть ${balance}¢`);
  if (total <= 0) throw new Error("Ставка должна быть больше нуля");

  const number = Math.floor(Math.random() * 37);   // 0..36
  const color = number === 0 ? "зеро" : (isRed(number) ? "красное" : "чёрное");

  let won = 0;
  const lines = [];
  for (const b of resolved) {
    const hit = b.match(number);

    // Французское правило: при зеро ставки на равные шансы — цвет,
    // чётное/нечётное, половина колеса — не сгорают целиком, а возвращаются
    // наполовину. Половина ставки, а не выигрыша: уйти в плюс на зеро
    // нельзя, но и потерять всё — тоже.
    //
    // Отличаем такие ставки по выплате: она ровно двойная только у них.
    const halfBack = !hit && number === 0 && b.payout === 2;
    const gain = hit ? b.amount * b.payout : (halfBack ? Math.floor(b.amount / 2) : 0);

    won += gain;
    lines.push({
      amount: b.amount, kind: b.kind, payout: b.payout,
      hit, gain, halfBack
    });
  }

  const delta = won - total;

  await updateDoc(doc(db, "wallets", currentUser.uid), { balance: increment(delta) });

  // Выпадение уходит в общую историю чата, а не в свой кошелёк: смысл её
  // в том, чтобы видеть, что выпадало у всех. Не записалось — не страшно,
  // игра от этого не ломается.
  await pushToHistory(number).catch(e => console.warn("История:", e.message));

  return { number, color, lines, total, won, delta, balance: balance + delta };
}

// Русская рулетка: один шанс из семи. Без ставок и без денег.
export function russianRoulette() {
  return Math.floor(Math.random() * 7) === 0 ? "dead" : "alive";
}


// ---------- общая история ----------
//
// Одна на весь чат: интересно именно то, что выпадало у всех, а не у тебя
// одного. Лежит в одном документе — так её можно прочитать за одно
// обращение, и место она занимает крошечное.

const HISTORY_SIZE = 10;
const HISTORY_DOC = () => doc(db, "casino", "history");

// Записывает выпадение в общую историю — нужно и одиночной игре,
// и общему кругу.
export async function pushSpin(number) {
  return pushToHistory(number);
}

// Начисляет итог круга. Отдельно от обычной ставки: там человек играет
// за себя, а здесь колесо крутит кто-то один, а считается всем.
export async function settleRound(uid, delta) {
  if (!delta) return;
  await updateDoc(doc(db, "wallets", uid), { balance: increment(delta) });
}

async function pushToHistory(number) {
  const snap = await getDoc(HISTORY_DOC());
  const spins = snap.exists() ? (snap.data().spins || []) : [];
  const next = [number, ...spins].slice(0, HISTORY_SIZE);

  await setDoc(HISTORY_DOC(), { spins: next }, { merge: true });
}

export async function spinHistory() {
  try {
    const snap = await getDoc(HISTORY_DOC());
    return snap.exists() ? (snap.data().spins || []) : [];
  } catch {
    return [];
  }
}

// Цвет числа — нужен, чтобы показать историю цветными кружками.
export function colorOf(n) {
  if (n === 0) return "zero";
  return isRed(n) ? "red" : "black";
}
