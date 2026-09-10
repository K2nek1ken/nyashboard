import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { initRefreshButton } from "./refresh-button.js";
import { loadPeopleTab, initPeopleSearch, initViewProfileModal } from "./people.js";

// ============================================================
//  Запуск и сворачивание вкладки
//
//  Переход между вкладками не перезагружает страницу (см. router.js),
//  поэтому содержимое нужно уметь и включать, и выключать: живые подписки
//  на базу обязаны закрываться, иначе с каждым переходом их копилось бы
//  всё больше.
// ============================================================
export async function initPage() {
  keepScrollPosition();
  initViewProfileModal();
  initPeopleSearch();
  loadPeopleTab();
  initRefreshButton(() => loadPeopleTab());
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
