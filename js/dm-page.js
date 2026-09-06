import { applySettings } from "./settings.js";
import { askText, askConfirm } from "./dialog.js";
import { initLayout, initStarfield } from "./layout.js";
import { initSettingsModal } from "./settings-modal.js";
import { applyFavicon } from "./favicon.js";
import { paintTabDots, startTabPolling } from "./notifications.js";
import { startPresence } from "./presence.js";
import { initProfileDropdown, authReady, currentUser } from "./auth.js";
import { subscribeMessages, sendMessage, editMessage, deleteMessage, otherParticipant } from "./dm.js";
import { db, doc, getDoc } from "./firebase.js";
import { getUserDoc } from "./data.js";
import { uploadImage } from "./storage.js";
import { shapeClass } from "./avatar.js";
import { escapeHtml, timeAgo, showToast } from "./ui.js";
import { linkifyMentions, wireMentions } from "./mentions.js";
import { kebabHtml, wireKebab } from "./kebab.js";
import { openEmojiPicker } from "./emoji.js";
import { ICON } from "./icons.js";
import { initChatNav } from "./chat-nav.js";
import { parseCommand } from "./bot.js";
import { currentUserDoc } from "./auth.js";
import { defaultAvatar } from "./default-avatar.js";

applySettings();
// Шапку рисуем немедленно: она не должна мигать пустотой,
// пока страница ждёт DOMContentLoaded.
initLayout();
applyFavicon();
paintTabDots();
startTabPolling();
startPresence();

const chatId = new URLSearchParams(location.search).get("chat");
let pendingImage = null;
let replyingTo = null;

function renderReplyBar() {
  const host = document.getElementById("dmReplyHost");
  if (!host) return;
  if (!replyingTo) { host.innerHTML = ""; return; }
  host.innerHTML = `
    <div class="reply-compose-bar">
      <span class="nf">${ICON.reply}</span>
      <span>ответ: ${escapeHtml(replyingTo.text.slice(0, 40))}</span>
      <button class="cancelReply nf" title="отменить">${ICON.close}</button>
    </div>`;
  host.querySelector(".cancelReply").addEventListener("click", () => {
    replyingTo = null;
    renderReplyBar();
  });
}

function render(msgs) {
  const el = document.getElementById("dmMessages");
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
  const wasAtBottom = nearBottom || el.childElementCount === 0;

  el.innerHTML = msgs.map(m => {
    // Сообщения бота не редактируются даже автором команды — как и в общем
    // чате: иначе можно подделать выданную ботом фразу.
    const mine = m.senderUid === currentUser?.uid && !m.isBot;
    const items = [
      { action: "replyMsg", label: "Ответить", icon: ICON.reply },
      ...(mine ? [
        { action: "editMsg", label: "Изменить", icon: ICON.pencil },
        { action: "deleteMsg", label: "Удалить", icon: ICON.close, danger: true }
      ] : [])
    ];
    return `
      <div class="chat-msg ${mine ? "mine" : ""}" data-id="${m.id}">
        <div class="chat-msg-head">
          <b>${mine ? "ты" : "собеседник"}</b>
          <span class="muted">· ${timeAgo(m.createdAt)}${m.editedAt ? '<span class="post-edited-tag">(изменено)</span>' : ""}</span>
          ${kebabHtml(items, m.id)}
        </div>
        ${m.replyToId ? `
          <div class="chat-reply-quote" data-jump="${m.replyToId}">
            <b>${escapeHtml(m.replyToNickname || "сообщение")}</b>
            <span class="quote-text">${escapeHtml((m.replyToText || "").slice(0, 90))}</span>
          </div>` : ""}
        ${m.text ? `<div class="txt">${linkifyMentions(escapeHtml(m.text))}</div>` : ""}
        ${m.imageUrl ? `<img src="${m.imageUrl}">` : ""}
      </div>`;
  }).join("");

  if (wasAtBottom) window.scrollTo({ top: document.body.scrollHeight });
  wireMentions(el);
  el.querySelectorAll("[data-jump]").forEach(q => {
    q.addEventListener("click", () => {
      const target = el.querySelector(`.chat-msg[data-id="${q.dataset.jump}"]`);
      if (!target) { showToast("Сообщение не найдено"); return; }
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.remove("is-reply-target");
      void target.offsetWidth;
      target.classList.add("is-reply-target");
    });
  });

  el.querySelectorAll(".chat-msg").forEach(row => {
    const id = row.dataset.id;
    wireKebab(row, {
      replyMsg: () => {
        const msg = msgs.find(x => x.id === id);
        replyingTo = msg ? {
          id: msg.id,
          nickname: msg.senderUid === currentUser?.uid ? "себе" : "собеседнику",
          text: msg.text || "(фото)"
        } : null;
        renderReplyBar();
        document.getElementById("dmInput").focus();
      },
      editMsg: async () => {
        const cur = row.querySelector(".txt")?.textContent || "";
        const next = await askText("Изменить сообщение", { value: cur, maxlength: 500 });
        if (next === null || !next.trim() || next.trim() === cur) return;
        try { await editMessage(chatId, id, next.trim()); }
        catch (e) { showToast("Не вышло: " + e.message); }
      },
      deleteMsg: async () => {
        if (!await askConfirm("Удалить сообщение?", { okLabel: "Удалить", danger: true })) return;
        try { await deleteMessage(chatId, id); }
        catch (e) { showToast("Не вышло: " + e.message); }
      }
    });
  });
}

