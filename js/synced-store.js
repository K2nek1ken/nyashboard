import { db, doc, getDoc, setDoc } from "./firebase.js";
import { currentUser, authReady, onAccountLeave } from "./auth.js";

// ============================================================
//  Хранилище, привязанное к аккаунту
//
//  Проблема, которую это решает: данные в localStorage привязаны к браузеру,
//  а не к человеку. Зайдя с телефона и с ноутбука, человек получал бы разные
//  рекомендации и разное «уже прочитано» — то есть аккаунт фактически ничего
//  не значил бы.
//
//  Схема: users/{uid}/private/{docName} — приватный документ, читать и писать
//  может только сам владелец. Локальная копия остаётся как мгновенный кэш
//  (чтобы лента ранжировалась не дожидаясь сети) и как единственное хранилище
//  для гостей без аккаунта.
//
//  Запись отложенная: сохранять каждый лайк отдельным запросом — быстрый способ
//  сжечь бесплатный лимит. Копим изменения и пишем пачкой, плюс обязательно
//  сбрасываем при уходе со страницы, чтобы ничего не потерялось.
// ============================================================

const FLUSH_DELAY = 4000;

export function createSyncedStore({ localKey, docName, empty, merge }) {
  let data = readLocal();
  let ready = null;
  let dirty = false;
  let timer = null;

  function readLocal() {
    try { return { ...empty(), ...JSON.parse(localStorage.getItem(localKey)) }; }
    catch { return empty(); }
  }

  function writeLocal() {
    try { localStorage.setItem(localKey, JSON.stringify(data)); } catch {}
  }

  async function pull() {
    await authReady;
    if (!currentUser) return data;   // гость — только локально
    try {
      const snap = await getDoc(doc(db, "users", currentUser.uid, "private", docName));
      if (snap.exists()) {
        // объединяем: то, что накопилось локально до входа, не теряется
        data = merge(snap.data().payload || empty(), data);
      }
      writeLocal();
      // если локальное что-то добавило — отправим при ближайшем сбросе
      dirty = true;
      scheduleFlush();
    } catch (e) {
      console.warn(`Не смогла загрузить ${docName} из аккаунта:`, e.message);
    }
    return data;
  }

  function load() {
    if (!ready) ready = pull();
    return ready;
  }

  function get() { return data; }

  function update(mutator) {
    mutator(data);
    writeLocal();
    dirty = true;
    scheduleFlush();
  }

  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, FLUSH_DELAY);
  }

  async function flush() {
    if (!dirty) return;
    await authReady;
    if (!currentUser) { dirty = false; return; }   // гостю писать некуда
    dirty = false;
    try {
      await setDoc(doc(db, "users", currentUser.uid, "private", docName),
                   { payload: data, updatedAt: Date.now() });
    } catch (e) {
      console.warn(`Не смогла сохранить ${docName}:`, e.message);
      dirty = true;   // попробуем в следующий раз
    }
  }

  function reset() {
    data = empty();
    writeLocal();
    dirty = true;
    flush();
  }

  // Уход со страницы — последний шанс сохранить накопленное
  const onLeave = () => { if (dirty) { clearTimeout(timer); timer = null; flush(); } };
  window.addEventListener("pagehide", onLeave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) onLeave(); });

  // Смена аккаунта не должна тащить чужие данные на это устройство.
  // Именно onAccountLeave, а не onAuthChange: у гостя currentUser всегда null,
  // и на onAuthChange локальные данные стирались бы при каждой загрузке.
  onAccountLeave(() => {
    data = empty();
    writeLocal();
    ready = null;
    dirty = false;
  });

  return { load, get, update, flush, reset };
}
