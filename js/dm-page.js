import { initShell } from "./shell.js";
import { paletteColor } from "./palette.js";
import { clearPending } from "./notify-feed.js";
import { goTo } from "./router.js";
import { askText, askConfirm } from "./dialog.js";

import { keepScrollPosition } from "./session-state.js";
import { initProfileDropdown, authReady, currentUser } from "./auth.js";
import { subscribeMessages, sendMessage, editMessage, deleteMessage, otherParticipant } from "./dm.js";
import { db, doc, getDoc } from "./firebase.js";
import { getUserDoc } from "./data.js";
import { uploadImage } from "./storage.js";
import { avatarHtml } from "./avatar.js";
import { escapeHtml, timeAgo, showToast, setText } from "./ui.js";
import { linkifyMentions, wireMentions } from "./mentions.js";
import { kebabHtml, wireKebab } from "./kebab.js";
import { openEmojiPicker } from "./emoji.js";
import { ICON } from "./icons.js";
import { initChatNav } from "./chat-nav.js";
import { parseCommand } from "./bot.js";
import { getSettings } from "./settings.js";
import { getAlias, setAlias } from "./aliases.js";
import { isMutualFriend } from "./friends.js";
import { currentUserDoc } from "./auth.js";
import { defaultAvatar } from "./default-avatar.js";

const chatId = new URLSearchParams(location.search).get("chat");
let pendingImage = null;
let replyingTo = null;
let otherUid = null;
let otherUser = null;

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

let lastMessages = [];

