import {
  auth, googleProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut, onAuthStateChanged, signInAnonymously
} from "./firebase.js";
import { ensureUserDoc } from "./data.js";
import { paletteColor } from "./palette.js";
import { showToast, setGenderSource, gendered } from "./ui.js";
import { getSettings } from "./settings.js";
import { positionNear } from "./anchor.js";
import { applyAvatar, avatarHtml } from "./avatar.js";
import { defaultAvatar } from "./default-avatar.js";

export let currentUser = null;      // firebase auth user (или null)
export let currentUserDoc = null;   // документ users/{uid} (или null)

// ============================================================
//  Кэш профиля
//
//  Восстановление сессии Firebase — асинхронное и занимает сотни миллисекунд.
//  Всё это время currentUser === null, и интерфейс честно, но неприятно
//  показывает «ты не вошёл»: при каждой перезагрузке страницы и переключении
//  вкладки это выглядит как самопроизвольный выход из аккаунта.
//
//  Поэтому последний известный профиль кладётся в localStorage и подставляется
//  сразу, ещё до ответа Firebase. Это только для отрисовки: любые действия
//  всё равно ждут authReady и проверяются правилами базы, так что подделать
//  вход подменой кэша нельзя — сервер такой запрос отклонит.
// ============================================================
const PROFILE_CACHE_KEY = "nyash_profile_cache";

// Пол для родовых окончаний: у вошедших берём из профиля, у гостей — из
// локальных настроек, чтобы интерфейс говорил правильно и без аккаунта.
setGenderSource(() => currentUserDoc?.gender || cachedUserDoc?.gender || getSettings().gender || "x");

function readProfileCache() {
  try { return JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY)); }
  catch { return null; }
}

function writeProfileCache(doc) {
  if (doc) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(doc));
  else localStorage.removeItem(PROFILE_CACHE_KEY);
}

// оптимистичный профиль до ответа Firebase — только для мгновенной отрисовки
export let cachedUserDoc = readProfileCache();

// true, пока Firebase ещё не сказал своё слово
export let authPending = true;

// Резолвится РОВНО ОДИН РАЗ, когда Firebase окончательно определился с состоянием
// авторизации (реальный юзер или анонимная гостевая сессия). До этого момента
// currentUser может быть null просто потому, что Firebase ещё не ответил —
// а не потому, что человек реально не залогинен. Страницы, которым нужно знать
// "залогинен ли человек" ДО первого рендера (мои каналы, роль в канале и т.д.),
// обязаны сначала дождаться этого промиса.
let resolveAuthReady;
export const authReady = new Promise((resolve) => { resolveAuthReady = resolve; });

const listeners = [];
export function onAuthChange(cb) { listeners.push(cb); }
export function emitAuthChange() {
  listeners.forEach(cb => cb(currentUser, currentUserDoc));

  // Сообщаем всей странице: после входа меняется шапка (в ней появляется
  // аватарка), а от её высоты зависит, сколько места держать под плеером.
  window.dispatchEvent(new CustomEvent("nyash:auth", {
    detail: { signedIn: !!currentUser }
  }));
}

// используется profile.js после сохранения профиля, чтобы обновить локальный кэш
// без похода в базу второй раз
export function patchCurrentUserDoc(patch) {
  currentUserDoc = { ...currentUserDoc, ...patch };
  cachedUserDoc = currentUserDoc;
  writeProfileCache(currentUserDoc);
  emitAuthChange();
}

// Каждый посетитель (даже без Google-аккаунта) получает анонимную firebase-сессию.
// Это НЕ аккаунт и никак не палит личность — нужно только чтобы Firestore Rules
// могли отличать "хоть кто-то из приложения" от голых запросов к API снаружи.
onAuthStateChanged(auth, async (fbUser) => {
  if (!fbUser) {
    // Если только что вернулись со страницы входа, гостя не заводим:
    // настоящий вход придёт следующим, а гостевой перебил бы его —
    // человек подтверждал вход и всё равно оставался анонимом.
    let waiting = false;
    try { waiting = sessionStorage.getItem("nyash_signing_in") === "1"; } catch {}
    if (waiting) return;

    await signInAnonymously(auth);
    return;   // повторно вызовет этот же колбэк
  }
  if (fbUser.isAnonymous) {
    currentUser = null;
    currentUserDoc = null;
    cachedUserDoc = null;
    writeProfileCache(null);
  } else {
    currentUser = fbUser;
    try {
      currentUserDoc = await ensureUserDoc(fbUser);
    } catch (e) {
      // Раньше любая ошибка здесь (например, не задеплоенные правила для
      // userNuids) роняла весь обработчик: аккаунт в базе создавался, а
      // интерфейс так и оставался в состоянии «не вошёл». Теперь вход
      // доводится до конца с тем, что есть, а проблема просто пишется в консоль.
      console.error("Профиль не догрузился:", e);
      // ВАЖНО: подставляем заглушку, но помечаем её как неполную. Раньше эти
      // придуманные значения попадали в форму профиля, и первое же сохранение
      // записывало их поверх настоящих данных — ник, аватарка и описание
      // затирались. Теперь сохранение такой профиль не пропустит.
      currentUserDoc = {
        uid: fbUser.uid,
        username: "",
        nickname: fbUser.displayName || "",
        avatarUrl: fbUser.photoURL || "",
        _incomplete: true,
        _error: e.message
      };
      showToast("Профиль не загрузился: " + e.message);
    }
    cachedUserDoc = currentUserDoc;
    if (!currentUserDoc._incomplete) writeProfileCache(currentUserDoc);
  }
  authPending = false;
  emitAuthChange();
  if (resolveAuthReady) { resolveAuthReady(); resolveAuthReady = null; }
});

