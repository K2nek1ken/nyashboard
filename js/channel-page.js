import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { initViewProfileModal } from "./people.js";
import { initChannelPage } from "./channel.js";

initShell();   // шапка, оформление и плеер — общие для всех страниц

window.addEventListener("DOMContentLoaded", () => {
  keepScrollPosition();
  initViewProfileModal();
  initChannelPage();
});
