import { remember, recall } from "./session-state.js";

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

    const app = document.getElementById("app");
    const fresh = new DOMParser().parseFromString(html, "text/html");
    const freshApp = fresh.getElementById("app");
    if (!freshApp) throw new Error("на странице нет содержимого");

    app.innerHTML = freshApp.innerHTML;
    document.title = fresh.title || document.title;
    currentPath = page;
    window.scrollTo({ top: 0 });

    const module = await ROUTES[page]();
    currentModule = module;
    await module.initPage?.();

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

async function loadPage(page) {
  if (htmlCache.has(page)) return htmlCache.get(page);
  const res = await fetch(page, { cache: "no-cache" });
  if (!res.ok) throw new Error(`страница не загрузилась (${res.status})`);
  const html = await res.text();
  htmlCache.set(page, html);
  return html;
}
