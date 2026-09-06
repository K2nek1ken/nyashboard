import {
  db, auth, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDocs,
  query, orderBy, limit, startAfter, onSnapshot, serverTimestamp
} from "./firebase.js";
import { getGuestIdentity, setGuestNickname, syncChatNickname } from "./identity.js";
import { getSettings } from "./settings.js";
import { parseCommand, listCommands } from "./bot.js";
import { currentUser, currentUserDoc, authReady } from "./auth.js";
import { getUserDoc } from "./data.js";
import { relationBadge, badgeHtml, nameHtml, miniAvatarHtml } from "./person.js";
import { loadFriends } from "./friends.js";
import { openPersonPreview } from "./person-preview.js";
import { initChatNav, trackMentions } from "./chat-nav.js";
import { notify } from "./web-notify.js";
import { registerMessageNuid, resolveNuid } from "./nuid.js";
import { wireImageZoom } from "./lightbox.js";
import { imagesToHtml, wireCarousels } from "./carousel.js";
import { askText, askConfirm } from "./dialog.js";
import { uploadImages } from "./storage.js";
import { showToast, escapeHtml, timeAgo } from "./ui.js";
import { ICON } from "./icons.js";
import { markOwned, isOwned } from "./ownership.js";
import { linkifyMentions, wireMentions } from "./mentions.js";
import { kebabHtml, wireKebab } from "./kebab.js";
import { openEmojiPicker } from "./emoji.js";

const messagesEl = document.getElementById("chatMessages");
const nickLabel = document.getElementById("chatNickLabel");
let chatUnsub = null;
let pendingChatImages = [];

// Сколько сообщений показываем сразу и сколько добавляем за одну подгрузку
// На широком экране десять сообщений умещаются целиком, прокручивать нечего —
// и подгрузка истории просто не запускалась. Поэтому там берём больше сразу.
const PAGE_SIZE = window.matchMedia("(min-width: 900px)").matches ? 30 : 10;
let olderMessages = [];   // подгруженная история, старше живой подписки
let oldestDoc = null;     // граница, от которой продолжаем читать
let loadingOlder = false;

// Подгрузка истории при прокрутке к началу переписки.
function wireHistoryLoader() {
  window.addEventListener("scroll", async () => {
    if (loadingOlder || window.scrollY > 120 || !oldestDoc) return;
    loadingOlder = true;
    const heightBefore = document.body.scrollHeight;
    try {
      const older = await loadOlderMessages();
      if (older.length) {
        olderMessages = [...older, ...olderMessages];
        lastMessages = [...older, ...lastMessages];
        renderChat(lastMessages, { keepScroll: true });
        // сохраняем положение: иначе добавленные сверху сообщения
        // «выталкивают» переписку из виду
        window.scrollTo({ top: document.body.scrollHeight - heightBefore + window.scrollY });
      }
    } catch (e) {
      console.warn("История не догрузилась:", e.message);
    } finally {
      loadingOlder = false;
    }
  }, { passive: true });
}

async function loadOlderMessages() {
  const q = query(collection(db, "chatMessages"),
                  orderBy("createdAt", "desc"),
                  startAfter(oldestDoc),
                  limit(PAGE_SIZE));
  const snap = await getDocs(q);
  if (snap.empty) { oldestDoc = null; return []; }   // дошли до начала переписки
  oldestDoc = snap.docs[snap.docs.length - 1];
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
}
let replyingTo = null;   // { id, nickname, text }
let lastMessages = [];

