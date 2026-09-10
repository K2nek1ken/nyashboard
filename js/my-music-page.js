import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { initMyMusic } from "./my-music.js";

initShell();

window.addEventListener("DOMContentLoaded", () => {
  keepScrollPosition();
  initMyMusic();
});
