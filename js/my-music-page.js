import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { initMyMusic } from "./my-music.js";

initShell();

// Запуск и сворачивание вкладки — см. router.js: страница подгружается
// без перезагрузки, поэтому её содержимое нужно уметь включать заново.
export async function initPage() {
  keepScrollPosition();
  initMyMusic();
}

export function destroyPage() {
  stopPage?.();
  stopPage = null;
}

let stopPage = null;

window.addEventListener("DOMContentLoaded", async () => {
  const { initRouter } = await import("./router.js");
  await initPage();
  initRouter({ initPage, destroyPage });
});
