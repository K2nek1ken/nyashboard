import {
  createChannel, listChannels, isSubscribedLocal, subscribeToChannel,
  unsubscribeFromChannel, suggestChannels, fetchManagedChannelIds
} from "./channels.js";
import { loadSubscriptions, getSubscriptionsSync } from "./subscriptions.js";
import { loadFriends, getFriendsSync } from "./friends.js";
import { remember, recall } from "./session-state.js";
import { currentUser, authReady } from "./auth.js";
import { showToast, escapeHtml, gendered } from "./ui.js";
import { ICON } from "./icons.js";
import { avatarHtml } from "./avatar.js";
import { CHANNEL_COLOR } from "./palette.js";

let allChannels = [];
let managedIds = new Set(); // каналы, где я создатель/админ — там кнопки "подписаться" нет

// Переключение подвкладок. Записи друзей и музыка подгружаются лениво — при
// первом открытии, а не вместе со страницей: иначе за каналы платили бы
// лишними запросами те, кто пришёл только за ними.
let loaded = { friends: false, music: false, art: false };

// Переход на другую вкладку и обратно должен начинаться с чистого листа:
// разметка новая, а пометки о загруженном остались бы от прошлого раза.
export function resetContentState() {
  loaded = { friends: false, music: false, art: false };
}

export function initSubtabs() {
  const tabs = document.getElementById("contentSubtabs");
  if (!tabs) return;

  function openSub(key) {
    tabs.querySelectorAll("[data-sub]").forEach(b => b.classList.toggle("active", b.dataset.sub === key));
    document.querySelectorAll("[data-panel]").forEach(p =>
      p.classList.toggle("hidden", p.dataset.panel !== key));
    remember("contentSub", key);   // вернёмся сюда же после перезагрузки

    if (key === "friends" && !loaded.friends) { loaded.friends = true; loadFriendsFeed(); }
    if (key === "music" && !loaded.music) { loaded.music = true; loadMusicPanel(); }
    if (key === "art" && !loaded.art) { loaded.art = true; loadArtPanel(); }
  }

  // Восстанавливаем последнюю открытую подвкладку: раньше при любом
  // возвращении всё сбрасывалось на каналы.
  const saved = recall("contentSub", "channels");
  if (saved !== "channels") openSub(saved);

  tabs.querySelectorAll("[data-sub]").forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.sub;
      openSub(key);
    });
  });
}

// Записи друзей и отслеживаемых — то же, что в ленте, но без чужих.
let friendsPosts = [];

// Поиск по записям друзей — на месте, без запроса к базе: список уже загружен.
function wireFriendsSearch() {
  const input = document.getElementById("friendsSearch");
  if (!input || input.dataset.wired) return;
  input.dataset.wired = "1";

  input.addEventListener("input", async () => {
    const q = input.value.trim().toLowerCase();
    const el = document.getElementById("friendsFeed");
    const { renderPostsInto } = await import("./feed.js");
    const found = q
      ? friendsPosts.filter(p => (p.text || "").toLowerCase().includes(q))
      : friendsPosts;
    if (!found.length) { el.innerHTML = `<div class="stub-note">Ничего не нашлось</div>`; return; }
    renderPostsInto(el, found, "");
  });
}

async function loadFriendsFeed() {
  const el = document.getElementById("friendsFeed");
  await loadFriends().catch(() => {});
  const friends = getFriendsSync();
  if (!friends.length) {
    el.innerHTML = `<div class="stub-note">Добавь кого-нибудь в друзья — их записи появятся здесь</div>`;
    return;
  }
  try {
    const { loadRecentPosts, renderPostsInto } = await import("./feed.js");
    const posts = (await loadRecentPosts(60))
      .filter(p => p.authorUid && friends.includes(p.authorUid));
    friendsPosts = posts;
    if (!posts.length) { el.innerHTML = `<div class="stub-note">Друзья пока ничего не публиковали</div>`; return; }
    renderPostsInto(el, posts, "");
    wireFriendsSearch();
  } catch (e) {
    el.innerHTML = `<div class="stub-note">Ошибка: ${escapeHtml(e.message)}</div>`;
  }
}

async function loadArtPanel() {
  const { initArtPanel } = await import("./art-ui.js");
  initArtPanel();
}

async function loadMusicPanel() {
  const el = document.getElementById("musicPanel");
  const { initMusicPanel } = await import("./music-ui.js");
  initMusicPanel(el);
}

export async function initContentTab() {
  await authReady;
  await loadSubscriptions();   // иначе кнопки покажут «подписаться» на уже подписанных
  managedIds = currentUser ? await fetchManagedChannelIds().catch(() => new Set()) : new Set();
  await reload();
  wireSearch();
  wireCreateModal();
}

