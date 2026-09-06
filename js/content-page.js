import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initSettingsModal } from "./settings-modal.js";
import { applyFavicon } from "./favicon.js";
import { paintTabDots, markTabSeen, startTabPolling } from "./notifications.js";
import { startPresence } from "./presence.js";
import { initRefreshButton } from "./refresh-button.js";
import { initProfileDropdown } from "./auth.js";
import { initContentTab, initSubtabs } from "./content.js";

applySettings();
markTabSeen("content");   // страница открыта — здесь всё просмотрено
// Шапку рисуем немедленно: она не должна мигать пустотой,
// пока страница ждёт DOMContentLoaded.
initLayout();
applyFavicon();
paintTabDots();
startTabPolling();
startPresence();
window.addEventListener("DOMContentLoaded", () => {
  initSettingsModal();
  initStarfield();
  initProfileDropdown();
  initSubtabs();
  initContentTab();
  initRefreshButton(() => initContentTab());
});
