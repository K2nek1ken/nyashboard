import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { initViewProfileModal } from "./people.js";
import { initPostEditor } from "./feed.js";
import { initPostPage } from "./post.js";

initShell();   // шапка, оформление и плеер — общие для всех страниц

window.addEventListener("DOMContentLoaded", () => {
  keepScrollPosition();
  initViewProfileModal();
  initPostEditor();
  initPostPage();
});
