import { initShell } from "./shell.js";
import { markTabSeen, keepTabSeen, stopKeepingSeen } from "./notifications.js";
import { initChatForm, subscribeChat, unsubscribeChat, rememberChatSpot } from "./chat.js";

// ============================================================
//  Запуск и сворачивание вкладки
//
//  Переход между вкладками не перезагружает страницу (см. router.js),
//  поэтому содержимое нужно уметь и включать, и выключать: живые подписки
//  на базу обязаны закрываться, иначе с каждым переходом их копилось бы
//  всё больше.
// ============================================================
export async function initPage() {
  markTabSeen("chat");
  keepTabSeen("chat");
  // Общее запоминание прокрутки здесь не нужно: у чата своё, точнее —
  // по сообщению, а не по числу пикселей. Два механизма спорили бы,
  // и общий, срабатывая позже, перебивал бы точное место.
  initChatForm();
  subscribeChat();
  stopPage = () => unsubscribeChat();
}

export function destroyPage() {
  stopKeepingSeen();
  stopPage?.();

  // Запоминаем место до того, как разметка исчезнет: при возврате
  // во вкладку встанем туда же, а не в самый низ.
  rememberChatSpot();

  // Подписку закрываем: она держала ссылку на разметку, которой уже нет,
  // и продолжала рисовать в пустоту. При возврате чат подпишется заново.
  unsubscribeChat();
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