async function reload() {
  document.getElementById("allChannelsList").innerHTML = `<div class="stub-note">Загружаю каналы...</div>`;
  try {
    allChannels = await listChannels();
  } catch (e) {
    console.error(e);
    document.getElementById("allChannelsList").innerHTML =
      `<div class="stub-note">Не смогла загрузить каналы: ${escapeHtml(e.message)}</div>`;
    return;
  }
  renderMine();
  renderAll(allChannels);
  renderSuggested();
}

function channelCard(c) {
  const subbed = isSubscribedLocal(c.id);
  const isManaged = managedIds.has(c.id);
  const icon = c.avatarUrl
    ? avatarHtml({ avatarUrl: c.avatarUrl, avatarShape: c.avatarShape,
                   accessory: c.accessory, avatarBorder: c.avatarBorder }, 40)
    : `<span class="nf">${ICON.hash}</span>`;
  return `
    <a class="channel-card" href="channel.html?id=${c.id}" data-id="${c.id}">
      <div class="channel-icon ${c.avatarUrl ? "" : "no-avatar"}">${icon}</div>
      <div class="channel-info">
        <div class="channel-name" style="color:${CHANNEL_COLOR}">${escapeHtml(c.name)}</div>
        <div class="channel-desc">@${escapeHtml(c.username)} · ${escapeHtml(c.description || "без описания")}</div>
      </div>
      ${isManaged
        ? `<span class="subBtn subscribed" style="pointer-events:none;">управляю</span>`
        : `<button class="subBtn ${subbed ? "subscribed" : ""}" data-action="sub" data-id="${c.id}">
             ${subbed ? `<span class="nf">${ICON.check}</span> подписан${gendered("", "а", "(а)")}` : "подписаться"}
           </button>`}
    </a>`;
}

function wireCards(container) {
  container.querySelectorAll('[data-action="sub"]').forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.id;
      btn.disabled = true;
      try {
        if (isSubscribedLocal(id)) {
          await unsubscribeFromChannel(id);
          showToast(`Отписал${gendered("ся", "ась", "ся(ась)")}`);
        } else {
          await subscribeToChannel(id);
          showToast(`Подписал${gendered("ся", "ась", "ся(ась)")} ♡`);
        }
        renderMine();
        renderAll(allChannels);
        renderSuggested();
      } catch (err) {
        console.error(err);
        showToast("Ошибка: " + err.message);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function renderAll(list) {
  const el = document.getElementById("allChannelsList");
  if (!list.length) { el.innerHTML = `<div class="stub-note">Каналов пока нет — создай первый ♡</div>`; return; }
  el.innerHTML = list.map(channelCard).join("");
  wireCards(el);
}

function renderSuggested() {
  const block = document.getElementById("suggestedBlock");
  const el = document.getElementById("suggestedList");
  const subs = getSubscriptionsSync();
  // Свои каналы из рекомендаций убираем: предлагать человеку то, чем он сам
  // управляет, бессмысленно.
  const pool = allChannels.filter(c => !managedIds.has(c.id));
  const suggested = suggestChannels(pool, subs);
  if (!suggested.length) { block.classList.add("hidden"); return; }
  block.classList.remove("hidden");
  el.innerHTML = suggested.map(channelCard).join("");
  wireCards(el);
}

// Отдельная категория со своими каналами — если они есть.
function renderMine() {
  const block = document.getElementById("mineBlock");
  const el = document.getElementById("mineList");
  if (!block) return;
  const mine = allChannels.filter(c => managedIds.has(c.id));
  if (!mine.length) { block.classList.add("hidden"); return; }
  block.classList.remove("hidden");
  el.innerHTML = mine.map(channelCard).join("");
  wireCards(el);
}

function wireSearch() {
  const input = document.getElementById("channelSearch");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { renderAll(allChannels); return; }
    renderAll(allChannels.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q) ||
      (c.publicUid || "").toLowerCase().includes(q) ||
      (c.description || "").toLowerCase().includes(q)
    ));
  });
}

function wireCreateModal() {
  const modal = document.getElementById("createChannelModal");
  const fab = document.getElementById("newChannelFab");
  const closeBtn = document.getElementById("closeCreateChannel");
  const nameInput = document.getElementById("channelNameInput");
  const descInput = document.getElementById("channelDescInput");
  const createBtn = document.getElementById("createChannelBtn");

  fab.addEventListener("click", () => {
    if (!currentUser) { showToast("Нужен аккаунт, чтобы создать канал (иначе некому будет им управлять)"); return; }
    nameInput.value = "";
    descInput.value = "";
    modal.classList.remove("hidden");
  });
  closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

  createBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const description = descInput.value.trim();
    if (!name) { showToast("Название обязательно"); return; }
    createBtn.disabled = true;
    try {
      const channelId = await createChannel(name, description);
      modal.classList.add("hidden");
      showToast("Канал создан ♡ (анонимно)");
      location.href = `channel.html?id=${channelId}`;
    } catch (e) {
      console.error(e);
      showToast("Ошибка: " + e.message);
    } finally {
      createBtn.disabled = false;
    }
  });
}