// Вход — всплывающим окном Google, везде.
//
// Переходом на страницу Google (с возвратом обратно) пользоваться нельзя:
// сайт живёт на github.io, а вход идёт через firebaseapp.com — разные
// адреса. Браузеры на телефоне блокируют обмен данными между ними, и
// после возврата вход просто не завершается: человек подтверждает, а
// остаётся гостем. Всплывающее окно общается с сайтом напрямую, и это
// ограничение его не касается.
//
// Переход остаётся лишь запасным путём — если браузер окно заблокировал.
let signingIn = false;

export async function loginWithGoogle() {
  // Повторное нажатие, пока окно открыто, сорвало бы вход: браузер
  // закрывает первое окно и открывает второе, а результат теряется.
  if (signingIn) return;
  signingIn = true;

  try {
    // Окно открываем сразу, без единого ожидания до этого: иначе браузер
    // решит, что его открывает не человек, и заблокирует.
    await signInWithPopup(auth, googleProvider);
    showToast(`Вош${gendered("ёл", "ла", "ёл(ла)")} ♡`);
  } catch (e) {
    console.error(e);
    const code = e.code || "";

    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
      showToast("Вход отменён");
    } else if (code === "auth/popup-blocked") {
      showToast("Браузер заблокировал окно — пробую иначе…");
      try { sessionStorage.setItem("nyash_signing_in", "1"); } catch {}
      try { await signInWithRedirect(auth, googleProvider); return; } catch {}
      showToast("Разреши всплывающие окна для сайта и попробуй снова");
    } else if (code === "auth/network-request-failed") {
      showToast("Нет связи — попробуй ещё раз");
    } else {
      showToast("Не получилось войти: " + e.message);
    }
  } finally {
    signingIn = false;
  }
}

// Разбираем возвращение со страницы Google.
//
// Без этого вход вроде бы проходит, но приложение об этом не узнаёт:
// человек подтверждает, возвращается — и снова гость.
getRedirectResult(auth)
  .then(result => {
    try { sessionStorage.removeItem("nyash_signing_in"); } catch {}
    if (result?.user) showToast(`Вош${gendered("ёл", "ла", "ёл(ла)")} ♡`);
    else ensureGuest();     // не вход — значит обычный заход, нужен гость
  })
  .catch(e => {
    try { sessionStorage.removeItem("nyash_signing_in"); } catch {}
    if (e.code !== "auth/no-auth-event") console.warn("Возврат со входа:", e.message);
    ensureGuest();
  });

// Заводит гостевой вход, если человек не вошёл. Вызывается после того,
// как стало ясно: возврата со страницы входа не будет.
async function ensureGuest() {
  if (auth.currentUser) return;
  try { await signInAnonymously(auth); } catch (e) {
    console.warn("Гостевой вход:", e.message);
  }
}

export async function logout() {
  await signOut(auth);
  showToast(`Выш${gendered("ел", "ла", "ел(ла)")}`);
}

// Маленькая выпадашка у иконки профиля в шапке — есть на КАЖДОЙ странице.
// Полноценное редактирование профиля живёт отдельно, на странице profile.html.
// Аватарка в меню — со всем оформлением, как везде: раньше здесь стояла
// голая картинка без рамки и украшения.
function paintDropdownAvatar(user) {
  // Обёртку ищем по её идентификатору: картинка внутри заменяется при каждой
  // отрисовке, и ссылка на неё после этого ведёт в никуда.
  const wrap = document.getElementById("ddAvatarWrap");
  if (!wrap) {
    const img = document.getElementById("ddAvatar");
    if (img) img.src = user?.avatarUrl || defaultAvatar();
    return;
  }

  wrap.innerHTML = avatarHtml({
    ...user,
    accessory: user?.accessory || "none",
    avatarBorder: user?.avatarBorder || "pink"
  }, 42);
}

