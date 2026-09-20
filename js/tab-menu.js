import { escapeHtml } from "./ui.js";
import { ICON } from "./icons.js";
import { TAB_LABELS } from "./settings.js";

// ============================================================
//  Меню вкладки
//
//  Держишь палец на вкладке — появляется меню: заглушить её уведомления,
//  отметить всё прочитанным, переставить вкладки местами.
//
//  Остальной экран при этом размывается: меню маленькое, и без этого
//  непонятно, что происходит и чего от тебя ждут.
//
//  Второе нажатие по той же вкладке закрывает меню — так же, как его
//  открыло. Это привычнее, чем искать, куда ткнуть, чтобы оно исчезло.
// ============================================================

const HOLD_MS = 450;        // столько держать, чтобы меню появилось
const MOVE_TOLERANCE = 10;  // палец дрогнул — это всё ещё удержание

let openFor = null;         // для какой вкладки меню открыто сейчас

export function wireTabMenu(host) {
  if (!host || host.dataset.menuWired) return;
  host.dataset.menuWired = "1";

  host.querySelectorAll("[data-tab]").forEach(tab => {
    let timer = null;
    let startX = 0, startY = 0;
    let fired = false;

    const cancel = () => { clearTimeout(timer); timer = null; };

    tab.addEventListener("pointerdown", (e) => {
      // Меню уже открыто для этой вкладки — нажатие закрывает его.
      if (openFor === tab.dataset.tab) {
        closeMenu();
        fired = true;
        return;
      }

      fired = false;
      startX = e.clientX;
      startY = e.clientY;

      // Удержание — способ для пальца. На компьютере это только мешало бы:
      // задержался с нажатием — и вместо перехода получил меню.
      // Там для этого правая кнопка.
      if (window.matchMedia("(min-width: 900px)").matches) return;

      timer = setTimeout(() => {
        fired = true;
        openMenu(tab);
      }, HOLD_MS);
    });

    tab.addEventListener("pointermove", (e) => {
      // Палец поехал — значит человек прокручивает, а не держит.
      if (!timer) return;
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE) cancel();
    });

    tab.addEventListener("pointerup", cancel);
    tab.addEventListener("pointercancel", cancel);
    tab.addEventListener("pointerleave", cancel);

    // Если меню открылось, обычный переход по вкладке не нужен.
    tab.addEventListener("click", (e) => {
      if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
    }, true);

    // На компьютере то же самое по правой кнопке — там удерживать неудобно.
    tab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openFor === tab.dataset.tab ? closeMenu() : openMenu(tab);
    });

    // Средняя кнопка ничего не открывает: ею обычно открывают в новой
    // вкладке браузера, и отнимать это незачем.
  });
}

function openMenu(tab) {
  closeMenu();

  const key = tab.dataset.tab;
  const name = TAB_LABELS[key] || key;
  const muted = isMuted(key);

  // Подложка и меню — отдельно: подложка лежит под шапкой, чтобы та
  // осталась чёткой, а меню поверх неё.
  const veil = document.createElement("div");
  veil.className = "tab-menu-screen";
  document.body.appendChild(veil);

  const box = document.createElement("div");
  box.innerHTML = `
    <div class="tab-menu">
      <div class="tab-menu-title">${escapeHtml(name)}</div>

      <button class="tab-menu-item" data-act="mute">
        <span class="nf">${muted ? ICON.smile : ICON.hidden}</span>
        <span>${muted ? "Включить уведомления" : "Отключить уведомления"}</span>
      </button>

      <button class="tab-menu-item" data-act="read">
        <span class="nf">${ICON.check}</span>
        <span>Отметить прочитанным</span>
      </button>

      <button class="tab-menu-item" data-act="order">
        <span class="nf">${ICON.gear}</span>
        <span>Переставить вкладки</span>
      </button>

      <button class="tab-menu-item tab-menu-cancel" data-act="cancel">
        <span>Отмена</span>
      </button>
    </div>`;

  const menu = box.firstElementChild;
  document.body.appendChild(menu);
  openFor = key;

  placeUnder(menu, tab);

  // Подсвечиваем ту вкладку, о которой речь: меню маленькое, и без этого
  // через секунду забываешь, что именно держал.
  tab.classList.add("tab-menu-source");

  menu.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;

    if (act === "mute")  toggleMute(key);
    if (act === "read")  markRead(key);
    if (act === "order") openTabOrder();
    closeMenu();
  });

  // Нажатие мимо меню закрывает его.
  veil.addEventListener("click", closeMenu);
}

function closeMenu() {
  document.querySelector(".tab-menu-source")?.classList.remove("tab-menu-source");
  openFor = null;

  const veil = document.querySelector(".tab-menu-screen");
  const menu = document.querySelector(".tab-menu");

  veil?.classList.add("closing");
  menu?.classList.add("closing");

  setTimeout(() => { veil?.remove(); menu?.remove(); }, 200);
}

// Ставит меню под вкладкой, не давая выйти за края экрана.
function placeUnder(menu, tab) {
  const t = tab.getBoundingClientRect();
  const width = menu.offsetWidth || 260;

  // По центру вкладки, но с отступом от краёв: крайние вкладки
  // иначе увели бы меню за экран.
  let left = t.left + t.width / 2 - width / 2;
  left = Math.max(10, Math.min(left, window.innerWidth - width - 10));

  menu.style.left = `${Math.round(left)}px`;

  // Обычно под вкладкой. Если внизу места нет — над ней.
  const below = t.bottom + 8;
  const fits = below + menu.offsetHeight < window.innerHeight - 10;

  if (fits) {
    menu.style.top = `${Math.round(below)}px`;
  } else {
    menu.style.top = "auto";
    menu.style.bottom = `${Math.round(window.innerHeight - t.top + 8)}px`;
  }
}

// ---------- что делают пункты ----------

function mutedTabs() {
  try {
    return new Set(JSON.parse(localStorage.getItem("nyash_muted_tabs") || "[]"));
  } catch { return new Set(); }
}

function isMuted(key) { return mutedTabs().has(key); }

export function tabIsMuted(key) { return mutedTabs().has(key); }

function toggleMute(key) {
  const set = mutedTabs();
  set.has(key) ? set.delete(key) : set.add(key);

  try { localStorage.setItem("nyash_muted_tabs", JSON.stringify([...set])); } catch {}

  import("./ui.js").then(({ showToast }) =>
    showToast(set.has(key) ? "Уведомления отключены" : "Уведомления включены")
  );

  // Гасим отметку сразу, не дожидаясь следующей проверки.
  import("./notifications.js").then(m => m.paintTabDots?.()).catch(() => {});
}

function markRead(key) {
  import("./notifications.js").then(({ markTabSeen }) => {
    markTabSeen(key);
    import("./ui.js").then(({ showToast }) => showToast("Отмечено прочитанным"));
  }).catch(() => {});
}

function openTabOrder() {
  // Порядок вкладок настраивается на странице настроек — туда и ведём.
  // Вкладки там в своём разделе, поэтому передаём его в адресе.
  location.href = "settings.html#tabs";
}
