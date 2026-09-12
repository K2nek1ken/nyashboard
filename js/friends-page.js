import { initShell } from "./shell.js";
import { clearPending } from "./notify-feed.js";
import { goTo } from "./router.js";
import { keepScrollPosition } from "./session-state.js";
import { askText, askConfirm } from "./dialog.js";
import { markTabSeen, keepTabSeen, stopKeepingSeen } from "./notifications.js";
import { initRefreshButton } from "./refresh-button.js";
import { initProfileDropdown, authReady, currentUser } from "./auth.js";
import { initViewProfileModal } from "./people.js";
import { loadFriendProfiles, removeFriend, addFriend, isMutualFriend, loadIncomingRequests } from "./friends.js";
import { listChats, otherParticipant, openOrCreateChat } from "./dm.js";
import { fetchOnline, startPresence } from "./presence.js";
import { getUserDoc } from "./data.js";
import { avatarHtml } from "./avatar.js";
import { nameHtml } from "./person.js";
import { escapeHtml, timeAgo, showToast } from "./ui.js";
import { ICON } from "./icons.js";
import { defaultAvatar } from "./default-avatar.js";

function personRow(u, extraHtml = "", clickAttr = "") {
  // avatarHtml рисует и украшение, и цвет рамки, и статус — раньше здесь была
  // своя упрощённая вёрстка, и украшения в списках просто не появлялись.
  return `
    <div class="person-row" ${clickAttr}>
      <span class="${u.online ? "online-wrap" : ""}">${avatarHtml(u, 38)}</span>
      <div style="flex:1; min-width:0;">
        <div>${nameHtml(u, { clickable: false })}</div>
        <div class="pmuted">@${escapeHtml(u.username || "???")}</div>
      </div>
      ${extraHtml}
    </div>`;
}

async function renderChats() {
  const el = document.getElementById("dmList");
  if (!currentUser) { el.innerHTML = `<div class="stub-note">Войди, чтобы переписываться ♡</div>`; return; }
  try {
    const chats = await listChats();
    if (!chats.length) { el.innerHTML = `<div class="stub-note">Пока нет переписок</div>`; return; }
    const rows = await Promise.all(chats.map(async chat => {
      const otherUid = otherParticipant(chat);
      const u = (await getUserDoc(otherUid)) || {};
      const preview = chat.lastMessage
        ? `${chat.lastSender === currentUser.uid ? "ты: " : ""}${escapeHtml(chat.lastMessage)}`
        : "нет сообщений";
      return personRow(
        { ...u, uid: otherUid },
        `<div style="text-align:right; flex-shrink:0;">
           <div class="pmuted" style="max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${preview}</div>
           <div class="pmuted">${timeAgo(chat.lastAt)}</div>
         </div>`,
        `data-chat="${chat.id}"`);
    }));
    el.innerHTML = rows.join("");
    el.querySelectorAll("[data-chat]").forEach(row => {
      row.addEventListener("click", () => { goTo(`dm.html?chat=${row.dataset.chat}`); });
    });
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="stub-note">Ошибка: ${escapeHtml(e.message)}</div>`;
  }
}

async function renderFriends() {
  const el = document.getElementById("friendsList");
  if (!currentUser) { el.innerHTML = ""; return; }
  const friends = await loadFriendProfiles();
  if (!friends.length) {
    el.innerHTML = `<div class="stub-note">Друзей пока нет. Открой чей-нибудь профиль и добавь ♡</div>`;
    return;
  }
  // статус взаимности у каждого — по одному точечному запросу, список чужих
  // друзей при этом не раскрывается
  const online = await fetchOnline(friends.map(u => u.uid));
  const withMutual = await Promise.all(
    friends.map(async u => ({ ...u, mutual: await isMutualFriend(u.uid), online: online.has(u.uid) }))
  );

  el.innerHTML = withMutual.map(u => personRow(u,
    `${u.mutual
        ? `<button class="subBtn" data-dm="${u.uid}" style="flex-shrink:0;"><span class="nf">${ICON.comment}</span></button>`
        : `<span class="pmuted" style="flex-shrink:0; font-size:11px;">не взаимно</span>`}
     <button class="subBtn" data-remove="${u.uid}" style="flex-shrink:0;"><span class="nf">${ICON.close}</span></button>`,
    `data-open="${u.uid}"`)).join("");

  el.querySelectorAll("[data-open]").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-dm],[data-remove]")) return;
      goTo(`user.html?uid=${row.dataset.open}`);
    });
  });
  el.querySelectorAll("[data-dm]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      try {
        const chatId = await openOrCreateChat(btn.dataset.dm);
        goTo(`dm.html?chat=${chatId}`);
      } catch (err) {
        showToast(err.message);
        btn.disabled = false;
      }
    });
  });
  el.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!await askConfirm("Убрать из друзей?", { hint: "Записи этого человека перестанут подниматься в ленте.", okLabel: "Убрать", danger: true })) return;
      await removeFriend(btn.dataset.remove);
      showToast("Убрали из друзей");
      renderFriends();
    });
  });
}

// Заявки: люди, добавившие тебя, но пока не добавленные в ответ. Принять —
// значит добавить их к себе, после чего откроется личная переписка.
async function renderRequests() {
  const block = document.getElementById("requestsBlock");
  const el = document.getElementById("requestsList");
  if (!currentUser) { block.classList.add("hidden"); return; }

  const uids = await loadIncomingRequests();
  if (!uids.length) { block.classList.add("hidden"); return; }

  const people = await Promise.all(uids.map(async uid => {
    const u = await getUserDoc(uid).catch(() => null);
    return { uid, ...(u || { nickname: "неизвестный", username: "???" }) };
  }));

  block.classList.remove("hidden");
  el.innerHTML = people.map(u => personRow(u,
    `<button class="subBtn" data-accept="${u.uid}" style="flex-shrink:0;">Принять</button>`,
    `data-open="${u.uid}"`)).join("");

  el.querySelectorAll("[data-accept]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      try {
        await addFriend(btn.dataset.accept);
        showToast("Теперь вы друзья ♡");
        renderRequests();
        renderFriends();
      } catch (err) {
        showToast("Ошибка: " + err.message);
        btn.disabled = false;
      }
    });
  });
  el.querySelectorAll("[data-open]").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-accept]")) return;
      goTo(`user.html?uid=${row.dataset.open}`);
    });
  });
}

// ============================================================
//  Запуск и сворачивание вкладки
//
//  Переход между вкладками не перезагружает страницу (см. router.js),
//  поэтому содержимое нужно уметь и включать, и выключать: живые подписки
//  на базу обязаны закрываться, иначе с каждым переходом их копилось бы
//  всё больше.
// ============================================================
export async function initPage() {
  clearPending("requests");   // всё увиденное больше не копится
  markTabSeen("friends");
  keepTabSeen("friends");
  keepScrollPosition();
  initViewProfileModal();
  await authReady;
  startPresence();
  renderRequests();
  renderChats();
  renderFriends();
  initRefreshButton(async () => { await renderChats(); await renderFriends(); });
}

export function destroyPage() {
  stopKeepingSeen();
  stopPage?.();
}

// Что закрыть при уходе — заполняется при запуске
let stopPage = null;

// Первая загрузка: сначала общая оболочка, затем содержимое вкладки
initShell();   // один раз на всю жизнь страницы

window.addEventListener("DOMContentLoaded", async () => {
  const { initRouter } = await import("./router.js");
  await initPage();
  initRouter({ initPage, destroyPage });
});
