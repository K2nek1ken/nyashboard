import {
  loadFavorites, listPlaylists, createPlaylist, deletePlaylist, renamePlaylist,
  addToPlaylist, removeFromPlaylist, loadPlaylistTracks,
  moveFavoriteToTop, loadFavoriteOrder, toggleFavorite
} from "./music.js";
import { setQueue, shuffleQueue } from "./player.js";
import { trackCardHtml, wireTrackCards } from "./music-ui.js";
import { currentUser, authReady } from "./auth.js";
import { askText, askConfirm } from "./dialog.js";
import { showToast, escapeHtml } from "./ui.js";
import { ICON } from "./icons.js";

// ============================================================
//  Моя музыка
//
//  Сверху подборки лентой, снизу — сам список: любимое или содержимое
//  выбранной подборки. Между ними перемешивание.
//
//  Порядок в любимом человек задаёт сам («поднять наверх»), поэтому он
//  хранится отдельно от самих отметок.
// ============================================================

let favorites = [];
let playlists = [];
let activePlaylist = null;   // null — показываем любимое

export async function initMyMusic() {
  await authReady;
  const listEl = document.getElementById("myMusicList");

  if (!currentUser) {
    listEl.innerHTML = `<div class="stub-note">Войди, чтобы собирать свою музыку ♡</div>`;
    return;
  }

  document.getElementById("newPlaylistBtn")?.addEventListener("click", async () => {
    const name = await askText("Название плейлиста", { maxlength: 40 });
    if (!name?.trim()) return;
    try {
      await createPlaylist(name);
      showToast("Плейлист создан ♡");
      await refreshPlaylists();
    } catch (e) { showToast("Не вышло: " + e.message); }
  });

  document.getElementById("shuffleAllBtn")?.addEventListener("click", async () => {
    const tracks = activePlaylist
      ? await loadPlaylistTracks(activePlaylist)
      : favorites;
    if (!tracks.length) { showToast("Нечего перемешивать"); return; }
    setQueue(tracks, Math.floor(Math.random() * tracks.length));
    shuffleQueue();
    showToast("Играет вперемешку ♡");
  });

  await refreshPlaylists();
  await refreshList();
}

async function refreshPlaylists() {
  const row = document.getElementById("playlistRow");
  playlists = await listPlaylists().catch(() => []);

  row.innerHTML = `
    <button class="playlist-card ${!activePlaylist ? "active" : ""}" data-playlist="">
      <span class="nf">${ICON.heartFilled}</span>
      <span class="playlist-name">Любимое</span>
      <span class="playlist-count">${favorites.length}</span>
    </button>
    ${playlists.map(p => `
      <button class="playlist-card ${activePlaylist?.id === p.id ? "active" : ""}" data-playlist="${p.id}">
        <span class="nf">${ICON.list}</span>
        <span class="playlist-name">${escapeHtml(p.name)}</span>
        <span class="playlist-count">${(p.trackIds || []).length}</span>
      </button>`).join("")}`;

  row.querySelectorAll("[data-playlist]").forEach(btn => {
    btn.addEventListener("click", async () => {
      activePlaylist = btn.dataset.playlist
        ? playlists.find(p => p.id === btn.dataset.playlist)
        : null;
      await refreshPlaylists();
      await refreshList();
    });

    // долгое нажатие — переименовать или удалить подборку
    if (!btn.dataset.playlist) return;
    let hold = null;
    btn.addEventListener("pointerdown", () => {
      hold = setTimeout(() => { hold = null; managePlaylist(btn.dataset.playlist); }, 550);
    });
    const cancel = () => { if (hold) { clearTimeout(hold); hold = null; } };
    btn.addEventListener("pointerup", cancel);
    btn.addEventListener("pointerleave", cancel);
  });
}

async function managePlaylist(id) {
  const playlist = playlists.find(p => p.id === id);
  if (!playlist) return;

  const name = await askText("Название плейлиста", {
    value: playlist.name,
    hint: "Пустое название удалит плейлист.",
    maxlength: 40
  });
  if (name === null) return;

  if (!name.trim()) {
    if (!await askConfirm("Удалить плейлист?", { okLabel: "Удалить", danger: true })) return;
    await deletePlaylist(id);
    if (activePlaylist?.id === id) activePlaylist = null;
    showToast("Удалён");
  } else {
    await renamePlaylist(id, name);
    showToast("Переименован ♡");
  }
  await refreshPlaylists();
  await refreshList();
}

