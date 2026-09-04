import { listAllUsers, getUserDoc } from "./data.js";
import { loadUserFeed, renderPostsInto } from "./feed.js";
import { currentUser, authReady } from "./auth.js";
import { escapeHtml } from "./ui.js";
import { shapeClass } from "./avatar.js";
import { resolveNuid } from "./nuid.js";

const listEl = document.getElementById("peopleList");
const searchEl = document.getElementById("peopleSearch");
let allUsers = [];

export async function loadPeopleTab() {
  listEl.innerHTML = `<div class="stub-note">Загружаю людей...</div>`;
  allUsers = await listAllUsers();
  renderPeople(allUsers);
}

function renderPeople(users) {
  if (!users.length) { listEl.innerHTML = `<div class="stub-note">Пока тут никого нет</div>`; return; }
  listEl.innerHTML = users.map(u => `
    <div class="person-row" data-uid="${u.uid}">
      <span class="avatar-wrap" style="width:38px;height:38px;">
        <img class="avatar-shaped ${shapeClass(u.avatarShape)}" src="${u.avatarUrl || "assets/anon.svg"}" style="width:38px;height:38px;">
        <span class="avatar-status" style="width:16px;height:16px;font-size:9px;">${u.statusEmoji || ""}</span>
      </span>
      <div>
        <div>${escapeHtml(u.nickname)}</div>
        <div class="pmuted">@${escapeHtml(u.username)}</div>
      </div>
    </div>`).join("");
  listEl.querySelectorAll(".person-row").forEach(row => {
    row.addEventListener("click", () => openUserProfile(row.dataset.uid));
  });
}

export function initPeopleSearch() {
  // ?q=... приходит при клике по #U1666777 в тексте поста
  const preset = new URLSearchParams(location.search).get("q");
  if (preset) {
    searchEl.value = preset;
    setTimeout(() => searchEl.dispatchEvent(new Event("input")), 0);
  }
  searchEl.addEventListener("input", async () => {
    const q = searchEl.value.trim().toLowerCase();
    if (!q) { renderPeople(allUsers); return; }

    // Введённый NUID ищем точечным запросом по индексу: список профилей его
    // больше не содержит, поэтому обычной фильтрацией по массиву не найти.
    if (/^u[14]\d{6}$/.test(q)) {
      const hit = await resolveNuid(q);
      if (hit) {
        const user = allUsers.find(u => u.uid === hit.uid);
        if (user) { renderPeople([user]); return; }
        openUserProfile(hit.uid);
        return;
      }
      listEl.innerHTML = `<div class="stub-note">По этому NUID никого не нашла</div>`;
      return;
    }
    renderPeople(allUsers.filter(u =>
      u.nickname?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q)
    ));
  });
}

export async function openUserProfile(uid) {
  const modal = document.getElementById("viewProfileModal");
  const nameEl = document.getElementById("vpNickname");
  const userEl = document.getElementById("vpUsername");
  const avatarEl = document.getElementById("vpAvatar");
  const postsEl = document.getElementById("vpPosts");
  const fullLinkEl = document.getElementById("vpFullProfileLink");

  modal.classList.remove("hidden");
  postsEl.innerHTML = `<div class="stub-note">Загружаю...</div>`;
  await authReady;
  const isSelf = currentUser && uid === currentUser.uid;
  if (fullLinkEl) fullLinkEl.href = isSelf ? "profile.html" : `user.html?uid=${uid}`;

  const user = await getUserDoc(uid);
  if (!user) { postsEl.innerHTML = `<div class="stub-note">Профиль не найден</div>`; return; }

  nameEl.textContent = user.nickname;
  userEl.textContent = user.username;
  avatarEl.src = user.avatarUrl || "assets/anon.svg";
  avatarEl.className = `avatar-shaped ${shapeClass(user.avatarShape)}`;
  const statusEl = document.getElementById("vpStatus");
  if (statusEl) statusEl.textContent = user.statusEmoji || "";
  const bioEl = document.getElementById("vpBio");
  if (bioEl) bioEl.textContent = user.bio || "";

  // тут только предпросмотр — 3 последних поста/репоста, полный список на user.html
  const posts = await loadUserFeed(uid);
  const preview = posts.slice(0, 3);
  renderPostsInto(postsEl, preview, user.nickname);
  if (posts.length > 3 && fullLinkEl) {
    postsEl.insertAdjacentHTML("beforeend",
      `<a href="${isSelf ? "profile.html" : `user.html?uid=${uid}`}" class="showMoreReplies">и ещё ${posts.length - 3} &#8594;</a>`);
  }
}

export function initViewProfileModal() {
  const modal = document.getElementById("viewProfileModal");
  // подписка на запрос от ленты/поста/тега — см. комментарий в feed.js
  document.addEventListener("nyash:view-profile", (e) => openUserProfile(e.detail.uid));
  document.getElementById("closeViewProfile").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
}
