import { keepInViewport } from "./anchor.js";

// ============================================================
//  Свой выпадающий список
//
//  Системный список рисуется операционной системой и не поддаётся оформлению:
//  на тёмной теме он выглядел белым прямоугольником из другого мира.
//  Здесь обычная кнопка со списком под ней — те же возможности, но в стиле сайта.
//
//  Значение хранится в скрытом поле, поэтому остальной код работает с ним
//  так же, как раньше: читает value и слушает событие изменения.
// ============================================================

export function customSelect(name, options, current) {
  const label = options[current] ?? Object.values(options)[0] ?? "";
  return `
    <div class="cselect" data-cselect="${name}">
      <input type="hidden" data-select="${name}" value="${current}">
      <button type="button" class="cselect-btn" data-cselect-btn>
        <span data-cselect-label>${label}</span>
        <span class="cselect-arrow">›</span>
      </button>
      <div class="cselect-menu hidden" data-cselect-menu>
        ${Object.entries(options).map(([key, text]) => `
          <button type="button" class="cselect-option ${key === current ? "selected" : ""}"
                  data-value="${key}">${text}</button>`).join("")}
      </div>
    </div>`;
}

// Оживляет все списки внутри контейнера. onChange получает имя и новое значение.
export function wireSelects(container, onChange) {
  container.querySelectorAll("[data-cselect]").forEach(box => {
    const name = box.dataset.cselect;
    const field = box.querySelector(`[data-select="${name}"]`);
    const btn = box.querySelector("[data-cselect-btn]");
    const menu = box.querySelector("[data-cselect-menu]");
    const labelEl = box.querySelector("[data-cselect-label]");

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen = !menu.classList.contains("hidden");
      closeAll();
      if (wasOpen) return;
      menu.classList.remove("hidden");
      keepInViewport(menu);
    });

    menu.querySelectorAll("[data-value]").forEach(opt => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        field.value = opt.dataset.value;
        labelEl.textContent = opt.textContent;
        menu.querySelectorAll("[data-value]").forEach(o => o.classList.toggle("selected", o === opt));
        menu.classList.add("hidden");
        onChange?.(name, opt.dataset.value);
      });
    });
  });

  if (!wired) {
    wired = true;
    document.addEventListener("click", closeAll);
  }
}

let wired = false;

function closeAll() {
  document.querySelectorAll("[data-cselect-menu]:not(.hidden)")
    .forEach(m => m.classList.add("hidden"));
}
