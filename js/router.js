import { remember, recall } from "./session-state.js";
import { showToast } from "./ui.js";

// ============================================================
//  Переходы без перезагрузки
//
//  Каждая вкладка остаётся отдельной страницей — прямые ссылки, закладки и
//  открытие в новой вкладке работают как раньше. Но переход внутри сайта
//  больше не перезагружает всё: подгружается только содержимое нужной
//  страницы и вставляется на место текущего.
//
//  Что это даёт: шапка, оформление и проигрывание не сбрасываются, переход
//  ощущается мгновенным.
//
//  Устройство:
//    • у каждой страницы есть модуль с двумя действиями — начать и свернуться
//    • при уходе обязательно сворачиваемся: иначе живые подписки на базу
//      останутся висеть, и каждый переход добавлял бы новую
//    • разметка страниц кэшируется: второй раз она уже не загружается
// ============================================================

// Какие страницы умеют работать без перезагрузки и какими модулями заведуются.
const ROUTES = {
  "index.html":       () => import("./feed-page.js"),
  "chat.html":        () => import("./chat-page.js"),
  "friends.html":     () => import("./friends-page.js"),
  "content.html":     () => import("./content-page.js"),
  "people.html":      () => import("./people-page.js"),
  "about.html":       () => import("./about-page.js"),
  "settings.html":    () => import("./settings-page.js"),
  "profile.html":     () => import("./profile-page.js"),
  "my-music.html":    () => import("./my-music-page.js"),
  "my-channels.html": () => import("./my-channels-page.js"),
  // страницы с параметрами в адресе: им нужен разбор адреса при запуске
  "user.html":        () => import("./user-page.js"),
  "channel.html":     () => import("./channel-page.js"),
  "post.html":        () => import("./post-page.js"),
  "dm.html":          () => import("./dm-page.js"),
  "tag.html":         () => import("./tag-page.js")
};

const htmlCache = new Map();
let currentModule = null;
let currentPath = pageName(location.pathname);
let navigating = false;

function pageName(pathname) {
  const name = pathname.split("/").pop();
  return name || "index.html";
}

export function initRouter(module) {
  currentModule = module;

  // Клики по внутренним ссылкам перехватываем, остальные оставляем браузеру:
  // внешние ссылки, новые вкладки и скачивание должны работать как обычно.
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[href]");
    if (!link) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (link.target === "_blank" || link.hasAttribute("download")) return;

    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;

    const page = pageName(url.pathname);
    if (!ROUTES[page]) return;                 // страница без поддержки — обычный переход

    e.preventDefault();
    navigate(page + url.search);               // параметры сохраняем: их читает сама страница
  });

  // Кнопка «назад» браузера
  window.addEventListener("popstate", () => {
    const page = pageName(location.pathname);
    // Плеер при возврате не должен ни останавливаться, ни отматываться:
    // страница не перезагружается, значит звук просто продолжает идти.
    if (ROUTES[page]) swap(page, { push: false });
    else location.reload();
  });
}

export async function navigate(target) {
  const [page, search = ""] = target.split("?");
  const full = page + (search ? "?" + search : "");
  if (navigating || full === currentPath + location.search) return;

  history.pushState({ page: full }, "", full);
  await swap(page, { push: false });
}

async function swap(page, { push = true } = {}) {
  if (navigating) return;
  navigating = true;
  document.body.classList.add("page-leaving");

  try {
    const html = await loadPage(page);

    // Сворачиваем прошлую страницу до подмены разметки: её обработчики
    // ссылаются на элементы, которых сейчас не станет.
    try { currentModule?.destroyPage?.(); } catch (e) { console.warn("Не свернулось:", e); }

    // Открытые окна и меню относятся к покидаемой вкладке: они висят в общем
    // слое поверх страницы, поэтому сами бы не закрылись и остались бы
    // поверх новой.
    document.querySelectorAll(".modal, .lightbox, .composer-screen").forEach(el => {
      if (el.id === "settingsModal") return;   // настройки открываются поверх любой вкладки
      if (el.dataset.persistent) return;       // окно, которое закрывает только человек
      // Здесь убираем сразу: страница уже сменилась, и провожать окно
      // анимацией не за чем — она проигралась бы поверх новой вкладки.
      el.remove();
    });
    document.body.classList.remove("composer-open");
    // Развёрнутый плеер закрывать не нужно: он относится к музыке, а она
    // играет поверх всех вкладок. Закрывает его только сам человек.
    document.querySelectorAll(
      ".kebabMenu:not(.hidden), .cselect-menu:not(.hidden), " +
      ".player-menu:not(.hidden), .profile-dropdown:not(.hidden)"
    ).forEach(el => el.classList.add("hidden"));

    const app = document.getElementById("app");
    const fresh = new DOMParser().parseFromString(html, "text/html");
    const freshApp = fresh.getElementById("app");
    if (!freshApp) throw new Error("на странице нет содержимого");

    app.innerHTML = freshApp.innerHTML;
    swapPageExtras(fresh);
    document.title = fresh.title || document.title;
    currentPath = page;
    window.scrollTo({ top: 0 });

    const module = await ROUTES[page]();
    currentModule = module;

    // Ошибку внутри вкладки не превращаем в перезагрузку: разметка уже
    // подставлена, и полная загрузка только скроет причину. Показываем её
    // и остаёмся на месте — так поломка видна и чинится, а не маскируется.
    try {
      await module.initPage?.();

      // Сообщаем остальным, что страница сменилась: плееру, например,
      // нужно заново посчитать, на сколько отодвинуть содержимое.
      window.dispatchEvent(new CustomEvent("nyash:page", { detail: { page } }));
    } catch (e) {
      console.error(`Вкладка ${page} не запустилась:`, e);
      showToast("Что-то пошло не так на этой вкладке");
    }

    // Подсветка активной вкладки — её рисует навигация, а она не перезагружалась
    document.querySelectorAll(".navBtn").forEach(btn => {
      btn.classList.toggle("active", pageName(new URL(btn.href, location.href).pathname) === page);
    });
    remember("lastPage", page);
  } catch (e) {
    console.error("Переход не удался, гружу страницу целиком:", e);
    location.href = page;                      // запасной путь: обычная загрузка
  } finally {
    document.body.classList.remove("page-leaving");
    navigating = false;
  }
}

