import { db, doc, getDoc } from "./firebase.js";
import { postToHtml, wirePostCard } from "./feed.js";
import { fetchReplies, sendReply, replyRowHtml, wireReplyLikes, wireReplyQuotes } from "./replies.js";
import { authReady } from "./auth.js";
import { showToast, escapeHtml } from "./ui.js";

function getPostId() {
  return new URLSearchParams(location.search).get("id");
}

export async function initPostPage() {
  const detailEl = document.getElementById("postDetail");
  const repliesEl = document.getElementById("allReplies");
  const postId = getPostId();

  if (!postId) {
    detailEl.innerHTML = `<div class="stub-note">Не указан пост (нет ?id= в ссылке)</div>`;
    return;
  }

  await authReady; // иначе лайки/кнопки редактирования отрисуются неправильно
  let post;
  try {
    const snap = await getDoc(doc(db, "posts", postId));
    if (!snap.exists()) { detailEl.innerHTML = `<div class="stub-note">Пост не найден — возможно, удалён</div>`; return; }
    post = { id: snap.id, ...snap.data() };
  } catch (e) {
    console.error(e);
    detailEl.innerHTML = `<div class="stub-note">Ошибка загрузки: ${escapeHtml(e.message)}</div>`;
    return;
  }

  detailEl.innerHTML = postToHtml(post);
  wirePostCard(post, detailEl);
  // на странице поста превью-блок ответов внутри самой карточки не нужен — полный список ниже
  const previewInCard = detailEl.querySelector(".replies-preview");
  if (previewInCard) previewInCard.remove();
  const inlineReplyRow = detailEl.querySelector(".reply-input-row");
  if (inlineReplyRow) inlineReplyRow.remove();
  // кнопка "ответить" в карточке должна фокусить настоящее поле ввода этой страницы,
  // а не удалённое инлайн-поле из карточки ленты
  const focusBtn = detailEl.querySelector('[data-action="focusReply"]');
  if (focusBtn) focusBtn.addEventListener("click", () => document.getElementById("detailReplyInput")?.focus());

  await reloadReplies(postId, repliesEl);
  wireDetailReplyInput(postId, repliesEl);
}

async function reloadReplies(postId, repliesEl) {
  repliesEl.innerHTML = `<div class="muted">Загружаю ответы...</div>`;
  try {
    const all = await fetchReplies(postId);
    if (!all.length) { repliesEl.innerHTML = `<div class="muted">Пока нет ответов — будь первой ♡</div>`; return; }
    repliesEl.innerHTML = all.map(replyRowHtml).join("");
    wireReplyLikes(repliesEl, all, () => reloadReplies(postId, repliesEl));
    wireReplyQuotes(repliesEl);
  } catch (e) {
    console.error(e);
    repliesEl.innerHTML = `<div class="stub-note">Не смогла загрузить ответы: ${escapeHtml(e.message)}</div>`;
  }
}

function wireDetailReplyInput(postId, repliesEl) {
  const input = document.getElementById("detailReplyInput");
  const btn = document.getElementById("detailSendReply");
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    btn.disabled = true;
    try {
      const { currentReplyTarget, clearReplyTarget } = await import("./replies.js");
      const scope = document.querySelector(".post-card") || document.body;
      await sendReply(postId, text, null, currentReplyTarget(scope));
      clearReplyTarget(scope);
      input.value = "";
      showToast("Ответ отправлен");
      await reloadReplies(postId, repliesEl);
    } catch (e) {
      console.error(e);
      showToast("Не отправилось: " + e.message);
    } finally {
      btn.disabled = false;
    }
  };
  btn.addEventListener("click", send);
  // Enter — перенос, отправка по Shift+Enter или Ctrl+Enter. Как и везде.
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      send();
    }
  });

  // Поле растёт под текст.
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  });
}
