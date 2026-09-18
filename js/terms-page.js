import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { renderTerms } from "./terms.js";

initShell();

export async function initPage() {
  keepScrollPosition();
  renderTerms();
}

export function destroyPage() {}

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
