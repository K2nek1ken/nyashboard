import { db, doc, getDoc, setDoc, updateDoc, deleteField, serverTimestamp } from "./firebase.js";
import { currentUser } from "./auth.js";
import { parseBets, getWallet, colorOf } from "./casino.js";

// ============================================================
//  Общий круг ставок
//
//  Несколько человек делают ставки, потом кто-нибудь пишет «.го» —
//  и колесо крутится один раз на всех.
//
//  Круг живёт в общем документе: так все видят одни и те же ставки,
//  и результат получается честно общим, а не у каждого свой.
//
//  Запустить можно не раньше чем через десять секунд после первой
//  ставки — иначе тот, кто поставил первым, успел бы крутануть до того,
//  как остальные сообразили.
// ============================================================

const ROUND_DOC = () => doc(db, "casino", "round");
const MIN_WAIT = 10 * 1000;      // столько ждём после первой ставки
const MAX_PLAYERS = 10;          // больше не влезет в сообщение
const ROUND_LIFE = 10 * 60 * 1000;   // брошенный круг сам истекает

export async function placeBet(text, nickname) {
  if (!currentUser) throw new Error("Ставки привязаны к аккаунту — нужно войти");

  const bets = parseBets(text);
  if (!bets.length) {
    throw new Error("Не поняла ставку. Например: «ставка 100 чёт»");
  }

  const wallet = await getWallet();
  const total = bets.reduce((sum, b) => sum + (b.amount === "all" ? wallet.balance : b.amount), 0);
  if (total > wallet.balance) {
    throw new Error(`Не хватает: ставишь ${total}¢, а есть ${wallet.balance}¢`);
  }

  const round = await readRound();
  const players = Object.keys(round.bets || {});

  if (!players.includes(currentUser.uid) && players.length >= MAX_PLAYERS) {
    throw new Error(`В круге уже ${MAX_PLAYERS} человек — дождись следующего`);
  }

  // Ставки складываем в том виде, в каком их можно посчитать позже:
  // функции сюда не положишь, поэтому храним сумму и название.
  const mine = bets.map(b => ({
    amount: b.amount === "all" ? wallet.balance : b.amount,
    kind: b.kind
  }));

  await setDoc(ROUND_DOC(), {
    startedAt: round.startedAt || serverTimestamp(),
    bets: { ...(round.bets || {}), [currentUser.uid]: { nickname, list: mine } }
  }, { merge: true });

  return { total, count: players.length + (players.includes(currentUser.uid) ? 0 : 1) };
}

export async function readRound() {
  try {
    const snap = await getDoc(ROUND_DOC());
    if (!snap.exists()) return {};

    const data = snap.data();
    const at = data.startedAt?.toMillis?.() || 0;

    // Круг, про который забыли, не должен висеть вечно.
    if (at && Date.now() - at > ROUND_LIFE) return {};
    return data;
  } catch {
    return {};
  }
}

// Сколько осталось ждать до запуска.
export async function waitLeft() {
  const round = await readRound();
  const at = round.startedAt?.toMillis?.() || 0;
  if (!at) return null;                 // круга нет
  return Math.max(0, MIN_WAIT - (Date.now() - at));
}

export async function clearRound() {
  await updateDoc(ROUND_DOC(), { bets: deleteField(), startedAt: deleteField() })
    .catch(() => {});
}

// Правила ставок нужны, чтобы понять, выиграла ли она. Названия те же,
// что показывает разбор, — по ним и сверяем.
export function checkBet(kind, number) {
  const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

  if (kind === "красное")  return number > 0 && RED.has(number);
  if (kind === "чёрное")   return number > 0 && !RED.has(number);
  if (kind === "чётное")   return number > 0 && number % 2 === 0;
  if (kind === "нечётное") return number % 2 === 1;
  if (kind === "малое")    return number >= 1 && number <= 18;
  if (kind === "большое")  return number >= 19 && number <= 36;
  if (kind === "зеро")     return number === 0;

  const single = /^число (\d{1,2})$/.exec(kind);
  if (single) return number === Number(single[1]);

  const range = /^(\d{1,2})–(\d{1,2})$/.exec(kind);
  if (range) return number >= Number(range[1]) && number <= Number(range[2]);

  return false;
}

// Выплата по названию ставки — та же логика, что при одиночной игре.
export function payoutOf(kind) {
  if (/^число /.test(kind) || kind === "зеро") return 36;

  const range = /^(\d{1,2})–(\d{1,2})$/.exec(kind);
  if (range) {
    const count = Number(range[2]) - Number(range[1]) + 1;
    return Math.max(2, Math.floor(36 / count));
  }
  return 2;
}

export { colorOf, MIN_WAIT, MAX_PLAYERS };
