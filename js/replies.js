import {
  db, auth, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where,
  serverTimestamp, arrayUnion, arrayRemove, increment
} from "./firebase.js";
import { currentUser, currentUserDoc } from "./auth.js";
import { askText, askConfirm } from "./dialog.js";
import { showToast, escapeHtml, timeAgo } from "./ui.js";
import { ICON } from "./icons.js";
import { markOwned, isOwned } from "./ownership.js";
import { linkifyMentions, wireMentions } from "./mentions.js";
import { kebabHtml, wireKebab } from "./kebab.js";
import { uploadImage } from "./storage.js";

// Забираем ВСЕ ответы поста одним запросом без orderBy (равенство + сортировка на
// другом поле требует составной индекс Firestore, который не создан по умолчанию —
// именно из-за этого ответы раньше зависали на "загружаю..." навсегда).
// Сортируем на клиенте — постов с тысячами ответов тут не предполагается.
export async function fetchReplies(postId) {
  const q = query(collection(db, "replies"), where("postId", "==", postId));
  const snap = await getDocs(q);
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => {
    const scoreDiff = (b.likesCount || 0) - (a.likesCount || 0);
    if (scoreDiff !== 0) return scoreDiff;
    const ta = a.createdAt?.toMillis?.() || 0;
    const tb = b.createdAt?.toMillis?.() || 0;
    return ta - tb;
  });
  return list;
}

export async function sendReply(postId, text, imageFile = null, replyTo = null) {
  const isAnon = !currentUser;
  const imageUrl = imageFile ? await uploadImage(imageFile) : null;
  const ref = await addDoc(collection(db, "replies"), {
    postId,

    // На какой ответ это ответ. Храним снимок — имя и кусок текста, —
    // а не только ссылку: иначе цитата исчезала бы, стоило исходному
    // ответу пропасть, и разговор становился непонятным.
    replyToId: replyTo?.id || null,
    replyToNickname: replyTo?.nickname || null,
    replyToText: replyTo?.text ? replyTo.text.slice(0, 120) : null,
    authorUid: currentUser ? currentUser.uid : null,
    authorNickname: currentUser ? (currentUserDoc?.nickname || "???") : null,
    // Юзернейм нужен, чтобы на ответ можно было ответить упоминанием.
    // У анонимных не сохраняем — иначе анонимность бы нарушалась.
    authorUsername: (currentUser && !isAnon) ? (currentUserDoc?.username || null) : null,
    isAnonymous: isAnon,
    text,
    imageUrl,
    likesCount: 0,
    likedBy: [],
    createdAt: serverTimestamp()
  });
  await setDoc(doc(db, "replySecrets", ref.id), { ownerUid: auth.currentUser.uid });
  markOwned("reply", ref.id);
}

export async function deleteReply(replyId) {
  await deleteDoc(doc(db, "replies", replyId));
}

export async function editReply(replyId, text) {
  await updateDoc(doc(db, "replies", replyId), { text, editedAt: serverTimestamp() });
}

export async function toggleReplyLike(reply) {
  if (!currentUser) { showToast("Войди, чтобы лайкать ♡"); return; }

  // Смотрим актуальное состояние: ответы читаются разово, без живой подписки,
  // и данные в памяти легко устаревают. По устаревшим отметка ставилась
  // повторно, накручивая счётчик.
  const ref = doc(db, "replies", reply.id);
  const snap = await getDoc(ref).catch(() => null);
  const fresh = snap?.exists() ? snap.data() : reply;
  const liked = (fresh.likedBy || []).includes(currentUser.uid);

  try {
    await updateDoc(ref, {
      likedBy: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
      likesCount: increment(liked ? -1 : 1)
    });
  } catch (e) {
    console.warn("Отметка не прошла:", e.message);
    showToast("Не вышло — обнови страницу");
    return;
  }

  reply.likedBy = liked
    ? (fresh.likedBy || []).filter(u => u !== currentUser.uid)
    : [...(fresh.likedBy || []), currentUser.uid];
  reply.likesCount = Math.max(0, (fresh.likesCount || 0) + (liked ? -1 : 1));
}

function canManageReply(r) {
  if (currentUser && r.authorUid && r.authorUid === currentUser.uid) return true;
  return isOwned("reply", r.id);
}

export function replyRowHtml(r) {
  const name = r.isAnonymous ? "Аноним" : escapeHtml(r.authorNickname || "???");
  const liked = currentUser && (r.likedBy || []).includes(currentUser.uid);
  const canManage = canManageReply(r);
  const kebabItems = canManage ? [
    { action: "editReply", label: "Изменить", icon: ICON.pencil },
    { action: "deleteReply", label: "Удалить", icon: ICON.close, danger: true }
  ] : [];
  return `
    <div class="reply-row" data-reply-id="${r.id}">
      <div class="reply-row-head">
        <b class="${r.isAnonymous ? "anon" : ""}">${name}</b>
        <span class="muted">· ${timeAgo(r.createdAt)}</span>
        <button class="reply-act" data-action="replyToReply" title="ответить">
          <span class="nf">${ICON.reply}</span>
        </button>
        ${canManage ? kebabHtml(kebabItems, r.id) : ""}
      </div>
      ${r.replyToNickname ? `
        <div class="reply-quote" ${r.replyToId ? `data-goto-reply="${r.replyToId}"` : ""}>
          <span class="reply-quote-name">${escapeHtml(r.replyToNickname)}</span>
          <span class="reply-quote-text">${escapeHtml(r.replyToText || "фото")}</span>
        </div>` : ""}
      <div class="reply-text">${linkifyMentions(escapeHtml(r.text || ""))}</div>
      ${r.imageUrl ? `<img class="reply-img" src="${r.imageUrl}">` : ""}
      <button class="replyLikeBtn ${liked ? "liked" : ""}" data-action="likeReply">
        <span class="nf">${liked ? ICON.heartFilled : ICON.heart}</span> ${r.likesCount || 0}
      </button>
    </div>`;
}

