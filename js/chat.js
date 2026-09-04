import {
  db, auth, collection, addDoc, doc, setDoc, updateDoc, deleteDoc,
  query, orderBy, limit, onSnapshot, serverTimestamp
} from "./firebase.js";
import { getGuestIdentity, setGuestNickname } from "./identity.js";
import { uploadImage } from "./storage.js";
import { showToast, escapeHtml, timeAgo } from "./ui.js";
import { ICON } from "./icons.js";
import { markOwned, isOwned } from "./ownership.js";
import { linkifyMentions, wireMentions } from "./mentions.js";
import { kebabHtml, wireKebab } from "./kebab.js";
import { openEmojiPicker } from "./emoji.js";

const messagesEl = document.getElementById("chatMessages");
const nickLabel = document.getElementById("chatNickLabel");
let chatUnsub = null;
let pendingChatImage = null;
let replyingTo = null;   // { id, nickname, text }
let lastMessages = [];

export function subscribeChat() {
  nickLabel.textContent = getGuestIdentity().nickname;
  if (chatUnsub) return;
  // Сортировка ОБЯЗАТЕЛЬНО по убыванию: limit берёт первые N в порядке запроса,
  // так что с "asc" мы получали бы вечно одни и те же 100 САМЫХ СТАРЫХ сообщений,
  // и после сотого сообщения чат просто перестал бы обновляться. Берём сотню
  // свежих и разворачиваем на клиенте, чтобы на экране был привычный порядок.
  const q = query(collection(db, "chatMessages"), orderBy("createdAt", "desc"), limit(100));
  chatUnsub = onSnapshot(q, (snap) => {
    lastMessages = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    renderChat(lastMessages);
  }, (err) => {
    console.error(err);
    messagesEl.innerHTML = `<div class="stub-note">Не смогла загрузить чат — проверь конфиг Firebase</div>`;
  });
}

// Цветочки на фоне цитаты. Раньше это была строка символов с фиксированным
// межбуквенным интервалом — получалась ровная сетка, слишком похожая на узор.
// Теперь позиция, поворот и размер у каждого свои, а сетка с небольшим
// разбросом не даёт им наложиться друг на друга.
function petalsHtml(seed = 10) {
  const cols = 6, rows = 2;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() < 0.18) continue;            // местами пропускаем — живее
      const x = (c + 0.5) / cols * 100 + (Math.random() - 0.5) * 9;
      const y = (r + 0.5) / rows * 100 + (Math.random() - 0.5) * 30;
      const rot = Math.floor(Math.random() * 360);
      const scale = (0.7 + Math.random()).toFixed(2);  // не больше двух минимумов
      out.push(`<span style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;` +
               `transform:translate(-50%,-50%) rotate(${rot}deg) scale(${scale})">✿</span>`);
    }
  }
  return out.join("");
}

function quoteHtml(m) {
  if (!m.replyToId) return "";
  const text = m.replyToText || "(сообщение удалено)";
  return `
    <div class="chat-reply-quote" data-jump="${m.replyToId}">
      <span class="petals">${petalsHtml()}</span>
      <b>${escapeHtml(m.replyToNickname || "???")}</b>
      <span class="quote-text">${escapeHtml(text.slice(0, 90))}${text.length > 90 ? "…" : ""}</span>
    </div>`;
}

function renderChat(msgs) {
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
  const wasAtBottom = nearBottom || messagesEl.childElementCount === 0;
  messagesEl.innerHTML = msgs.map(m => {
    const canManage = isOwned("chatMessage", m.id);
    const kebabItems = [
      { action: "replyMsg", label: "Ответить", icon: ICON.reply },
      ...(canManage ? [
        { action: "editMsg", label: "Изменить", icon: ICON.pencil },
        { action: "deleteMsg", label: "Удалить", icon: ICON.close, danger: true }
      ] : [])
    ];
    return `
    <div class="chat-msg" data-id="${m.id}">
      <div class="chat-msg-head">
        <b>${escapeHtml(m.nickname)}</b>
        <span class="muted">· ${timeAgo(m.createdAt)}${m.editedAt ? '<span class="post-edited-tag">(изменено)</span>' : ""}</span>
        ${kebabHtml(kebabItems, m.id)}
      </div>
      ${quoteHtml(m)}
      ${m.text ? `<div class="txt">${linkifyMentions(escapeHtml(m.text))}</div>` : ""}
      ${m.imageUrl ? `<img src="${m.imageUrl}">` : ""}
    </div>`;
  }).join("");
  // Мотаем вниз только если человек и так был внизу. Иначе при чтении старой
  // переписки каждое чужое сообщение дёргало бы страницу вниз из-под пальцев.
  if (wasAtBottom) window.scrollTo({ top: document.body.scrollHeight });

  wireMentions(messagesEl);
  messagesEl.querySelectorAll(".chat-msg").forEach(row => {
    const msgId = row.dataset.id;
    const msg = msgs.find(m => m.id === msgId);
    wireKebab(row, {
      replyMsg: () => startReply(msg),
      editMsg: () => editMessage(msgId, row),
      deleteMsg: () => deleteMessage(msgId)
    });
  });

  // клик по цитате — прыжок к оригиналу с подсветкой
  messagesEl.querySelectorAll("[data-jump]").forEach(q => {
    q.addEventListener("click", () => {
      const target = messagesEl.querySelector(`.chat-msg[data-id="${q.dataset.jump}"]`);
      if (!target) { showToast("Сообщение не найдено — возможно, удалено"); return; }
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.remove("is-reply-target");
      void target.offsetWidth;  // рестарт анимации
      target.classList.add("is-reply-target");
    });
  });
}

