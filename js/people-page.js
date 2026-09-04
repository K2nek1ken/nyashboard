import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initSettingsModal } from "./settings-modal.js";
import { applyFavicon } from "./favicon.js";
import { initRefreshButton } from "./refresh-button.js";
import { initProfileDropdown } from "./auth.js";
import { loadPeopleTab, initPeopleSearch, initViewProfileModal } from "./people.js";

applySettings();
// Шапку рисуем немедленно: она не должна мигать пустотой,
// пока страница ждёт DOMContentLoaded.
initLayout();
applyFavicon();
window.addEventListener("DOMContentLoaded", () => {
  initSettingsModal();
  initStarfield();
  initProfileDropdown();
  initViewProfileModal();
  initPeopleSearch();
  loadPeopleTab();
  initRefreshButton(() => loadPeopleTab());
});
