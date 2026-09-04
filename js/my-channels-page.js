import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initProfileDropdown } from "./auth.js";
import { initMyChannelsPage } from "./my-channels.js";

applySettings();
window.addEventListener("DOMContentLoaded", () => {
  initLayout();
  initStarfield();
  initProfileDropdown();
  initMyChannelsPage();
});