export function subscribeChat() {
  nickLabel.textContent = getGuestIdentity().nickname;
  // подтягиваем ник из аккаунта: локальный мог слететь или отличаться
  syncChatNickname().then(n => { if (n) nickLabel.textContent = n; });
  if (chatUnsub) return;
  // Живая подписка только на последние сообщения: грузить всю переписку разом
  // и долго, и дорого по обращениям к базе. Остальное подтягивается порциями
  // при прокрутке вверх.
  const q = query(collection(db, "chatMessages"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
  chatUnsub = onSnapshot(q, (snap) => {
    const fresh = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    oldestDoc = snap.docs[snap.docs.length - 1] || oldestDoc;
    // склеиваем с ранее подгруженной историей, без повторов
    const seenIds = new Set(fresh.map(m => m.id));
    lastMessages = [...olderMessages.filter(m => !seenIds.has(m.id)), ...fresh];
    refreshBadges(lastMessages).then(() => {
      renderChat(lastMessages);
      reactToMeow(fresh);

      // Что считать «моим»: сообщения, отправленные с этого устройства, плюс
      // все от моего аккаунта — упоминание может прийти на любое из них.
      const mine = new Set(lastMessages
        .filter(m => isOwned("chatMessage", m.id) || (currentUser && m.authorUid === currentUser.uid))
        .map(m => m.id));
      // Уведомление о чужих сообщениях, пока вкладка в фоне
      const others = fresh.filter(m => !m.isBot && !isOwned("chatMessage", m.id));
      if (others.length) {
        const last = others[others.length - 1];
        notify("Новое в чате", `${last.nickname}: ${(last.text || "фото").slice(0, 80)}`,
               { tag: "nyash-chat" });
      }

      trackMentions(fresh, {
        myUsername: currentUserDoc?.username || null,
        myMessageIds: mine
      });
    });
  }, (err) => {
    console.error(err);
    messagesEl.innerHTML = `<div class="stub-note">Не смогла загрузить чат — проверь конфиг Firebase</div>`;
  });

  wireHistoryLoader();

  // Возврат в браузер иногда оставляет экранную клавиатуру открытой, а поле
  // ввода при этом уже не в фокусе — получается полэкрана занято впустую.
  // Снимаем фокус при уходе со страницы: тогда клавиатура закрывается сама.
  const blurInput = () => {
    if (document.hidden) document.activeElement?.blur?.();
  };
  document.addEventListener("visibilitychange", blurInput);
  window.addEventListener("pagehide", blurInput);
  initChatNav(messagesEl);
  openLinkedMessage();
}

// Узор на фоне цитаты. Символ выбирается в настройках — та же логика, что и у
// частиц фона. Позиция, поворот и размер у каждого свои, а сетка с разбросом
// не даёт им наложиться друг на друга.
// Лепесток — не символ, а настоящая форма из assets/petal.svg. Он подставляется
// маской, поэтому красится текущим акцентом так же, как обычные символы.
// Остальное — обычные глифы.
const DECOR_GLYPHS = {
  flowers: "\u2740",         // ❀
  stars:   "\u2726",         // ✦
  leaves:  "\uD83C\uDF41"     // 🍁
};
const SHAPE_DECOR = new Set(["petals"]);

function decorHtml() {
  const kind = getSettings().quoteDecor || "flowers";
  const isShape = SHAPE_DECOR.has(kind);
  const glyph = DECOR_GLYPHS[kind];
  if (!glyph && !isShape) return "";        // выбран вариант «без узора»

  const cols = 6, rows = 2;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() < 0.18) continue;    // местами пропускаем — живее
      const x = (c + 0.5) / cols * 100 + (Math.random() - 0.5) * 9;
      const y = (r + 0.5) / rows * 100 + (Math.random() - 0.5) * 30;
      const rot = Math.floor(Math.random() * 360);
      const scale = (0.7 + Math.random()).toFixed(2);   // не больше двух минимумов
      const style = `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;` +
                    `transform:translate(-50%,-50%) rotate(${rot}deg) scale(${scale})`;
      out.push(isShape
        ? `<span class="petal-shape" style="${style}"></span>`
        : `<span style="${style}">${glyph}</span>`);
    }
  }
  return out.join("");
}

function quoteHtml(m) {
  if (!m.replyToId) return "";
  const text = m.replyToText || "(сообщение удалено)";
  return `
    <div class="chat-reply-quote" data-jump="${m.replyToId}">
      <span class="petals">${decorHtml()}</span>
      <b>${escapeHtml(m.replyToNickname || "???")}</b>
      <span class="quote-text">${escapeHtml(text.slice(0, 90))}${text.length > 90 ? "…" : ""}</span>
    </div>`;
}

// Копирование в буфер. Современный способ доступен не везде (нужен защищённый
// протокол), поэтому оставлен и старый — иначе на части устройств кнопка бы
// молча ничего не делала.
async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMessage);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0;";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    showToast(ok ? okMessage : "Не вышло скопировать: " + text);
  }
}

