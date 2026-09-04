import { ICON } from "./icons.js";

// Кнопка обновления списка. Показывается только когда человек уже наверху —
// внизу она мешала бы и была бы бессмысленной: там обычно догружают старое,
// а не проверяют новое.
export function initRefreshButton(onRefresh) {
  const btn = document.createElement("button");
  btn.className = "refreshFab";
  btn.type = "button";
  btn.title = "обновить список";
  btn.innerHTML = `<span class="nf">${ICON.refresh}</span><span>Обновить</span>`;
  document.body.appendChild(btn);

  function sync() {
    btn.classList.toggle("visible", window.scrollY < 60);
  }
  window.addEventListener("scroll", sync, { passive: true });
  sync();

  btn.addEventListener("click", async () => {
    if (btn.classList.contains("spinning")) return;
    btn.classList.add("spinning");
    const started = Date.now();
    try {
      await onRefresh();
    } finally {
      // держим вращение хотя бы полсекунды: мгновенный отклик выглядит так,
      // будто кнопка не сработала
      const left = Math.max(0, 500 - (Date.now() - started));
      setTimeout(() => btn.classList.remove("spinning"), left);
    }
  });
}
