import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { initProfilePageForm } from "./profile.js";

initShell();   // шапка, оформление и плеер — общие для всех страниц

window.addEventListener("DOMContentLoaded", () => {
  keepScrollPosition();
  initProfilePageForm();
});