async function refreshList() {
  const listEl = document.getElementById("myMusicList");
  const title = document.getElementById("musicListTitle");
  listEl.innerHTML = `<div class="stub-note">Загружаю…</div>`;

  try {
    let tracks;
    if (activePlaylist) {
      title.textContent = activePlaylist.name;
      tracks = await loadPlaylistTracks(activePlaylist);
    } else {
      title.textContent = "Любимое";
      favorites = await loadFavorites();
      // порядок, заданный вручную: поднятые наверх идут первыми
      const order = await loadFavoriteOrder();
      favorites.sort((a, b) => {
        const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
        if (ia === -1 && ib === -1) return 0;
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
      tracks = favorites;
    }

    if (!tracks.length) {
      listEl.innerHTML = `<div class="stub-note">${
        activePlaylist ? "В плейлисте пусто" : "Пока ничего не добавлено ♡"}</div>`;
      return;
    }

    listEl.innerHTML = tracks.map(t => trackCardHtml(t, { favorite: !activePlaylist })).join("");
    wireTrackCards(listEl, tracks, refreshList);
    wireExtraActions(listEl, tracks);
  } catch (e) {
    listEl.innerHTML = `<div class="stub-note">Ошибка: ${escapeHtml(e.message)}</div>`;
  }
}

// Дополнительные действия, которых нет в общем списке музыки.
// Добавляются в то же меню карточки, а не отдельными значками: по значкам
// было непонятно, что каждый из них делает.
function wireExtraActions(container, tracks) {
  container.querySelectorAll(".track-card").forEach(card => {
    const id = card.dataset.track;
    const menu = card.querySelector(".kebabMenu");
    if (!menu) return;

    const extra = activePlaylist
      ? `<button class="kebabItem" data-action="fromPlaylist"><span class="nf">${ICON.close}</span> Убрать из плейлиста</button>`
      : `<button class="kebabItem" data-action="toTop"><span class="nf">${ICON.up}</span> Поднять наверх</button>
         <button class="kebabItem" data-action="toPlaylist"><span class="nf">${ICON.plus}</span> В плейлист</button>`;
    menu.insertAdjacentHTML("afterbegin", extra);

    menu.querySelector('[data-action="toTop"]')?.addEventListener("click", async () => {
      await moveFavoriteToTop(id);
      showToast("Наверх ♡");
      refreshList();
    });

    menu.querySelector('[data-action="fromPlaylist"]')?.addEventListener("click", async () => {
      await removeFromPlaylist(activePlaylist.id, id);
      showToast("Убрано из плейлиста");
      await refreshPlaylists();
      refreshList();
    });

    menu.querySelector('[data-action="toPlaylist"]')?.addEventListener("click", () => {
      openPlaylistPicker(id);
    });
  });
}

// Выбор плейлиста списком, а не вводом названия: печатать название вручную
// и попадать в него символ в символ — так себе занятие.
function openPlaylistPicker(trackId) {
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-content" style="max-width:340px;">
      <button class="closeBtn modalClose" data-close><span class="nf">${ICON.close}</span></button>
      <h2 style="margin-top:0;font-size:17px;">В какой плейлист?</h2>

      <div class="picker-list">
        ${playlists.length
          ? playlists.map(p => `
              <button class="picker-item" data-pick="${p.id}">
                <span class="nf">${ICON.list}</span>
                <span class="picker-name">${escapeHtml(p.name)}</span>
                <span class="playlist-count">${(p.trackIds || []).length}</span>
              </button>`).join("")
          : `<div class="stub-note" style="padding:10px;">Плейлистов пока нет</div>`}
      </div>

      <div class="picker-new">
        <input class="inlineEdit" data-new-name placeholder="Название нового плейлиста" maxlength="40">
        <button class="primaryBtn" data-create style="width:auto;margin:0;">Создать</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  const close = () => box.remove();
  box.querySelector("[data-close]").addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });

  box.querySelectorAll("[data-pick]").forEach(btn => {
    btn.addEventListener("click", async () => {
      try {
        const added = await addToPlaylist(btn.dataset.pick, trackId);
        showToast(added ? "Добавлено ♡" : "Уже там");
        close();
        await refreshPlaylists();
      } catch (e) { showToast("Не вышло: " + e.message); }
    });
  });

  const nameInput = box.querySelector("[data-new-name]");
  const create = async () => {
    const name = nameInput.value.trim();
    if (!name) { showToast("Нужно название"); return; }
    try {
      // создаём и сразу кладём туда трек — за этим сюда и пришли
      const id = await createPlaylist(name);
      await addToPlaylist(id, trackId);
      showToast(`Плейлист «${name}» создан ♡`);
      close();
      await refreshPlaylists();
    } catch (e) { showToast("Не вышло: " + e.message); }
  };
  box.querySelector("[data-create]").addEventListener("click", create);
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
}