// Нажатие по цитате подсвечивает тот ответ, на который отвечали.
// Переходить никуда не нужно: он обычно рядом, просто затерялся.
export function wireReplyQuotes(container) {
  container.querySelectorAll("[data-goto-reply]").forEach(el => {
    if (el.dataset.wired) return;
    el.dataset.wired = "1";

    el.addEventListener("click", () => {
      const target = container.querySelector(`.reply-row[data-reply-id="${el.dataset.gotoReply}"]`);
      if (!target) return;

      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("reply-flash");
      setTimeout(() => target.classList.remove("reply-flash"), 1200);
    });
  });
}

export function wireReplyLikes(container, replies, onDeleted) {
  wireMentions(container);
  container.querySelectorAll("[data-reply-id]").forEach(row => {
    const r = replies.find(x => x.id === row.dataset.replyId);
    if (!r) return;
    // Ответ на ответ: отдельная кнопка вместо меню — действие одно,
    // и прятать его в меню было бы лишним шагом.
    row.querySelector('[data-action="replyToReply"]')?.addEventListener("click", () => {
      // Поле ответа ищем в своей карточке, а не по всей странице: в ленте
      // карточек много, и раньше находилось первое попавшееся — ответ уходил
      // не в ту запись.
      const scope = row.closest(".post-card") || document;
      const input = scope.querySelector("[data-reply-input]")
                 || document.getElementById("detailReplyInput");
      if (!input) { showToast("Поле ответа не найдено"); return; }

      // Показываем, кому отвечаешь, и запоминаем — при отправке это
      // превратится в цитату внутри самого ответа.
      showReplyTarget(scope, r);
      scope.dataset.replyTo = JSON.stringify({
        id: r.id,
        nickname: r.isAnonymous ? "аноним" : (r.authorNickname || "кто-то"),
        text: r.text || ""
      });

      const handle = (!r.isAnonymous && r.authorUsername) ? `@${r.authorUsername} ` : "";
      if (handle && !input.value.startsWith(handle)) input.value = handle + input.value;

      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    const likeBtn = row.querySelector('[data-action="likeReply"]');
    likeBtn.addEventListener("click", async () => {
      await toggleReplyLike(r);
      // перерисовываем саму кнопку, чтобы счётчик и сердечко обновились на месте
      const liked = currentUser && (r.likedBy || []).includes(currentUser.uid);
      likeBtn.classList.toggle("liked", !!liked);
      likeBtn.innerHTML = `<span class="nf">${liked ? ICON.heartFilled : ICON.heart}</span> ${r.likesCount || 0}`;
    });
    wireKebab(row, {
      editReply: async () => {
        const cur = row.querySelector(".reply-text")?.textContent || "";
        const next = await askText("Изменить ответ", { value: cur, maxlength: 500 });
        if (next === null || !next.trim() || next.trim() === cur) return;
        try {
          await editReply(r.id, next.trim());
          r.text = next.trim();
          row.querySelector(".reply-text").innerHTML = linkifyMentions(escapeHtml(r.text));
          showToast("Изменено ♡");
        } catch (e) {
          console.error(e);
          showToast("Не вышло: " + e.message);
        }
      },
      deleteReply: async () => {
        if (!await askConfirm("Удалить ответ?", { okLabel: "Удалить", danger: true })) return;
        try {
          await deleteReply(r.id);
          row.remove();
          if (onDeleted) onDeleted(r.id);
        } catch (e) {
          console.error(e);
          showToast("Не удалилось: " + e.message);
        }
      }
    });
  });
}


// Показывает над полем ответа, на чей комментарий отвечаешь. Убирается
// крестиком или после отправки.
function showReplyTarget(scope, reply) {
  const row = scope.querySelector(".reply-input-row");
  if (!row) return;

  scope.querySelector(".reply-target")?.remove();

  const name = reply.isAnonymous ? "анониму" : (reply.authorNickname || "кому-то");
  const box = document.createElement("div");
  box.className = "reply-target";
  box.innerHTML = `
    <span class="nf">${ICON.reply}</span>
    <span class="reply-target-text">
      <b>${escapeHtml(name)}</b>: ${escapeHtml((reply.text || "фото").slice(0, 60))}
    </span>
    <button class="reply-target-close" data-drop><span class="nf">${ICON.close}</span></button>`;
  row.before(box);

  box.querySelector("[data-drop]").addEventListener("click", () => box.remove());
}

// Убрать цитату — после отправки ответа.
export function clearReplyTarget(scope = document) {
  scope.querySelector(".reply-target")?.remove();
  delete scope.dataset?.replyTo;
}

// На какой ответ сейчас отвечают в этой карточке.
export function currentReplyTarget(scope) {
  try {
    return scope?.dataset?.replyTo ? JSON.parse(scope.dataset.replyTo) : null;
  } catch {
    return null;
  }
}
