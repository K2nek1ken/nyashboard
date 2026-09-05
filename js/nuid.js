import { db, doc, getDoc, setDoc, collection, query, where, getDocs } from "./firebase.js";

// ============================================================
//  NUID — публичный человекочитаемый идентификатор (U1xxxxxx / U4xxxxxx)
//
//  Хранится отдельно от профиля, потому что документ users/{uid} читается
//  публично целиком: будь NUID внутри него, любая «приватность» сводилась бы
//  к тому, что значение просто не рисуют на экране, хотя оно уже пришло
//  в браузер. Здесь же отказ выдаёт сама база.
//
//  Схема:
//    userNuids/{uid}   { publicUid }  — читается по настройке приватности
//    nuidIndex/{NUID}  { uid, type }  — get разрешён, list запрещён
// ============================================================

export function maskNuid(nuid) {
  if (!nuid) return "U1••••••";
  return nuid.slice(0, 2) + "••••••";
}

export function generateNuid(prefixDigit) {
  let digits = "";
  for (let i = 0; i < 6; i++) digits += Math.floor(Math.random() * 10);
  return `U${prefixDigit}${digits}`;
}

// Свободен ли идентификатор — проверяется по индексу, а не перебором профилей.
export async function isNuidFree(nuid) {
  const snap = await getDoc(doc(db, "nuidIndex", nuid));
  return !snap.exists();
}

// Никогда не бросает исключение. Если индекс недоступен (например, правила ещё
// не залиты), берём случайный идентификатор без проверки: пространство в миллион
// значений, совпадение крайне маловероятно, а вот сорвать из-за этого создание
// аккаунта — совершенно недопустимо. Раньше именно так и происходило: NUID не
// подбирался, исключение летело вверх, и профиль не создавался вообще.
export async function generateUniqueNuid(prefixDigit) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateNuid(prefixDigit);
    try {
      if (await isNuidFree(candidate)) return candidate;
    } catch (e) {
      console.warn("Индекс NUID недоступен, беру идентификатор без проверки:", e.message);
      return candidate;
    }
  }
  return generateNuid(prefixDigit);
}

// Записывает идентификатор и индекс. Вызывается один раз при создании аккаунта.
export async function registerNuid(uid, nuid, type = "user") {
  await Promise.all([
    setDoc(doc(db, "userNuids", uid), { publicUid: nuid }),
    setDoc(doc(db, "nuidIndex", nuid), { uid, type })
  ]);
}

// Запрос чужого NUID. Возвращает строку либо null, если владелец закрыл доступ —
// в этом случае значение не приходит в браузер вообще, база отвечает отказом.
export async function requestNuid(uid) {
  try {
    const snap = await getDoc(doc(db, "userNuids", uid));
    return snap.exists() ? snap.data().publicUid : null;
  } catch {
    return null;   // permission-denied — значит просматривать не разрешено
  }
}

// Поиск профиля по известному идентификатору: один точечный запрос по индексу.
// Перечислить индекс целиком правила не дают, так что чужие NUID так не собрать.
export async function resolveNuid(nuid) {
  const clean = (nuid || "").trim().toUpperCase();
  if (!/^U[14]\d{6}$/.test(clean)) return null;
  try {
    const snap = await getDoc(doc(db, "nuidIndex", clean));
    return snap.exists() ? snap.data() : null;
  } catch {
    return null;
  }
}

// Разовый перенос для аккаунтов, созданных до появления отдельного хранилища:
// у них идентификатор всё ещё лежит в users/{uid}.publicUid.
// Идентификатор владельца передаётся аргументом, а не берётся из состояния
// авторизации: иначе получалась круговая зависимость модулей
// (авторизация → данные → идентификаторы → снова авторизация).
export async function migrateLegacyNuid(uid, userDoc) {
  if (!uid || !userDoc?.publicUid) return;
  const existing = await getDoc(doc(db, "userNuids", uid)).catch(() => null);
  if (existing?.exists()) return;
  await registerNuid(uid, userDoc.publicUid, "user").catch(() => {});
}

// Досоздание идентификатора для аккаунтов, у которых он не записался при
// регистрации (например, из-за незалитых правил). Вызывается при входе.
export async function ensureNuidExists(uid) {
  try {
    const existing = await getDoc(doc(db, "userNuids", uid));
    if (existing.exists()) return existing.data().publicUid;
    const nuid = await generateUniqueNuid(1);
    await registerNuid(uid, nuid, "user");
    return nuid;
  } catch (e) {
    console.warn("Не смогла досоздать NUID:", e.message);
    return null;
  }
}
