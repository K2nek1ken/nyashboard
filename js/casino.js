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
    const allIn = /^(олл|all|ва-?банк)$/i.test(words[0]);
    const amountWord = allIn ? null : words[0];
    const target = (allIn ? words[1] : words[1])?.toLowerCase();

    const amount = allIn ? "all" : parseInt(amountWord, 10);
    if (!allIn && (!Number.isInteger(amount) || amount <= 0)) continue;
    if (!target) continue;

    // ставка на конкретное число
    const asNumber = parseInt(target, 10);
    if (!isNaN(asNumber) && asNumber >= 0 && asNumber <= 36 && target !== "0") {
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
    const gain = hit ? b.amount * b.payout : 0;
    won += gain;
    lines.push(`${b.amount}¢ на ${b.kind} — ${hit ? `+${gain}¢` : "мимо"}`);
  }

  const delta = won - total;
  await updateDoc(doc(db, "wallets", currentUser.uid), { balance: increment(delta) });

  return { number, color, lines, total, won, delta, balance: balance + delta };
}

// Русская рулетка: один шанс из семи. Без ставок и без денег.
export function russianRoulette() {
  return Math.floor(Math.random() * 7) === 0 ? "dead" : "alive";
}