// Пять фотографий на сообщение: больше — это уже поток загрузок на бесплатном
// хранилище. Старые сообщения хранят одну картинку в imageUrl, поэтому
// приводим оба вида к одному списку.
const MAX_CHAT_IMAGES = 5;

function chatImages(m) {
  if (m.imageUrls?.length) return m.imageUrls;
  if (m.imageUrl) return [m.imageUrl];
  return [];
}

let badges = new Map();
let meowSeen = new Set();   // чтобы не мяукать повторно на те же сообщения
let chatStarted = false;

// Кто-то написал «мяукнуть» — отзываемся звуком и подсказкой. Отключается
// в настройках. При первом открытии чата молчим: иначе вся история за день
// разом устроила бы кошачий концерт.
function reactToMeow(msgs) {
  if (!chatStarted) { msgs.forEach(m => meowSeen.add(m.id)); chatStarted = true; return; }
  if (getSettings().meowReaction === "off") return;

  const fresh = msgs.filter(m => !meowSeen.has(m.id));
  fresh.forEach(m => meowSeen.add(m.id));
  const meowed = fresh.some(m => m.isBot && /мяукнул/i.test(m.text || ""));
  if (!meowed) return;

  showToast("мяу!");
  try {
    const audio = new Audio("assets/sounds/meow.mp3");
    audio.volume = 0.6;
    audio.play().catch(() => {});   // браузер может не дать звук без действия человека
  } catch {}
}

// Метки собираем один раз на список: у каждой свой запрос про взаимность,
// и делать их во время отрисовки означало бы мигающие подписи.
async function refreshBadges(msgs) {
  const uids = [...new Set(msgs.filter(m => m.authorUid).map(m => m.authorUid))];
  if (!uids.length) return;
  await loadFriends().catch(() => {});
  await Promise.all(uids.map(async uid => {
    if (badges.has(uid)) return;
    const user = await getUserDoc(uid).catch(() => null);
    badges.set(uid, await relationBadge(uid, user).catch(() => null));
  }));
}

