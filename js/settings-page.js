import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { initSettingsPage } from "./settings-ui.js";

initShell();   // шапка, оформление и плеер — общие для всех страниц

window.addEventListener("DOMContentLoaded", () => {
  keepScrollPosition();
  initSettingsPage();
});
