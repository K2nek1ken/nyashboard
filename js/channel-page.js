import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initProfileDropdown } from "./auth.js";
import { initViewProfileModal } from "./people.js";
import { initChannelPage } from "./channel.js";

applySettings();
window.addEventListener("DOMContentLoaded", () => {
  initLayout();
  initStarfield();
  initProfileDropdown();
  initViewProfileModal();
  initChannelPage();
});
