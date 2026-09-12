// ============================================================
//  Перетаскивание элементов списка
//
//  Один способ на все списки: порядок вкладок, очередь треков и всё, что
//  появится позже. Кнопки со стрелками остаются — кому-то ими удобнее,
//  особенно без мыши.
//
//  Работает и мышью, и пальцем: используются события указателя, а не
//  отдельные наборы для каждого способа ввода.
//
//  На телефоне перетаскивание начинается после удержания: иначе оно
//  перехватывало бы обычную прокрутку списка.
// ============================================================

const HOLD_MS = 220;          // столько держать пальцем до захвата
const MOVE_TOLERANCE = 8;     // движение больше этого — это прокрутка, не захват

export function makeSortable(container, { onReorder, handle = null, itemSelector = null } = {}) {
  if (!container || container.dataset.sortable) return;
  container.dataset.sortable = "1";

  let dragged = null;
  let holdTimer = null;
  let startPoint = null;
  let placeholder = null;

  const itemOf = (target) =>
    itemSelector ? target.closest(itemSelector) : target.closest(":scope > *");

  container.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;

    // если задана ручка — тащим только за неё
    if (handle && !e.target.closest(handle)) return;
    // нажатия по кнопкам внутри элемента не должны начинать перетаскивание
    if (!handle && e.target.closest("button, a, input, textarea, select")) return;

    const item = itemOf(e.target);
    if (!item || item.parentElement !== container) return;

    // Без этого нажатие начинает выделение текста, и вместо переноса
    // получается выделенная подпись кнопки.
    e.preventDefault();

    startPoint = { x: e.clientX, y: e.clientY };

    const begin = () => {
      holdTimer = null;
      dragged = item;
      item.classList.add("dragging");
      container.classList.add("sorting");

      // Заглушка держит место: без неё соседи прыгали бы под пальцем.
      placeholder = document.createElement("div");
      placeholder.className = "drag-placeholder";
      placeholder.style.height = item.offsetHeight + "px";
      item.after(placeholder);

      item.setPointerCapture?.(e.pointerId);

      // На время переноса выделение выключаем у всей страницы: палец или
      // мышь легко выходят за пределы списка, и там выделение снова
      // перехватывало бы движение.
      document.body.classList.add("no-select");

      // Случайно выделившееся до захвата — снимаем.
      window.getSelection?.()?.removeAllRanges();
    };

    // мышью тащим сразу, пальцем — после удержания
    if (e.pointerType === "mouse") begin();
    else holdTimer = setTimeout(begin, HOLD_MS);
  });

  container.addEventListener("pointermove", (e) => {
    // пока ждём удержания, заметное движение отменяет захват — это прокрутка
    if (holdTimer && startPoint) {
      const moved = Math.hypot(e.clientX - startPoint.x, e.clientY - startPoint.y);
      if (moved > MOVE_TOLERANCE) { clearTimeout(holdTimer); holdTimer = null; }
      return;
    }
    if (!dragged) return;
    e.preventDefault();

    // ищем соседа, через середину которого прошёл указатель
    const siblings = [...container.children].filter(el => el !== dragged && el !== placeholder);
    const after = siblings.find(el => {
      const r = el.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });

    if (after) container.insertBefore(placeholder, after);
    else container.appendChild(placeholder);
  }, { passive: false });

  const finish = () => {
    document.body.classList.remove("no-select");
    clearTimeout(holdTimer);
    holdTimer = null;
    startPoint = null;
    if (!dragged) return;

    placeholder.replaceWith(dragged);
    dragged.classList.remove("dragging");
    container.classList.remove("sorting");
    placeholder = null;
    dragged = null;

    // отдаём новый порядок: список идентификаторов в том виде, как он лёг
    const order = [...container.children]
      .map(el => el.dataset.sortId || el.dataset.tab || el.dataset.id)
      .filter(Boolean);
    onReorder?.(order);
  };

  container.addEventListener("pointerup", finish);
  container.addEventListener("pointercancel", finish);
  container.addEventListener("pointerleave", (e) => {
    // уход указателя за пределы списка прерывает ожидание захвата,
    // но не сам перенос — его завершает отпускание
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  });
}
