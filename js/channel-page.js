import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { initViewProfileModal } from "./people.js";
import { initChannelPage } from "./channel.js";

initShell();   // шапка, оформление и плеер — общие для всех страниц

// Запуск и сворачивание вкладки — см. router.js: страница подгружается
// без перезагрузки, поэтому её содержимое нужно уметь включать заново.
export async function initPage() {
  keepScrollPosition();
  initViewProfileModal();

  // Ошибку здесь нельзя терять: страница канала загружается в несколько
  // шагов, и сбой на любом оставлял пустой экран без объяснений — помогала
  // только перезагрузка.
  try {
    await initChannelPage();
  } catch (e) {
    console.error("Страница канала не открылась:", e);
    const wall = document.getElementById("chWall");
    if (wall) wall.innerHTML = `<div class="stub-note">Не удалось открыть канал: ${e.message}</div>`;
  }
}

export function destroyPage() {
  stopPage?.();
  stopPage = null;
}

let stopPage = null;

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
