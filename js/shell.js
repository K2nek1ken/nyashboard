import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initSettingsModal } from "./settings-modal.js";
import { applyFavicon } from "./favicon.js";
import { paintTabDots, startTabPolling } from "./notifications.js";
import { startPresence } from "./presence.js";
import { restorePlayback } from "./player.js";
import { initProfileDropdown } from "./auth.js";
import { initNuidCopy } from "./copy-nuid.js";
import { startPersonalWatch } from "./notify-feed.js";

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

  // Тестовая сборка помечается сразу: полоса сверху не даст перепутать её
  // с рабочим сайтом.
  import("./version.js").then(({ isBeta }) => {
    if (isBeta()) document.body.classList.add("is-beta");
  }).catch(() => {});

  applySettings();
  initLayout();          // шапка рисуется сразу, до отрисовки содержимого
  applyFavicon();
  restorePlayback();     // продолжаем то, что играло раньше
  paintTabDots();
  startTabPolling();
  startPresence();
  startPersonalWatch();   // лайки, ответы, заявки, личка

  // Свои каналы: нужны везде, где показываются записи, чтобы их можно было
  // править и удалять. Загружаем один раз здесь, а не в каждой вкладке.
  import("./auth.js").then(({ authReady }) => authReady).then(async () => {
    try {
      const [{ fetchManagedChannelIds }, { setManagedChannels }] = await Promise.all([
        import("./channels.js"), import("./feed.js")
      ]);
      setManagedChannels(await fetchManagedChannelIds() || []);
    } catch (e) {
      console.warn("Свои каналы не загрузились:", e.message);
    }
  });

  // Отметку присутствия прекращаем при уходе: продолжать отмечаться
  // с закрытой страницы незачем.
  window.addEventListener("pagehide", () => {
    import("./presence.js").then(({ stopPresence }) => stopPresence()).catch(() => {});
    import("./notify-feed.js").then(({ stopPersonalWatch }) => stopPersonalWatch()).catch(() => {});
  });

  // Остальное — после того, как разметка страницы разобрана
  initNuidCopy();     // нажатие по номеру копирует его — на любой странице

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
