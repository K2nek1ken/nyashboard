import { ICON } from "./icons.js";

// Свои окна вместо системных prompt/confirm: те выглядят чужеродно, по-разному
// в каждом браузере, а на телефоне ещё и обрезают длинный текст.
// Все возвращают промис, поэтому вызываются так же просто, как системные.

function build(title, bodyHtml, buttons) {
  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content dialog-content">
        <button class="closeBtn modalClose" data-cancel><span class="nf">${ICON.close}</span></button>
        <h2 style="margin-top:0; font-size:18px;">${title}</h2>
        ${bodyHtml}
        <div class="dialog-buttons">${buttons}</div>
      </div>`;
    document.body.appendChild(modal);

    const done = (value) => { modal.remove(); document.removeEventListener("keydown", onKey); resolve(value); };
    const onKey = (e) => {
      if (e.key === "Escape") done(null);
      if (e.key === "Enter" && !e.shiftKey && modal.querySelector("input")) {
        e.preventDefault();
        modal.querySelector("[data-ok]")?.click();
      }
    };
    document.addEventListener("keydown", onKey);
    modal.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", () => done(null)));
    modal.addEventListener("click", (e) => { if (e.target === modal) done(null); });

    modal.querySelector("[data-ok]")?.addEventListener("click", () => {
      const input = modal.querySelector("[data-input]");
      done(input ? input.value : true);
    });

    setTimeout(() => modal.querySelector("[data-input]")?.focus(), 30);
  });
}

export function askText(title, { value = "", placeholder = "", hint = "", maxlength = 200, okLabel = "Готово" } = {}) {
  return build(title,
    `${hint ? `<p class="muted" style="margin-top:0;">${hint}</p>` : ""}
     <input class="inlineEdit" data-input maxlength="${maxlength}"
            value="${String(value).replace(/"/g, "&quot;")}" placeholder="${placeholder}">`,
    `<button class="secondaryBtn" data-cancel>Отмена</button>
     <button class="primaryBtn" data-ok>${okLabel}</button>`);
}

export function askConfirm(title, { hint = "", okLabel = "Да", danger = false } = {}) {
  return build(title,
    hint ? `<p class="muted" style="margin-top:0;">${hint}</p>` : "",
    `<button class="secondaryBtn" data-cancel>Отмена</button>
     <button class="${danger ? "dangerBtn" : "primaryBtn"}" data-ok>${okLabel}</button>`)
    .then(v => v === true);
}
