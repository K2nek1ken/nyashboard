import {
  auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously
} from "./firebase.js";
import { ensureUserDoc } from "./data.js";
import { showToast, setGenderSource, gendered } from "./ui.js";
import { getSettings } from "./settings.js";
import { positionNear } from "./anchor.js";
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
export function emitAuthChange() { listeners.forEach(cb => cb(currentUser, currentUserDoc)); }

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
  if (!fbUser) { await signInAnonymously(auth); return; } // повторно вызовет этот же колбэк
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

export async function loginWithGoogle() {
  try {
    await signInWithPopup(auth, googleProvider);
    showToast(`Вош${gendered("ёл", "ла", "ёл(ла)")} ♡`);
  } catch (e) {
    console.error(e);
    showToast("Не получилось войти: " + e.message);
  }
}

export async function logout() {
  await signOut(auth);
  showToast(`Выш${gendered("ел", "ла", "ел(ла)")}`);
}

// Маленькая выпадашка у иконки профиля в шапке — есть на КАЖДОЙ странице.
// Полноценное редактирование профиля живёт отдельно, на странице profile.html.
export function initProfileDropdown() {
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
      // На широком экране иконка стоит внизу боковой колонки, поэтому панель
      // раскрывается вверх и прижимается к левому краю — так она остаётся
      // внутри колонки, а не уползает вниз под остальной интерфейс.
      const wide = window.matchMedia("(min-width: 900px)").matches;
      positionNear(dropdown, profileIcon, {
        prefer: wide ? "top" : "bottom",
        align: wide ? "left" : "right"
      });
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
      ddAvatar.src = shown.avatarUrl || defaultAvatar();
      ddNickname.textContent = shown.nickname || "";
      ddUsername.textContent = "@" + (shown.username || "");
      return;
    }
    if (currentUser && currentUserDoc) {
      loggedOutView.classList.add("hidden");
      loggedInView.classList.remove("hidden");
      ddAvatar.src = currentUserDoc.avatarUrl || defaultAvatar();
      ddNickname.textContent = currentUserDoc.nickname || "";
      ddUsername.textContent = "@" + (currentUserDoc.username || "");
    } else {
      loggedOutView.classList.remove("hidden");
      loggedInView.classList.add("hidden");
    }
  }

  // аватарка в шапке — сразу из кэша, до ответа Firebase
  if (cachedUserDoc?.avatarUrl) profilePic.src = cachedUserDoc.avatarUrl;
  refreshDropdown();

  onAuthChange(() => {
    profilePic.src = (currentUser && currentUserDoc && currentUserDoc.avatarUrl) || defaultAvatar();
    if (!dropdown.classList.contains("hidden")) refreshDropdown();
  });
}
