import { ICON } from "./icons.js";

// Кнопка обновления списка. Показывается только когда человек уже наверху —
// внизу она мешала бы и была бы бессмысленной: там обычно догружают старое,
// а не проверяют новое.
export function initRefreshButton(onRefresh) {
  const btn = document.createElement("button");
  btn.className = "refreshFab";
  btn.type = "button";
  btn.title = "обновить список";
  btn.innerHTML = `<span class="nf">${ICON.refresh || "\uf021"}</span>`;
  document.body.appendChild(btn);

  function sync() {
    btn.classList.toggle("visible", window.scrollY < 60);
  }
  window.addEventListener("scroll", sync, { passive: true });
  sync();

  btn.addEventListener("click", async () => {
    btn.classList.add("spinning");
    try { await onRefresh(); }
    finally { setTimeout(() => btn.classList.remove("spinning"), 400); }
  });
}
