import { applySettings } from "./settings.js";
import { initLayout, initStarfield } from "./layout.js";
import { initProfileDropdown, authReady, currentUser } from "./auth.js";
import { initViewProfileModal } from "./people.js";
import { loadFriendProfiles, removeFriend, isMutualFriend } from "./friends.js";
import { listChats, otherParticipant, openOrCreateChat } from "./dm.js";
import { getUserDoc } from "./data.js";
import { shapeClass } from "./avatar.js";
import { escapeHtml, timeAgo, showToast } from "./ui.js";
import { ICON } from "./icons.js";
import { defaultAvatar } from "./default-avatar.js";

applySettings();

function personRow(u, extraHtml = "", clickAttr = "") {
  return `
    <div class="person-row" ${clickAttr}>
      <span class="avatar-wrap" style="width:38px;height:38px;">
        <img class="avatar-shaped ${shapeClass(u.avatarShape)}" src="${u.avatarUrl || defaultAvatar()}" style="width:38px;height:38px;">
        <span class="avatar-status" style="width:16px;height:16px;font-size:9px;">${u.statusEmoji || ""}</span>
      </span>
      <div style="flex:1; min-width:0;">
        <div>${escapeHtml(u.nickname || "???")}</div>
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
      row.addEventListener("click", () => { location.href = `dm.html?chat=${row.dataset.chat}`; });
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
  const withMutual = await Promise.all(
    friends.map(async u => ({ ...u, mutual: await isMutualFriend(u.uid) }))
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
      location.href = `user.html?uid=${row.dataset.open}`;
    });
  });
  el.querySelectorAll("[data-dm]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      try {
        const chatId = await openOrCreateChat(btn.dataset.dm);
        location.href = `dm.html?chat=${chatId}`;
      } catch (err) {
        showToast(err.message);
        btn.disabled = false;
      }
    });
  });
  el.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Убрать из друзей?")) return;
      await removeFriend(btn.dataset.remove);
      showToast("Убран(а) из друзей");
      renderFriends();
    });
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  initLayout();
  initStarfield();
  initProfileDropdown();
  initViewProfileModal();
  await authReady;
  renderChats();
  renderFriends();
});
