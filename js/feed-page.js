import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initProfileDropdown } from "./auth.js";
import { subscribeFeed, initPostEditor } from "./feed.js";
import { initViewProfileModal } from "./people.js";

applySettings();
window.addEventListener("DOMContentLoaded", () => {
  initLayout();
  initStarfield();
  initProfileDropdown();
  initViewProfileModal();
  initPostEditor();
  subscribeFeed();
});
