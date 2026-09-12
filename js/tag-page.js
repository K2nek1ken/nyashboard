import { initShell } from "./shell.js";
import { keepScrollPosition } from "./session-state.js";
import { initProfileDropdown, authReady } from "./auth.js";
import { initViewProfileModal } from "./people.js";
import { db, collection, query, where, getDocs } from "./firebase.js";
import { renderPostsInto } from "./feed.js";
import { escapeHtml, setText } from "./ui.js";

async function initTagPage() {
  const tag = (new URLSearchParams(location.search).get("tag") || "").toLowerCase();
  const postsEl = document.getElementById("tagPosts");
  setText("tagTitle", tag || "не указан");
  document.title = `NyashBoard ♡ — #${tag}`;
  if (!tag) { postsEl.innerHTML = `<div class="stub-note">Тег не указан</div>`; return; }

  await authReady;
  try {
    // array-contains + сортировка на клиенте — чтобы не требовать составной индекс
    const snap = await getDocs(query(collection(db, "posts"), where("hashtags", "array-contains", tag)));
    const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    if (!posts.length) {
      postsEl.innerHTML = `<div class="stub-note">По тегу #${escapeHtml(tag)} пока ничего нет</div>`;
      return;
    }
    renderPostsInto(postsEl, posts, "");
  } catch (e) {
    console.error(e);
    postsEl.innerHTML = `<div class="stub-note">Ошибка: ${escapeHtml(e.message)}</div>`;
  }
}

initShell();   // шапка, оформление и плеер — общие для всех страниц

// Запуск и сворачивание вкладки — см. router.js: страница подгружается
// без перезагрузки, поэтому её содержимое нужно уметь включать заново.
export async function initPage() {
  keepScrollPosition();
  initViewProfileModal();
  initTagPage();
}

export function destroyPage() {
  stopPage?.();
  stopPage = null;
}

let stopPage = null;

window.addEventListener("DOMContentLoaded", async () => {
  const { initRouter } = await import("./router.js");
  await initPage();
  initRouter({ initPage, destroyPage });
});
