import { currentUser, authReady } from "./auth.js";
import { fetchManagedChannels } from "./channels.js";
import { escapeHtml } from "./ui.js";
import { ICON } from "./icons.js";

function cardHtml(c) {
  const icon = c.avatarUrl
    ? `<img src="${c.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;">`
    : `<span class="nf">${ICON.hash}</span>`;
  return `
    <a class="channel-card" href="channel.html?id=${c.id}">
      <div class="channel-icon">${icon}</div>
      <div class="channel-info">
        <div class="channel-name">${escapeHtml(c.name)}</div>
        <div class="channel-desc">@${escapeHtml(c.username)}</div>
      </div>
    </a>`;
}

export async function initMyChannelsPage() {
  const createdEl = document.getElementById("myCreatedList");
  const adminEl = document.getElementById("myAdminList");

  await authReady; // дожидаемся, пока Firebase реально определится, залогинена ли ты

  if (!currentUser) {
    createdEl.innerHTML = `<div class="stub-note">Войди, чтобы увидеть свои каналы ♡</div>`;
    adminEl.innerHTML = "";
    return;
  }

  try {
    const { created, admin } = await fetchManagedChannels();
    createdEl.innerHTML = created.length
      ? created.map(cardHtml).join("")
      : `<div class="stub-note">Ты пока не создавала каналов</div>`;
    adminEl.innerHTML = admin.length
      ? admin.map(cardHtml).join("")
      : `<div class="stub-note">Тебя пока никуда не назначили админом</div>`;
  } catch (e) {
    console.error(e);
    createdEl.innerHTML = `<div class="stub-note">Ошибка: ${escapeHtml(e.message)}</div>`;
  }
}
