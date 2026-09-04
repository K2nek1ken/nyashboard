import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initSettingsModal } from "./settings-modal.js";
import { applyFavicon } from "./favicon.js";
import { initProfileDropdown } from "./auth.js";
import { initProfilePageForm } from "./profile.js";

applySettings();
// Шапку рисуем немедленно: она не должна мигать пустотой,
// пока страница ждёт DOMContentLoaded.
initLayout();
applyFavicon();
window.addEventListener("DOMContentLoaded", () => {
  initSettingsModal();
  initStarfield();
  initProfileDropdown();
  initProfilePageForm();
});
