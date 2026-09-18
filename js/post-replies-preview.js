import { fetchReplies, wireReplyLikes } from "./replies.js";
import { escapeHtml } from "./ui.js";

// ============================================================
//  Ответы под записью
//
//  Подгружаются, когда карточка попала на экран, а не сразу: запись может
//  пролежать в ленте непрочитанной, и грузить к ней ответы заранее — лишние
//  запросы на каждую карточку.
// ============================================================

// Наблюдатель один на все карточки: заводить по одному на каждую — лишняя
// работа для браузера, а следит он одинаково.
let replyObserver = null;

export function lazyLoadReplies(postId, card) {
  if (!("IntersectionObserver" in window)) { loadReplyPreview(postId, card); return; }
  if (!replyObserver) {
    replyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        replyObserver.unobserve(entry.target);
        loadReplyPreview(entry.target.dataset.id, entry.target);
      });
    }, { rootMargin: "300px" });   // с запасом, чтобы подгрузилось до появления
  }
  replyObserver.observe(card);
}
// Превью топ-3 самых залайканных ответов, реддит-стайл отступ слева.
// Кнопка "показать все N" ведёт на отдельную страницу поста (post.html?id=...).
export async function loadReplyPreview(postId, card) {
  const box = card.querySelector(`.replies-preview[data-preview-for="${postId}"]`);
  if (!box) return;
  try {
    const all = await fetchReplies(postId);
    if (!all.length) { box.innerHTML = ""; return; }
    const top3 = all.slice(0, 3);
    box.innerHTML = top3.map(replyRowHtml).join("") +
      (all.length > 3
        ? `<a class="showMoreReplies" href="post.html?id=${postId}">показать все ${all.length} ответов &#8594;</a>`
        : "");
    wireReplyLikes(box, top3);
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="muted">Не смогла загрузить ответы: ${escapeHtml(e.message)}</div>`;
  }
}
