import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initProfileDropdown } from "./auth.js";
import { initContentTab } from "./content.js";

applySettings();
window.addEventListener("DOMContentLoaded", () => {
  initLayout();
  initStarfield();
  initProfileDropdown();
  initContentTab();
});