export function initProfileDropdown() {
  // Нажатие по пункту меню закрывает его сразу: страница больше не
  // перезагружается, и раньше меню оставалось висеть до следующего нажатия
  // где-нибудь ещё.
  document.getElementById("profileDropdown")?.addEventListener("click", (e) => {
    if (e.target.closest("a, .dropdownBtn, #logoutBtn")) {
      document.getElementById("profileDropdown")?.classList.add("hidden");
    }
  });

  const dropdown = document.getElementById("profileDropdown");
  const profileIcon = document.getElementById("profileIcon");
  const profilePic = document.getElementById("profilePic");
  if (!dropdown || !profileIcon) return;

  const loggedOutView = dropdown.querySelector("#ddLoggedOut");
  const loggedInView = dropdown.querySelector("#ddLoggedIn");
  const ddAvatar = dropdown.querySelector("#ddAvatar");
  const ddNickname = dropdown.querySelector("#ddNickname");
  const ddUsername = dropdown.querySelector("#ddUsername");

  profileIcon.addEventListener("click", (e) => {
    e.stopPropagation();
    refreshDropdown();
    dropdown.classList.toggle("hidden");
    if (!dropdown.classList.contains("hidden")) {
      // На широком экране положение известно заранее: колонка навигации всегда
      // одной ширины и прижата к левому краю. Считать его каждый раз незачем —
      // вычисления только промахивались. Поэтому там позицию задаёт стиль,
      // а расчёт остаётся для телефона, где иконка стоит в строке сверху
      // и её место зависит от ширины экрана.
      const wide = window.matchMedia("(min-width: 900px)").matches;
      if (wide) {
        dropdown.style.position = "";
        dropdown.style.top = dropdown.style.left = "";
        dropdown.style.transform = "";
      } else {
        positionNear(dropdown, profileIcon, { prefer: "bottom", align: "right" });
      }
    }
  });

  document.addEventListener("click", (e) => {
    if (!dropdown.classList.contains("hidden") && !dropdown.contains(e.target) && e.target !== profileIcon) {
      dropdown.classList.add("hidden");
    }
  });

  const loginBtn = dropdown.querySelector("#googleLoginBtn");
  if (loginBtn) loginBtn.addEventListener("click", loginWithGoogle);

  const logoutBtn = dropdown.querySelector("#logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", async () => {
    await logout();
    dropdown.classList.add("hidden");
  });

  function refreshDropdown() {
    // пока Firebase восстанавливает сессию — рисуем по кэшу, чтобы не мигало «не вошёл»
    const shown = currentUserDoc || (authPending ? cachedUserDoc : null);
    if (shown) {
      loggedOutView.classList.add("hidden");
      loggedInView.classList.remove("hidden");
      paintDropdownAvatar(shown);
      ddNickname.textContent = shown.nickname || "";
      // свой ник тоже своего цвета — как его видят другие
      ddNickname.style.color = shown.nickColor ? paletteColor(shown.nickColor) : "";
      ddUsername.textContent = "@" + (shown.username || "");
      return;
    }
    if (currentUser && currentUserDoc) {
      loggedOutView.classList.add("hidden");
      loggedInView.classList.remove("hidden");
      paintDropdownAvatar(currentUserDoc);
      ddNickname.textContent = currentUserDoc.nickname || "";
      // свой ник тоже своего цвета — как его видят другие
      ddNickname.style.color = currentUserDoc.nickColor ? paletteColor(currentUserDoc.nickColor) : "";
      ddUsername.textContent = "@" + (currentUserDoc.username || "");
    } else {
      loggedOutView.classList.remove("hidden");
      loggedInView.classList.add("hidden");
    }
  }

  // аватарка в шапке — сразу из кэша, до ответа Firebase
  // Аватарку в шапке ставим через общий помощник: он снимает пометку
  // «сгенерированная», иначе при смене темы своя картинка подменялась анонимом.
  function paintHeaderAvatar() {
    const doc = currentUserDoc || (authPending ? cachedUserDoc : null);
    // Кнопка профиля показывает то же, что видят другие: аватарку с рамкой
    // и украшением. Раньше украшение туда не попадало, и своё оформление
    // можно было увидеть только в чужих глазах.
    const wrap = profilePic.closest(".avatar-wrap") || profilePic.parentElement;
    applyAvatar(profilePic, doc, doc ? "neko" : "anon");
    profilePic.style.width = profilePic.style.height = "";
    if (wrap) wrap.classList.add("avatar-wrap");
  }

  paintHeaderAvatar();
  refreshDropdown();

  onAuthChange(() => {
    paintHeaderAvatar();
    if (!dropdown.classList.contains("hidden")) refreshDropdown();
  });
}
