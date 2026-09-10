import { initShell } from "./shell.js";
import { markTabSeen, keepTabSeen } from "./notifications.js";
import { keepScrollPosition } from "./session-state.js";
import { initRefreshButton } from "./refresh-button.js";
import { initContentTab, initSubtabs, resetContentState } from "./content.js";

// ============================================================
//  Запуск и сворачивание вкладки
//
//  Переход между вкладками не перезагружает страницу (см. router.js),
//  поэтому содержимое нужно уметь и включать, и выключать: живые подписки
//  на базу обязаны закрываться, иначе с каждым переходом их копилось бы
//  всё больше.
// ============================================================
export async function initPage() {
  markTabSeen("content");
  keepTabSeen("content");
  keepScrollPosition();
  resetContentState();
  initSubtabs();
  initContentTab();
  initRefreshButton(() => initContentTab());
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
  await initPage();
  initRouter({ initPage, destroyPage });
});
