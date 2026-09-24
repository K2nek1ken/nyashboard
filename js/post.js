import { db, doc, getDoc, onSnapshot } from "./firebase.js";
import { postToHtml, wirePostCard, patchPostCard, enrichAuthors } from "./feed.js";
import { fetchReplies, sendReply, replyRowHtml, wireReplyLikes, wireReplyQuotes } from "./replies.js";
import { authReady } from "./auth.js";
import { showToast, escapeHtml } from "./ui.js";

let stopWatch = null;

// Уходим со страницы — перестаём слушать запись: иначе обновление
// рисовало бы в разметку, которой уже нет.
export function stopPostPage() {
  if (stopWatch) { stopWatch(); stopWatch = null; }
}

// Рисует запись той же карточкой, что и лента, со свежим оформлением
// автора. Если карточка уже на странице — обновляет её по частям, не
// пересобирая: иначе рвались бы открытая карусель и играющее видео.
async function paintPost(post, detailEl) {
  await enrichAuthors([post]).catch(() => {});

  const card = detailEl.querySelector(".post-card");
  if (card) {
    patchPostCard(card, post);
  } else {
    detailEl.innerHTML = postToHtml(post);
    wirePostCard(post, detailEl);
  }

  // На странице записи превью ответов внутри карточки не нужно — ниже
  // полный список; своё поле ввода у страницы тоже своё.
  detailEl.querySelector(".replies-preview")?.remove();
  detailEl.querySelector(".reply-input-row")?.remove();

  const focusBtn = detailEl.querySelector('[data-action="focusReply"]');
  if (focusBtn && !focusBtn.dataset.wfocus) {
    focusBtn.dataset.wfocus = "1";
    focusBtn.addEventListener("click", () => document.getElementById("detailReplyInput")?.focus());
  }
}

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

  await paintPost(post, detailEl);

  // Дальше запись живёт, как в ленте: правки, оценки и свежее оформление
  // автора приходят сами. Раньше страница загружала запись один раз —
  // и показывала её такой навсегда: аватарка оставалась старой, правки
  // с другого устройства не появлялись, и «изменить» открывало старый текст.
  stopPostPage();
  stopWatch = onSnapshot(doc(db, "posts", postId), async (snap) => {
    if (!snap.exists()) {
      detailEl.innerHTML = `<div class="stub-note">Запись удалена</div>`;
      return;
    }
    const fresh = { id: snap.id, ...snap.data() };
    await paintPost(fresh, detailEl);
  }, (e) => console.warn("Запись не обновляется:", e.message));
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
      const { currentReplyTarget, clearReplyTarget, replyScope } = await import("./replies.js");
      const scope = replyScope();
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
