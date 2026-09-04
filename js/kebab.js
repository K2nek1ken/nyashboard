import { ICON } from "./icons.js";

// items: [{ action: "editPost", label: "Изменить", icon: ICON.pencil, danger: false }, ...]
// kebabId нужен только чтобы отличать несколько меню на одной странице друг от друга.
export function kebabHtml(items, kebabId) {
  if (!items.length) return "";
  return `
    <div class="kebab" data-kebab-id="${kebabId}">
      <button class="kebabTrigger nf" data-action="toggleKebab" title="ещё">${ICON.more}</button>
      <div class="kebabMenu hidden">
        ${items.map(i => `
          <button class="kebabItem ${i.danger ? "danger" : ""}" data-action="${i.action}">
            <span class="nf">${i.icon}</span> ${i.label}
          </button>`).join("")}
      </div>
    </div>`;
}

let globalCloseHandlerAttached = false;

// container — DOM-элемент, ВНУТРИ которого искать кебабы (карточка поста, строка
// ответа, сообщение чата...). handlers — объект { actionName: () => {...} }, только
// для тех действий, что реально присутствуют в этом конкретном кебабе.
export function wireKebab(container, handlers) {
  const kebab = container.querySelector("[data-kebab-id]");
  if (!kebab) return;
  const trigger = kebab.querySelector('[data-action="toggleKebab"]');
  const menu = kebab.querySelector(".kebabMenu");

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".kebabMenu").forEach(m => { if (m !== menu) m.classList.add("hidden"); });
    menu.classList.toggle("hidden");
  });

  menu.querySelectorAll("[data-action]").forEach(btn => {
    const handler = handlers[btn.dataset.action];
    if (!handler) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.classList.add("hidden");
      handler();
    });
  });

  if (!globalCloseHandlerAttached) {
    globalCloseHandlerAttached = true;
    document.addEventListener("click", () => {
      document.querySelectorAll(".kebabMenu:not(.hidden)").forEach(m => m.classList.add("hidden"));
    });
  }
}
