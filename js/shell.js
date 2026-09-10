import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initSettingsModal } from "./settings-modal.js";
import { applyFavicon } from "./favicon.js";
import { paintTabDots, startTabPolling } from "./notifications.js";
import { startPresence } from "./presence.js";
import { restorePlayback } from "./player.js";
import { initProfileDropdown } from "./auth.js";

// ============================================================
//  Оболочка сайта
//
//  Всё, что живёт поверх вкладок и не должно пересоздаваться при переходах:
//  шапка, оформление, частицы, плеер, проверка новых событий, отметка
//  присутствия.
//
//  Запускается ровно один раз за жизнь страницы. Это важно: при переходе
//  роутер подгружает модуль другой вкладки, и без защиты его общая часть
//  выполнилась бы заново — плеер дёрнулся бы на сохранённое место, а опросы
//  сервера и отметки присутствия удвоились бы с каждым переходом.
// ============================================================

let started = false;

export function initShell() {
  if (started) return;
  started = true;

  applySettings();
  initLayout();          // шапка рисуется сразу, до отрисовки содержимого
  applyFavicon();
  restorePlayback();     // продолжаем то, что играло раньше
  paintTabDots();
  startTabPolling();
  startPresence();

  // Остальное — после того, как разметка страницы разобрана
  const rest = () => {
    initSettingsModal();
    initStarfield();
    initProfileDropdown();
  };
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", rest, { once: true });
  } else {
    rest();
  }
}
