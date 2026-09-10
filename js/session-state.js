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

export function keepScrollPosition() {
  const key = "scroll:" + location.pathname + location.search;

  // Восстанавливаем после отрисовки: до неё страница ещё нулевой высоты
  // и прокручивать некуда.
  const saved = recall(key, 0);
  if (saved > 0) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.scrollTo({ top: saved });
    }));
  }

  let timer = null;
  window.addEventListener("scroll", () => {
    clearTimeout(timer);
    timer = setTimeout(() => remember(key, Math.round(window.scrollY)), 250);
  }, { passive: true });

  window.addEventListener("pagehide", () => remember(key, Math.round(window.scrollY)));
}
