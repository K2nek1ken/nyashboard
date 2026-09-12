import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { renderTerms } from "./terms.js";

initShell();

export async function initPage() {
  keepScrollPosition();
  renderTerms();
}

export function destroyPage() {}

window.addEventListener("DOMContentLoaded", async () => {
  const { initRouter } = await import("./router.js");
  await initPage();
  initRouter({ initPage, destroyPage });
});
