import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initSettingsModal } from "./settings-modal.js";
import { applyFavicon } from "./favicon.js";
import { initProfileDropdown, authReady } from "./auth.js";
import { initViewProfileModal } from "./people.js";
import { db, collection, query, where, getDocs } from "./firebase.js";
import { renderPostsInto } from "./feed.js";
import { escapeHtml } from "./ui.js";

applySettings();
// Шапку рисуем немедленно: она не должна мигать пустотой,
// пока страница ждёт DOMContentLoaded.
initLayout();
applyFavicon();

async function initTagPage() {
  const tag = (new URLSearchParams(location.search).get("tag") || "").toLowerCase();
  const postsEl = document.getElementById("tagPosts");
  document.getElementById("tagTitle").textContent = tag || "не указан";
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

window.addEventListener("DOMContentLoaded", () => {
  initSettingsModal();
  initStarfield();
  initProfileDropdown();
  initViewProfileModal();
  initTagPage();
});
