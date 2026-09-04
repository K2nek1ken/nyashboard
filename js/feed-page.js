import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initSettingsModal } from "./settings-modal.js";
import { applyFavicon } from "./favicon.js";
import { initRefreshButton } from "./refresh-button.js";
import { initProfileDropdown } from "./auth.js";
import { subscribeFeed, initPostEditor, refreshFeed } from "./feed.js";
import { initInlineComposer } from "./inline-composer.js";
import { initViewProfileModal } from "./people.js";

applySettings();
window.addEventListener("DOMContentLoaded", () => {
  initLayout();
  applyFavicon();
  initSettingsModal();
  initStarfield();
  initProfileDropdown();
  initViewProfileModal();
  initPostEditor();
  initInlineComposer();
  subscribeFeed();
  initRefreshButton(() => refreshFeed());
});
