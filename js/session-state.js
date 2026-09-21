// ============================================================
//  Память между страницами
//
//  Сайт состоит из отдельных страниц, поэтому переход между вкладками — это
//  полная перезагрузка: сбрасывается и подвкладка, и положение на странице,
//  и проигрывание.
//
//  Здесь то, что должно это пережить. Хранится в браузере, читается сразу
//  при запуске — до того, как страница успеет отрисоваться.
//
//  Это половина пути к настоящему единому приложению: остаётся перезагрузка,
//  но её последствия человек больше не замечает.
// ============================================================

const KEY = "nyash_session";

function read() {
  try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}

function write(data) {
  try { sessionStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}

export function remember(key, value) {
  const data = read();
  data[key] = value;
  write(data);
}

export function recall(key, fallback = null) {
  const value = read()[key];
  return value === undefined ? fallback : value;
}

// ---------- положение на странице ----------
// Ключ включает адрес: у каждой вкладки своё место, куда человек вернётся.

// Страницы, для которых слушатель уже повешен. Раньше он вешался при
// каждом заходе и не снимался никогда — слушатели копились, а старые
// продолжали писать положение уже ДРУГОЙ страницы в память этой:
// листаешь ленту — а запоминается «прокрутка чата». При возврате
// страница прокручивалась на чужое число и упиралась в низ.
const watchedScroll = new Set();

export function keepScrollPosition() {
  const path = location.pathname + location.search;
  const key = "scroll:" + path;

  // Восстанавливаем после отрисовки: до неё страница ещё нулевой высоты
  // и прокручивать некуда.
  const saved = recall(key, 0);
  if (saved > 0) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      // За два кадра человек мог уйти на другую страницу — тогда не трогаем.
      if (location.pathname + location.search === path) window.scrollTo({ top: saved });
    }));
  }

  if (watchedScroll.has(key)) return;
  watchedScroll.add(key);

  // Пишем только пока открыта именно эта страница.
  const here = () => location.pathname + location.search === path;

  let timer = null;
  window.addEventListener("scroll", () => {
    if (!here()) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (here()) remember(key, Math.round(window.scrollY)); }, 250);
  }, { passive: true });

  window.addEventListener("pagehide", () => {
    if (here()) remember(key, Math.round(window.scrollY));
  });
}