function render(msgs) {
  lastMessages = msgs;
  const el = document.getElementById("dmMessages");
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
  const wasAtBottom = nearBottom || el.childElementCount === 0;

  // Как называть собеседника: его ником, нейтрально или своим словом.
  // Если ты переименовал его для себя — это имя главнее всего.
  const settings = getSettings();
  const alias = getAlias(otherUid);
  const theirName = alias
    || (settings.dmNaming === "neutral" ? "собеседник"
      : settings.dmNaming === "custom" ? (settings.dmCustomName || "собеседник")
      : (otherUser?.nickname || "собеседник"));

  el.innerHTML = msgs.map(m => {
    // Сообщение бота — ничьё: оно встаёт по центру и подписывается им самим,
    // как в общем чате. Удалить его может тот, чья команда его вызвала,
    // а изменить нельзя никому — иначе легко подделать выданную им фразу.
    // Сообщение бота принадлежит тому, кто вызвал команду — иначе после
    // перезахода своё же становится не убрать.
    const fromMe = m.senderUid === currentUser?.uid
                || (m.isBot && m.invokedByUid === currentUser?.uid);
    const mine = fromMe && !m.isBot;
    const canEdit = mine;
    const items = [
      { action: "replyMsg", label: "Ответить", icon: ICON.reply },
      ...(canEdit ? [
        { action: "editMsg", label: "Изменить", icon: ICON.pencil }
      ] : []),
      ...(fromMe ? [
        { action: "deleteMsg", label: "Удалить", icon: ICON.close, danger: true }
      ] : [])
    ];
    return `
      <div class="chat-msg ${mine ? "is-mine" : ""} ${m.isBot ? "is-bot" : ""}" data-id="${m.id}">
        <div class="chat-msg-head">
          ${m.isBot
            ? `<span class="person-chip">${avatarHtml({}, 22, "", "bot")}meowbot</span>`
            : `<b ${!fromMe && otherUser?.nickColor ? `style="color:${paletteColor(otherUser.nickColor)}"` : ""}>${fromMe ? "ты" : escapeHtml(theirName)}</b>`}
          <span class="muted">· ${timeAgo(m.createdAt)}${m.editedAt ? '<span class="post-edited-tag">(изменено)</span>' : ""}</span>
          ${kebabHtml(items, m.id)}
        </div>
        ${m.replyToId ? `
          <div class="chat-reply-quote" data-jump="${m.replyToId}">
            <b>${escapeHtml(m.replyToNickname || "сообщение")}</b>
            <span class="quote-text">${escapeHtml((m.replyToText || "").slice(0, 90))}</span>
          </div>` : ""}
        ${m.text ? `<div class="txt ${/мяукнул/i.test(m.text) ? "meow-again" : ""}"
                         ${/мяукнул/i.test(m.text) ? 'title="нажми, чтобы услышать"' : ""}
                    >${linkifyMentions(escapeHtml(m.text))}</div>` : ""}
        ${m.imageUrl ? `<img src="${m.imageUrl}">` : ""}
      </div>`;
  }).join("");

  if (wasAtBottom) window.scrollTo({ top: document.body.scrollHeight });
  wireMentions(el);

  // «мяу» можно услышать в любой момент — как и в общем чате
  el.querySelectorAll(".meow-again").forEach(node => {
    node.addEventListener("click", () => {
      showToast("мяу!");
      try {
        const audio = new Audio("assets/sounds/meow.mp3");
        audio.volume = 0.6;
        audio.play().catch(() => {});
      } catch {}
    });
  });
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
          nickname: msg.senderUid === currentUser?.uid ? "себе" : theirName,
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

  otherUid = otherParticipant({ id: chatId, ...chatSnap.data() });
  const u = (await getUserDoc(otherUid)) || {};
  otherUser = u;
  // Цвет ника — тот, что человек выбрал у себя: в сообщениях он уже
  // применялся, а в шапке имя оставалось белым.
  const nickEl = setText("dmNickname", getAlias(otherUid) || u.nickname || "???");
  if (nickEl) nickEl.style.color = u.nickColor ? paletteColor(u.nickColor) : "";
  setText("dmUsername", u.username || "???");
  // Аватарка со всем оформлением: своя вёрстка здесь теряла и рамку,
  // и украшение — как это было на странице человека.
  const avHost = document.getElementById("dmAvatarHost");
  if (avHost) {
    avHost.innerHTML = avatarHtml({
      ...u,
      accessory: u.accessory || "none",
      avatarBorder: u.avatarBorder || "pink"
    }, 44);
  }
  document.getElementById("dmHeader")?.addEventListener("click", () => {
    goTo(`user.html?uid=${otherUid}`);
  });

  // Переименование для себя — как в записанных контактах: имя видно только тебе.
  document.getElementById("dmRenameBtn")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    const next = await askText("Как называть этого человека", {
      value: getAlias(otherUid) || "",
      placeholder: u.nickname || "",
      hint: "Имя видно только тебе. Пустое поле вернёт настоящее.",
      maxlength: 40
    });
    if (next === null) return;
    setAlias(otherUid, next);
    showToast(next ? "Переименован ♡" : "Имя возвращено");
    // цвет сохраняется и после переименования: имя своё, а цвет его
    const el = setText("dmNickname", next || u.nickname || "???");
    if (el) el.style.color = u.nickColor ? paletteColor(u.nickColor) : "";
    render(lastMessages);
  });
  document.title = `NyashBoard ♡ — ${u.nickname || "чат"}`;

  initChatNav(el);

  // см. keepInputClearance в chat.js: панель ввода растёт вместе с текстом,
  // и переписка должна отодвигаться, а не прятаться под ней
  const bar = document.querySelector(".chat-floating-bar");
  if (bar && "ResizeObserver" in window) {
    const apply = () => { el.style.paddingBottom = (bar.offsetHeight + 24) + "px"; };
    apply();
    new ResizeObserver(apply).observe(bar);
  }

  // Поле растёт по мере набора: длинное сообщение не должно набираться
  // в одну строку вслепую.
  const dmInput = document.getElementById("dmInput");
  if (dmInput) {
    const grow = () => {
      dmInput.style.height = "auto";
      dmInput.style.height = Math.min(dmInput.scrollHeight, 160) + "px";
    };
    dmInput.addEventListener("input", grow);
    // Enter отправляет, Shift+Enter переносит строку — как принято в мессенджерах
    dmInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        document.getElementById("dmForm")?.requestSubmit();
      }
    });
    grow();
  }

  // Переписка доступна только взаимным друзьям. Если дружбы больше нет,
  // историю оставляем, а поле ввода убираем и объясняем причину — иначе
  // человек упирался бы в молчаливый отказ при отправке.
  (async () => {
    const mutual = await isMutualFriend(otherUid).catch(() => false);
    if (mutual) return;
    const bar = document.querySelector(".chat-floating-bar");
    if (!bar) return;
    bar.innerHTML = `<div class="dm-broken">
      Вы больше не друзья. Чтобы продолжить общаться, добавьте друг друга снова.
    </div>`;
  })();

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
    preview.innerHTML = `
      <div class="thumb">
        <img src="${URL.createObjectURL(file)}" alt="">
        <button class="removeThumb" data-remove title="убрать"><span class="nf">${ICON.close}</span></button>
      </div>`;
    preview.querySelector("[data-remove]").addEventListener("click", () => {
      pendingImage = null; imageInput.value = "";
      preview.classList.add("hidden"); preview.innerHTML = "";
    });
  });

  document.getElementById("dmEmojiBtn")?.addEventListener("click", (e) => {
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
      const parsed = parseCommand(text, myName, replyingTo ? theirName : null);
      if (parsed?.error) { showToast(parsed.error); return; }

      const imageUrl = pendingImage ? await uploadImage(pendingImage) : null;
      await sendMessage(chatId, parsed ? parsed.text : text, imageUrl, {
        isBot: !!parsed,
        invokedByUid: parsed ? (currentUser?.uid || null) : null,
        replyTo: replyingTo
      });
      replyingTo = null;
      renderReplyBar();
      input.value = ""; pendingImage = null; imageInput.value = "";
      preview.classList.add("hidden"); preview.innerHTML = "";
    } catch (err) {
      // Отказ базы означает, что дружба больше не взаимная: писать нельзя,
      // но читать историю по-прежнему можно.
      if (/permission|insufficient/i.test(err.message)) {
        showToast("Переписка закрыта — вы больше не друзья");
        input.value = text;
        return;
      }
      console.error(err);
      showToast("Не отправилось: " + err.message);
    }
  });
}

initShell();   // шапка, оформление и плеер — общие для всех страниц

// Запуск и сворачивание вкладки — см. router.js: страница подгружается
// без перезагрузки, поэтому её содержимое нужно уметь включать заново.
export async function initPage() {
  clearPending("dm");
  keepScrollPosition();
  init();
}

export function destroyPage() {
  stopPage?.();
  stopPage = null;
}

let stopPage = null;

window.addEventListener("DOMContentLoaded", async () => {
  const { initRouter } = await import("./router.js");

  // Сбой вкладки не должен ронять всё остальное. Раньше ошибка здесь
  // прерывала загрузку целиком: роутер не запускался, обработчики входа
  // не навешивались — и человек не мог даже войти в аккаунт, пока
  // не уходил на другую вкладку.
  try {
    await initPage();
  } catch (e) {
    console.error("Вкладка не запустилась:", e);
    const { showPageError } = await import("./page-error.js");
    showPageError(e);
  }

  initRouter({ initPage, destroyPage });
});
