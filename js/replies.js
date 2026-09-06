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

export async function sendReply(postId, text, imageFile = null) {
  const isAnon = !currentUser;
  const imageUrl = imageFile ? await uploadImage(imageFile) : null;
  const ref = await addDoc(collection(db, "replies"), {
    postId,
    authorUid: currentUser ? currentUser.uid : null,
    authorNickname: currentUser ? (currentUserDoc?.nickname || "???") : null,
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
        ${kebabHtml(kebabItems, r.id)}
      </div>
      <div class="reply-text">${linkifyMentions(escapeHtml(r.text || ""))}</div>
      ${r.imageUrl ? `<img class="reply-img" src="${r.imageUrl}">` : ""}
      <button class="replyLikeBtn ${liked ? "liked" : ""}" data-action="likeReply">
        <span class="nf">${liked ? ICON.heartFilled : ICON.heart}</span> ${r.likesCount || 0}
      </button>
    </div>`;
}

export function wireReplyLikes(container, replies, onDeleted) {
  wireMentions(container);
  container.querySelectorAll("[data-reply-id]").forEach(row => {
    const r = replies.find(x => x.id === row.dataset.replyId);
    if (!r) return;
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