function renderChat(msgs, { keepScroll = false } = {}) {
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
  const wasAtBottom = !keepScroll && (nearBottom || messagesEl.childElementCount === 0);
  messagesEl.innerHTML = msgs.map(m => {
    // Сообщения бота править нельзя даже автору команды: иначе можно
    // подделать чужую фразу, выданную ботом.
    const canManage = isOwned("chatMessage", m.id) && !m.isBot;
    const kebabItems = [
      { action: "replyMsg", label: "Ответить", icon: ICON.reply },
      ...(m.publicUid ? [
        { action: "copyLink", label: "Скопировать ссылку", icon: ICON.open },
        { action: "copyNuid", label: "Скопировать NUID", icon: ICON.hash }
      ] : []),
      ...(canManage ? [
        { action: "editMsg", label: "Изменить", icon: ICON.pencil },
        { action: "deleteMsg", label: "Удалить", icon: ICON.close, danger: true }
      ] : [])
    ];
    // Сообщение либо анонимное (просто ник), либо от аккаунта — тогда рядом
    // миниатюра аватарки, имя своим цветом, метка и переход к профилю.
    const authorHtml = m.isBot
      ? `<span class="nf">${ICON.smile}</span> бот`
      : m.authorUid
        ? `<span class="person-chip" data-person="${m.authorUid}">
             ${miniAvatarHtml({ avatarUrl: m.authorAvatar, avatarShape: m.authorShape }, 20)}
             ${nameHtml({ nickname: m.nickname, nickColor: m.nickColor })}
             ${badgeHtml(badges.get(m.authorUid))}
           </span>`
        : escapeHtml(m.nickname);

    return `
    <div class="chat-msg ${m.isBot ? "is-bot" : ""}" data-id="${m.id}">
      <div class="chat-msg-head">
        <b>${authorHtml}</b>
        <span class="muted">· ${timeAgo(m.createdAt)}${m.editedAt ? '<span class="post-edited-tag">(изменено)</span>' : ""}</span>
        ${kebabHtml(kebabItems, m.id)}
      </div>
      ${quoteHtml(m)}
      ${m.text ? `<div class="txt">${linkifyMentions(escapeHtml(m.text))}</div>` : ""}
      ${imagesToHtml(chatImages(m))}
    </div>`;
  }).join("");
  // Мотаем вниз только если человек и так был внизу. Иначе при чтении старой
  // переписки каждое чужое сообщение дёргало бы страницу вниз из-под пальцев.
  if (wasAtBottom) window.scrollTo({ top: document.body.scrollHeight });

  wireMentions(messagesEl);
  wireCarousels(messagesEl);
  wireImageZoom(messagesEl);
  messagesEl.querySelectorAll("[data-person]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openPersonPreview(el.dataset.person);
    });
    // Долгое нажатие подставляет упоминание в поле ввода — так человека
    // из чата можно позвать, не переписывая его имя вручную.
    let hold = null;
    el.addEventListener("pointerdown", () => {
      hold = setTimeout(async () => {
        hold = null;
        const user = await getUserDoc(el.dataset.person).catch(() => null);
        if (!user?.username) return;
        const input = document.getElementById("chatInput");
        input.value = `${input.value}@${user.username} `.trimStart();
        input.focus();
        showToast("Упоминание добавлено");
      }, 550);
    });
    const cancel = () => { if (hold) { clearTimeout(hold); hold = null; } };
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointerleave", cancel);
  });
  messagesEl.querySelectorAll(".chat-msg").forEach(row => {
    const msgId = row.dataset.id;
    const msg = msgs.find(m => m.id === msgId);
    wireKebab(row, {
      replyMsg: () => startReply(msg),
      copyLink: () => {
        const url = `${location.origin}${location.pathname}?msg=${msg.publicUid}`;
        copyText(url, "Ссылка скопирована");
      },
      copyNuid: () => copyText(msg.publicUid, "Идентификатор скопирован"),
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
  const next = await askText("Изменить сообщение", { value: currentText, maxlength: 500 });
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
  if (!await askConfirm("Удалить сообщение?", { hint: "Отменить не получится.", okLabel: "Удалить", danger: true })) return;
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

// Переход по ссылке вида ?msg=U2XXXXXX: находим сообщение и, если его ещё нет
// на экране, догружаем историю порциями, пока не встретим. Ограничение по
// числу попыток нужно, чтобы ссылка на удалённое сообщение не крутила
// подгрузку бесконечно.
async function openLinkedMessage() {
  const nuid = new URLSearchParams(location.search).get("msg");
  if (!nuid) return;

  const hit = await resolveNuid(nuid).catch(() => null);
  if (!hit || hit.type !== "message") { showToast("Сообщение не найдено"); return; }

  for (let attempt = 0; attempt < 12; attempt++) {
    const el = messagesEl.querySelector(`.chat-msg[data-id="${hit.uid}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("is-reply-target");
      void el.offsetWidth;
      el.classList.add("is-reply-target");
      return;
    }
    if (!oldestDoc) break;              // дошли до начала переписки
    const older = await loadOlderMessages().catch(() => []);
    if (!older.length) break;
    olderMessages = [...older, ...olderMessages];
    lastMessages = [...older, ...lastMessages];
    renderChat(lastMessages, { keepScroll: true });
  }
  showToast("Сообщение слишком далеко или удалено");
}

export function initChatForm() {
  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatInput");
  const imageInput = document.getElementById("chatImageInput");
  const preview = document.getElementById("chatImagePreview");
  const changeNickBtn = document.getElementById("changeChatNickBtn");
  const emojiBtn = document.getElementById("chatEmojiBtn");

  imageInput.addEventListener("change", () => {
    const picked = Array.from(imageInput.files || []);
    imageInput.value = "";
    if (!picked.length) return;

    const room = MAX_CHAT_IMAGES - pendingChatImages.length;
    if (picked.length > room) showToast(`Максимум ${MAX_CHAT_IMAGES} фото — добавила ${Math.max(0, room)}`);
    pendingChatImages.push(...picked.slice(0, Math.max(0, room)));
    renderChatPreview();
  });

  function renderChatPreview() {
    if (!pendingChatImages.length) {
      preview.classList.add("hidden");
      preview.innerHTML = "";
      return;
    }
    preview.classList.remove("hidden");
    preview.innerHTML = pendingChatImages.map((f, i) => `
      <div class="thumb">
        <img src="${URL.createObjectURL(f)}">
        <button class="removeThumb" data-remove="${i}"><span class="nf">${ICON.close}</span></button>
      </div>`).join("");
    preview.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        pendingChatImages.splice(Number(btn.dataset.remove), 1);
        renderChatPreview();
      });
    });
  }

  if (emojiBtn) emojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEmojiPicker(form, (emoji) => { input.value += emoji; input.focus(); });
  });

  // Чекбокс появляется только у вошедших и только если это разрешено настройкой.
  // Режим «только от аккаунта» прячет анонимный ник, «только аноним» — чекбокс.
  const accountRow = document.getElementById("accountToggleRow");
  const asAccount = document.getElementById("asAccountToggle");
  const nickRow = document.querySelector(".chat-nick-row");

  authReady.then(() => {
    const mode = getSettings().chatIdentity || "both";
    const canAccount = !!currentUser && mode !== "anon";
    accountRow.classList.toggle("hidden", !canAccount);
    if (canAccount && mode === "account") {
      asAccount.checked = true;
      asAccount.disabled = true;
      nickRow.classList.add("hidden");
    }
  });

  document.getElementById("botHelpBtn")?.addEventListener("click", () => {
    const cmds = listCommands();
    const withTarget = cmds.filter(c => c.needsTarget).map(c => c.name).join(", ");
    const plain = cmds.filter(c => !c.needsTarget).map(c => c.name).join(", ");
    askConfirm("Команды бота", {
      hint: `В ответ на чьё-то сообщение: ${withTarget}. ` +
            `Просто так: ${plain}. ` +
            `Напиши команду первым словом — бот сам соберёт фразу.`,
      okLabel: "Понятно"
    });
  });

  changeNickBtn.addEventListener("click", async () => {
    const current = getGuestIdentity().nickname;
    const next = await askText("Новый ник для чата", { value: current, maxlength: 32 });
    if (next && next.trim()) {
      const identity = setGuestNickname(next.trim());
      nickLabel.textContent = identity.nickname;
      showToast("Ник обновлён ♡");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !pendingChatImages.length) return;

    try {
      const identity = getGuestIdentity();

      // Команды бота: разбираем до отправки. Если сработала — уходит готовая
      // фраза с пометкой бота вместо исходного текста.
      const speakerName = (asAccount?.checked && currentUserDoc)
        ? currentUserDoc.nickname
        : identity.nickname;
      const parsed = parseCommand(text, speakerName, replyingTo?.nickname || null);
      if (parsed?.error) { showToast(parsed.error); return; }

      const imageUrls = pendingChatImages.length ? await uploadImages(pendingChatImages) : [];
      if (imageUrls.some(u => !u)) throw new Error("Одна из картинок не загрузилась");
      // Личность сообщения: аккаунт или анонимный ник. Данные автора копируются
      // в само сообщение, чтобы список не требовал запроса профиля на каждую
      // строку — так же, как это сделано у записей ленты.
      const useAccount = !parsed && asAccount?.checked && currentUser && currentUserDoc;

      const payload = {
        guestId: identity.id,
        authorUid: useAccount ? currentUser.uid : null,
        authorAvatar: useAccount ? (currentUserDoc.avatarUrl || "") : null,
        authorShape: useAccount ? (currentUserDoc.avatarShape || "circle") : null,
        nickColor: useAccount ? (currentUserDoc.nickColor || "") : null,
        nickname: parsed ? "бот"
                : useAccount ? currentUserDoc.nickname
                : identity.nickname,
        isBot: !!parsed,
        text: parsed ? parsed.text : text,
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

      // Идентификатор сообщения: по нему можно дать ссылку или упомянуть
      // сообщение в другом месте. Записывается отдельно, потому что нужен
      // id уже созданного документа.
      // Поле и режим ответа сбрасываем сразу после отправки — раньше при команде
      // бота текст оставался в поле, и его легко было отправить повторно.
      input.value = "";
      pendingChatImages = [];
      renderChatPreview();
      replyingTo = null;
      renderReplyBar();

      registerMessageNuid(ref.id)
        .then(nuid => updateDoc(doc(db, "chatMessages", ref.id), { publicUid: nuid }))
        .catch(e => console.warn("Идентификатор сообщения не записался:", e.message));
      input.value = "";
      pendingChatImages = [];
      renderChatPreview();
      replyingTo = null;
      renderReplyBar();
    } catch (err) {
      console.error(err);
      showToast("Не отправилось: " + err.message);
    }
  });
}
