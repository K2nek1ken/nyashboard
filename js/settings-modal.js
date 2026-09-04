import { initSettingsPage } from "./settings-ui.js";
import { ICON } from "./icons.js";

// На широком экране настройки открываются поверх страницы: уходить со страницы
// ради пары переключателей неудобно, а места хватает. На телефоне остаётся
// отдельная страница — там модалка во весь экран не имеет смысла.
const WIDE = "(min-width: 900px)";

export function initSettingsModal() {
  document.addEventListener("click", (e) => {
    const link = e.target.closest('a[href="settings.html"]');
    if (!link) return;
    if (!window.matchMedia(WIDE).matches) return;   // на телефоне обычный переход
    // на самой странице настроек модалка не нужна — иначе на странице оказалось
    // бы два контейнера с одним id, и настройки отрисовались бы не туда
    if (document.getElementById("settingsHost")) return;
    e.preventDefault();
    openSettingsModal();
  });
}

export function openSettingsModal() {
  if (document.getElementById("settingsModal")) return;

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.id = "settingsModal";
  modal.innerHTML = `
    <div class="modal-content settings-modal-content">
      <button class="closeBtn modalClose" data-close><span class="nf">${ICON.close}</span></button>
      <h2 style="margin-top:0;"><span class="nf">${ICON.gear}</span> Настройки</h2>
      <div id="settingsHost"></div>
    </div>`;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector("[data-close]").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  });

  // тот же интерфейс, что и на отдельной странице — код не дублируется
  initSettingsPage();
}
