import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initSettingsModal } from "./settings-modal.js";
import { applyFavicon } from "./favicon.js";
import { initProfileDropdown } from "./auth.js";
import { initViewProfileModal } from "./people.js";
import { initUserPage } from "./user.js";

applySettings();
window.addEventListener("DOMContentLoaded", () => {
  initLayout();
  applyFavicon();
  initSettingsModal();
  initStarfield();
  initProfileDropdown();
  initViewProfileModal();
  initUserPage();
});