function startReply(msg) {
  if (!msg) return;
  replyingTo = { id: msg.id, nickname: msg.nickname, text: msg.text || "(фото)" };
  renderReplyBar();
  document.getElementById("chatInput").focus();
}

function renderReplyBar() {
  const host = document.getElementById("replyComposeHost");
  if (!host) return;
  if (!replyingTo) { host.innerHTML = ""; return; }
  host.innerHTML = `
    <div class="reply-compose-bar">
      <span class="nf">${ICON.reply}</span>
      <span>ответ <b>${escapeHtml(replyingTo.nickname)}</b>: ${escapeHtml(replyingTo.text.slice(0, 40))}${replyingTo.text.length > 40 ? "…" : ""}</span>
      <button class="cancelReply nf" title="отменить">${ICON.close}</button>
    </div>`;
  host.querySelector(".cancelReply").addEventListener("click", () => {
    replyingTo = null;
    renderReplyBar();
  });
}

async function editMessage(msgId, row) {
  const currentText = row.querySelector(".txt")?.textContent || "";
  const next = prompt("Изменить сообщение:", currentText);
  if (next === null || !next.trim() || next.trim() === currentText) return;
  try {
    await updateDoc(doc(db, "chatMessages", msgId), { text: next.trim(), editedAt: serverTimestamp() });
    showToast("Изменено ♡");
  } catch (e) {
    console.error(e);
    showToast("Не удалось изменить: " + e.message);
  }
}

async function deleteMessage(msgId) {
  if (!confirm("Удалить сообщение?")) return;
  try {
    await deleteDoc(doc(db, "chatMessages", msgId));
    showToast("Удалено");
  } catch (e) {
    console.error(e);
    // Частый случай у гостей: анонимная сессия сменилась (её удалила
    // автоочистка в Firebase или человек почистил данные браузера), и запись
    // о владении указывает на идентификатор, которого больше нет.
    const lost = /permission|insufficient/i.test(e.message);
    showToast(lost
      ? "Не выходит: сообщение отправлено с другой гостевой сессии"
      : "Не удалилось: " + e.message);
  }
}

export function initChatForm() {
  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatInput");
  const imageInput = document.getElementById("chatImageInput");
  const preview = document.getElementById("chatImagePreview");
  const changeNickBtn = document.getElementById("changeChatNickBtn");
  const emojiBtn = document.getElementById("chatEmojiBtn");

  imageInput.addEventListener("change", () => {
    const file = imageInput.files[0];
    if (!file) return;
    pendingChatImage = file;
    preview.classList.remove("hidden");
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}"><button class="removeImg" data-remove><span class="nf">${ICON.close}</span></button>`;
    preview.querySelector("[data-remove]").addEventListener("click", () => {
      pendingChatImage = null;
      imageInput.value = "";
      preview.classList.add("hidden");
      preview.innerHTML = "";
    });
  });

  if (emojiBtn) emojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEmojiPicker(form, (emoji) => { input.value += emoji; input.focus(); });
  });

  changeNickBtn.addEventListener("click", () => {
    const current = getGuestIdentity().nickname;
    const next = prompt("Новый ник для чата:", current);
    if (next && next.trim()) {
      const identity = setGuestNickname(next.trim());
      nickLabel.textContent = identity.nickname;
      showToast("Ник обновлён ♡");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !pendingChatImage) return;

    try {
      const imageUrl = pendingChatImage ? await uploadImage(pendingChatImage) : null;
      const identity = getGuestIdentity();
      const payload = {
        guestId: identity.id,
        nickname: identity.nickname,
        text,
        imageUrl,
        createdAt: serverTimestamp()
      };
      // цитату сохраняем прямо в сообщении: так она переживёт удаление оригинала
      // и не требует лишнего чтения при рендере
      if (replyingTo) {
        payload.replyToId = replyingTo.id;
        payload.replyToNickname = replyingTo.nickname;
        payload.replyToText = replyingTo.text.slice(0, 120);
      }
      const ref = await addDoc(collection(db, "chatMessages"), payload);
      await setDoc(doc(db, "chatMessageSecrets", ref.id), { ownerUid: auth.currentUser.uid });
      markOwned("chatMessage", ref.id);
      input.value = "";
      pendingChatImage = null;
      imageInput.value = "";
      preview.classList.add("hidden");
      preview.innerHTML = "";
      replyingTo = null;
      renderReplyBar();
    } catch (err) {
      console.error(err);
      showToast("Не отправилось: " + err.message);
    }
  });
}
