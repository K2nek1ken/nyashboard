import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initProfileDropdown } from "./auth.js";
import { initSettingsPage } from "./settings-ui.js";

applySettings();
window.addEventListener("DOMContentLoaded", () => {
  initLayout();
  initStarfield();
  initProfileDropdown();
  initSettingsPage();
});