async function init() {
  const el = document.getElementById("dmMessages");
  if (!chatId) { el.innerHTML = `<div class="stub-note">Чат не указан</div>`; return; }
  await authReady;
  if (!currentUser) { el.innerHTML = `<div class="stub-note">Войди, чтобы открыть переписку</div>`; return; }

  const chatSnap = await getDoc(doc(db, "dmChats", chatId)).catch(() => null);
  if (!chatSnap?.exists()) { el.innerHTML = `<div class="stub-note">Чат недоступен</div>`; return; }

  const otherUid = otherParticipant({ id: chatId, ...chatSnap.data() });
  const u = (await getUserDoc(otherUid)) || {};
  document.getElementById("dmNickname").textContent = u.nickname || "???";
  document.getElementById("dmUsername").textContent = u.username || "???";
  document.getElementById("dmStatus").textContent = u.statusEmoji || "";
  const av = document.getElementById("dmAvatar");
  av.src = u.avatarUrl || defaultAvatar();
  av.className = `avatar-shaped ${shapeClass(u.avatarShape)}`;
  document.getElementById("dmHeader").addEventListener("click", () => {
    location.href = `user.html?uid=${otherUid}`;
  });
  document.title = `NyashBoard ♡ — ${u.nickname || "чат"}`;

  initChatNav(el);

  // см. комментарий в chat.js: снимаем фокус, чтобы экранная клавиатура
  // не оставалась открытой после возврата в браузер
  const blurInput = () => { if (document.hidden) document.activeElement?.blur?.(); };
  document.addEventListener("visibilitychange", blurInput);
  window.addEventListener("pagehide", blurInput);
  subscribeMessages(chatId, render, (err) => {
    el.innerHTML = `<div class="stub-note">Ошибка: ${escapeHtml(err.message)}</div>`;
  });

  const form = document.getElementById("dmForm");
  const input = document.getElementById("dmInput");
  const imageInput = document.getElementById("dmImageInput");
  const preview = document.getElementById("dmImagePreview");

  imageInput.addEventListener("change", () => {
    const file = imageInput.files[0];
    if (!file) return;
    pendingImage = file;
    preview.classList.remove("hidden");
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}"><button class="removeImg" data-remove><span class="nf">${ICON.close}</span></button>`;
    preview.querySelector("[data-remove]").addEventListener("click", () => {
      pendingImage = null; imageInput.value = "";
      preview.classList.add("hidden"); preview.innerHTML = "";
    });
  });

  document.getElementById("dmEmojiBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    openEmojiPicker(form, (emoji) => { input.value += emoji; input.focus(); });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !pendingImage) return;
    try {
      // Команды бота работают и в личке — раньше они разбирались только
      // в общем чате, хотя логика одна и та же.
      const myName = currentUserDoc?.nickname || "ты";
      const parsed = parseCommand(text, myName, replyingTo ? "собеседника" : null);
      if (parsed?.error) { showToast(parsed.error); return; }

      const imageUrl = pendingImage ? await uploadImage(pendingImage) : null;
      await sendMessage(chatId, parsed ? parsed.text : text, imageUrl, {
        isBot: !!parsed,
        replyTo: replyingTo
      });
      replyingTo = null;
      renderReplyBar();
      input.value = ""; pendingImage = null; imageInput.value = "";
      preview.classList.add("hidden"); preview.innerHTML = "";
    } catch (err) {
      console.error(err);
      showToast("Не отправилось: " + err.message);
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  initSettingsModal();
  initStarfield();
  initProfileDropdown();
  init();
});