// Не всё содержимое страницы лежит внутри #app: закреплённые панели —
// поле ввода чата, панель ответа, выбор личности — стоят рядом с ним, потому
// что должны прилипать к низу экрана. При переходе их тоже нужно заменить,
// иначе на новой вкладке их просто нет (а старые остаются от прошлой).
// Не всё содержимое страницы лежит внутри #app: закреплённые панели, окна
// настроек, выбор людей — всё это стоит рядом с ним, потому что должно
// накрывать страницу целиком или прилипать к краю экрана.
//
// Раньше здесь был список таких элементов, и каждая новая страница добавляла
// в него что-то своё. Забыть было легко: окна канала в списке не оказалось,
// и при переходе на него они просто не появлялись — страница падала на первом
// же обращении к ним.
//
// Поэтому теперь переносится всё, что лежит рядом с #app, кроме общего для
// всех страниц: шапки, всплывающих сообщений, меню профиля.

// Что принадлежит оболочке и живёт на всех страницах сразу.
const SHELL_IDS = new Set([
  "navHost", "toast", "profileDropdown", "settingsModal", "starfield", "nowPlaying",
  // Распорка под плеером: она не принадлежит странице, а держит место
  // под тем, что висит поверх всех вкладок сразу. Убрать её при переходе —
  // значит на новой вкладке плеер снова накроет содержимое.
  "playerSpacer"
]);

function isShellNode(el) {
  if (!el || el.nodeType !== 1) return true;
  if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "LINK") return true;
  if (el.id && SHELL_IDS.has(el.id)) return true;
  if (el.classList?.contains("player-bar")) return true;
  if (el.classList?.contains("confetti-layer")) return true;
  return false;
}

function swapPageExtras(freshDoc) {
  const app = document.getElementById("app");
  if (!app) return;

  // Убираем всё, что осталось от прошлой страницы. Помечаем перенесённое:
  // так видно, что именно принадлежит странице, а что было на месте
  // изначально — без пометки легко было оставить лишнее.
  document.querySelectorAll("[data-page-extra]").forEach(el => el.remove());

  [...document.body.children].forEach(el => {
    if (el === app || isShellNode(el)) return;
    el.remove();
  });

  // Переносим в конец страницы и по порядку. Раньше каждый элемент
  // вставлялся сразу после #app, и порядок получался обратный —
  // панели накладывались друг на друга.
  const freshApp = freshDoc.getElementById("app");
  for (const el of freshDoc.body.children) {
    if (el === freshApp || isShellNode(el)) continue;

    // Перед вставкой убираем всё, что уже носит такой же идентификатор:
    // иначе на странице оказывались две одинаковые панели, и код работал
    // с первой, а человек видел вторую.
    const copy = el.cloneNode(true);
    for (const node of [copy, ...copy.querySelectorAll("[id]")]) {
      if (!node.id) continue;
      document.querySelectorAll(`[id="${node.id}"]`).forEach(old => {
        if (!old.closest("#app")) old.remove();
      });
    }

    copy.dataset.pageExtra = "1";
    document.body.appendChild(copy);
  }
}

async function loadPage(page) {
  if (htmlCache.has(page)) return htmlCache.get(page);
  const res = await fetch(page, { cache: "no-cache" });
  if (!res.ok) throw new Error(`страница не загрузилась (${res.status})`);
  const html = await res.text();
  htmlCache.set(page, html);
  return html;
}


// Переход из кода — для случаев, где нет ссылки: нажатие по строке списка,
// переход после действия. Раньше такие места вызывали location.href напрямую,
// и страница перезагружалась целиком со сбросом плеера.
export function goTo(target) {
  const page = target.split("?")[0].split("#")[0];
  if (!ROUTES[page]) { location.href = target; return; }   // страница без поддержки
  navigate(target);
}
