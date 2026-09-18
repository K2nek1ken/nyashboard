import { escapeHtml } from "./ui.js";

// ============================================================
//  Сообщение о сбое вкладки
//
//  Когда запуск вкладки падает, человек видит пустой экран и не понимает,
//  что произошло: то ли грузится, то ли сломалось, то ли связь пропала.
//
//  Показываем причину прямо на странице. Остальной сайт при этом работает:
//  шапка, вход и переходы между вкладками не зависят от содержимого.
// ============================================================

export function showPageError(error) {
  const app = document.getElementById("app");
  if (!app) return;

  const box = document.createElement("div");
  box.className = "page-error";
  box.innerHTML = `
    <div class="page-error-title">Эта вкладка не открылась</div>
    <div class="page-error-text">${escapeHtml(error?.message || "неизвестная ошибка")}</div>
    <div class="page-error-hint">
      Остальное работает — можно перейти на другую вкладку.
      Подробности в консоли браузера.
    </div>
    <button class="secondaryBtn" data-retry>Попробовать снова</button>`;

  // Ставим в начало, не стирая остальное: часть страницы могла успеть
  // отрисоваться, и убирать её незачем.
  app.prepend(box);

  box.querySelector("[data-retry]").addEventListener("click", () => location.reload());
}
