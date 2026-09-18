import { initShell } from "./shell.js";
import { clearPending } from "./notify-feed.js";
import { markTabSeen, keepTabSeen } from "./notifications.js";
import { keepScrollPosition } from "./session-state.js";
import { initRefreshButton } from "./refresh-button.js";
import { subscribeFeed, initPostEditor, refreshFeed, unsubscribeFeed } from "./feed.js";
import { initInlineComposer } from "./inline-composer.js";
import { initViewProfileModal } from "./people.js";

// ============================================================
//  Запуск и сворачивание вкладки
//
//  Переход между вкладками не перезагружает страницу (см. router.js),
//  поэтому содержимое нужно уметь и включать, и выключать: живые подписки
//  на базу обязаны закрываться, иначе с каждым переходом их копилось бы
//  всё больше.
// ============================================================
export async function initPage() {
  clearPending("replies");   // всё увиденное больше не копится
  markTabSeen("feed");
  keepTabSeen("feed");
  keepScrollPosition();
  initViewProfileModal();
  initPostEditor();
  initInlineComposer();
  subscribeFeed();
  initRefreshButton(() => refreshFeed());
  stopPage = () => unsubscribeFeed();
}

export function destroyPage() {
  stopPage?.();
}

// Что закрыть при уходе — заполняется при запуске
let stopPage = null;

// Первая загрузка: сначала общая оболочка, затем содержимое вкладки
initShell();   // один раз на всю жизнь страницы

window.addEventListener("DOMContentLoaded", async () => {
  const { initRouter } = await import("./router.js");

  // Сбой вкладки не должен ронять всё остальное. Раньше ошибка здесь
  // прерывала загрузку целиком: роутер не запускался, обработчики входа
  // не навешивались — и человек не мог даже войти в аккаунт, пока
  // не уходил на другую вкладку.
  try {
    await initPage();
  } catch (e) {
    console.error("Вкладка не запустилась:", e);
    const { showPageError } = await import("./page-error.js");
    showPageError(e);
  }

  initRouter({ initPage, destroyPage });
});
