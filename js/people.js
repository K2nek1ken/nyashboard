import { listAllUsers, getUserDoc } from "./data.js";
import { loadUserFeed, renderPostsInto } from "./feed.js";
import { currentUser, authReady } from "./auth.js";
import { escapeHtml } from "./ui.js";
import { avatarHtml, shapeClass } from "./avatar.js";
import { relationBadge, badgeHtml, nameHtml } from "./person.js";
import { fetchOnline } from "./presence.js";
import { loadFriends } from "./friends.js";
import { resolveNuid } from "./nuid.js";
import { defaultAvatar } from "./default-avatar.js";

// см. комментарий в chat.js
let listEl = null;
let searchEl = null;
let allUsers = [];

export async function loadPeopleTab() {
  listEl = document.getElementById("peopleList");
  searchEl = document.getElementById("peopleSearch");
  if (!listEl) return;
  listEl.innerHTML = `<div class="stub-note">Загружаю людей...</div>`;
  allUsers = await listAllUsers();
  renderPeople(allUsers);
}

async function renderPeople(users) {
  if (!users.length) { listEl.innerHTML = `<div class="stub-note">Пока тут никого нет</div>`; return; }

  // Метки считаются заранее: для каждой нужен запрос про взаимность, и делать
  // их по одному во время отрисовки означало бы мигающий список.
  await loadFriends().catch(() => {});
  const badges = new Map();
  const online = await fetchOnline(users.map(u => u.uid)).catch(() => new Set());
  await Promise.all(users.map(async u => {
    badges.set(u.uid, await relationBadge(u.uid, u).catch(() => null));
  }));

  listEl.innerHTML = users.map(u => `
    <div class="person-row" data-uid="${u.uid}">
      <span class="${online.has(u.uid) ? "online-wrap" : ""}">${avatarHtml(u, 38)}</span>
      <div style="min-width:0;">
        <div>${nameHtml(u, { clickable: false })}${badgeHtml(badges.get(u.uid))}</div>
        <div class="pmuted">@${escapeHtml(u.username)}</div>
      </div>
    </div>`).join("");
  listEl.querySelectorAll(".person-row").forEach(row => {
    row.addEventListener("click", () => openUserProfile(row.dataset.uid));
  });
}

export function initPeopleSearch() {
  // Элемент берём здесь же: при переходе между вкладками разметка новая,
  // а раньше эта функция полагалась на ссылку, полученную в другом месте —
  // и падала, из-за чего роутер аварийно перезагружал всю страницу.
  searchEl = document.getElementById("peopleSearch");
  if (!searchEl) return;

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

  const badge = await relationBadge(uid, user).catch(() => null);
  nameEl.innerHTML = nameHtml(user, { clickable: false }) + badgeHtml(badge);
  userEl.textContent = user.username;
  // Обёртку берём по её собственному признаку, а не от картинки внутри:
  // после первой же перерисовки та картинка выброшена из документа, и всё,
  // что искалось от неё, уходило в никуда — карточка оставалась с прежним
  // человеком.
  const wrap = document.getElementById("vpAvatarWrap");
  if (wrap) {
    wrap.innerHTML = avatarHtml({
      ...user,
      accessory: user.accessory || "none",
      avatarBorder: user.avatarBorder || "pink"
    }, 64);
  }
  const statusEl = wrap?.querySelector(".avatar-status") || document.getElementById("vpStatus");
  if (statusEl) statusEl.textContent = user.statusEmoji || "";
  const bioEl = document.getElementById("vpBio");
  if (bioEl) bioEl.textContent = user.bio || "";

  // Кнопки разделов: карточка показывала только ленту, хотя в приоритете
  // стена, а музыка нужна не реже. Теперь можно посмотреть всё прямо здесь,
  // не уходя на страницу человека.
  const tabsHost = document.getElementById("vpTabs");
  if (tabsHost) {
    tabsHost.innerHTML = `
      <button class="subtab active" data-vp-tab="wall">Стена</button>
      <button class="subtab" data-vp-tab="feed">Лента</button>
      <button class="subtab" data-vp-tab="music">Музыка</button>`;

    tabsHost.querySelectorAll("[data-vp-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        tabsHost.querySelectorAll("[data-vp-tab]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        showTab(btn.dataset.vpTab);
      });
    });
  }

  const actionsHost = document.getElementById("vpActions");
  if (actionsHost) {
    actionsHost.innerHTML = `
      <a class="secondaryBtn" href="${isSelf ? "user.html?uid=me" : `user.html?uid=${uid}`}">
        Открыть профиль
      </a>
      ${!isSelf ? `<a class="secondaryBtn" href="dm.html?uid=${uid}">Написать</a>` : ""}`;
  }

  // Стена открывается первой: это личная страница человека.
  showTab("wall");

  async function showTab(kind) {
    postsEl.innerHTML = `<div class="stub-note">Загружаю…</div>`;

    if (kind === "music") {
      await showMusic();
      return;
    }

    const all = await loadUserFeed(uid).catch(() => []);
    const list = all.filter(p => (kind === "wall" ? p.place === "wall" : p.place !== "wall"));
    if (!list.length) {
      postsEl.innerHTML = `<div class="stub-note">${kind === "wall" ? "На стене пусто" : "Записей нет"}</div>`;
      return;
    }

    postsEl.innerHTML = "";
    renderPostsInto(postsEl, list.slice(0, 3), user.nickname);
    if (list.length > 3) {
      postsEl.insertAdjacentHTML("beforeend",
        `<a href="user.html?uid=${uid}" class="showMoreReplies">и ещё ${list.length - 3} &#8594;</a>`);
    }
  }

  // Музыка показывается, только если человек её открыл — настройку
  // видимости проверяем так же, как на его странице.
  async function showMusic() {
    const visibility = user.musicVisibility || "all";
    if (!isSelf && visibility === "nobody") {
      postsEl.innerHTML = `<div class="stub-note">Музыка скрыта</div>`;
      return;
    }
    if (!isSelf && visibility === "friends") {
      const { isMutualFriend } = await import("./friends.js");
      if (!await isMutualFriend(uid).catch(() => false)) {
        postsEl.innerHTML = `<div class="stub-note">Музыка видна только друзьям</div>`;
        return;
      }
    }

    try {
      const { loadFavorites } = await import("./music.js");
      const { trackCardHtml, wireTrackCards } = await import("./music-ui.js");
      const tracks = (await loadFavorites(uid)).slice(0, 5);
      if (!tracks.length) { postsEl.innerHTML = `<div class="stub-note">Пусто</div>`; return; }

      postsEl.innerHTML = tracks.map(t => trackCardHtml(t, { favorite: true })).join("");
      wireTrackCards(postsEl, tracks);
    } catch {
      postsEl.innerHTML = `<div class="stub-note">Музыка скрыта</div>`;
    }
  }
}

let viewProfileWired = false;

export function initViewProfileModal() {
  const modal = document.getElementById("viewProfileModal");
  // Карточка есть не на каждой странице — без проверки функция падала,
  // и вместе с ней не запускалась вся вкладка.
  if (!modal) return;

  // Подписка на событие ставится один раз: она живёт на всём документе и
  // переживает переходы, а повторная вешала бы вторую такую же.
  if (!viewProfileWired) {
    viewProfileWired = true;
    document.addEventListener("nyash:view-profile", (e) => openUserProfile(e.detail.uid));
  }

  document.getElementById("closeViewProfile")
    ?.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });
}
