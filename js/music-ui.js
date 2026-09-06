import { listTracks, toggleFavorite, loadFavorites, deleteTrack, uploadTrack, formatDuration } from "./music.js";
import { playTrack, currentTrackId } from "./player.js";
import { currentUser } from "./auth.js";
import { escapeHtml, showToast } from "./ui.js";
import { askText, askConfirm } from "./dialog.js";
import { ICON } from "./icons.js";

// Карточка трека: обложка с кнопкой воспроизведения, название, полоса
// прогресса и метки справа сверху — идентификатор и сердечко, если трек
// в любимом. Ровно так, как описал Неко.
export function trackCardHtml(track, { favorite = false, canDelete = false } = {}) {
  const playing = currentTrackId() === track.id;
  return `
    <div class="track-card" data-track="${track.id}">
      <div class="track-cover-wrap">
        ${track.coverUrl
          ? `<img class="track-cover" src="${track.coverUrl}" alt="">`
          : `<div class="track-cover"></div>`}
        <button class="track-play" data-track-play="${track.id}">
          <span class="nf">${playing ? ICON.pause : ICON.play}</span>
        </button>
      </div>
      <div class="track-body">
        <div class="track-title">${escapeHtml(track.title)}</div>
        <div class="track-meta">
          ${track.artist ? escapeHtml(track.artist) + " · " : ""}${formatDuration(track.duration)}
          ${track.format ? " · " + track.format.toUpperCase() : ""}
        </div>
        <div class="track-progress"><div class="track-progress-fill"></div></div>
      </div>
      <div class="track-tags">
        ${favorite ? `<span class="track-fav">${ICON.heartFilled}</span>` : ""}
        ${track.publicUid ? `<span class="track-nuid">${track.publicUid}</span>` : ""}
      </div>
      <div class="track-actions">
        <button class="subBtn" data-fav="${track.id}"><span class="nf">${favorite ? ICON.heartFilled : ICON.heart}</span></button>
        ${canDelete ? `<button class="subBtn" data-del="${track.id}"><span class="nf">${ICON.close}</span></button>` : ""}
      </div>
    </div>`;
}

export function wireTrackCards(container, tracks, onChanged) {
  container.querySelectorAll("[data-track-play]").forEach(btn => {
    btn.addEventListener("click", () => {
      const track = tracks.find(t => t.id === btn.dataset.trackPlay);
      if (track) playTrack(track);
    });
  });

  container.querySelectorAll("[data-fav]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!currentUser) { showToast("Войди, чтобы добавлять в любимое"); return; }
      const track = tracks.find(t => t.id === btn.dataset.fav);
      try {
        const added = await toggleFavorite(track);
        showToast(added ? "Добавлено в любимое ♡" : "Убрано из любимого");
        onChanged?.();
      } catch (e) { showToast("Ошибка: " + e.message); }
    });
  });

  container.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!await askConfirm("Удалить трек?", { okLabel: "Удалить", danger: true })) return;
      try {
        await deleteTrack(btn.dataset.del);
        showToast("Удалён");
        onChanged?.();
      } catch (e) { showToast("Ошибка: " + e.message); }
    });
  });
}

// Подвкладка «Музыка» во вкладке «Контент».
export async function initMusicPanel(host) {
  host.innerHTML = `
    ${currentUser ? `
      <button class="primaryBtn" id="uploadTrackBtn" style="width:auto; margin:0 0 14px;">
        <span class="nf">${ICON.plus}</span> Загрузить трек
      </button>
      <input type="file" id="trackFileInput" accept="audio/*,.flac,.m4a,.opus" hidden>
      <input type="file" id="trackCoverInput" accept="image/*" hidden>` : ""}
    <div id="tracksList"><div class="stub-note">Загружаю…</div></div>`;

  const listEl = host.querySelector("#tracksList");

  async function refresh() {
    try {
      const tracks = await listTracks();
      if (!tracks.length) {
        listEl.innerHTML = `<div class="stub-note">Пока пусто. Загрузи что-нибудь первым ♡</div>`;
        return;
      }
      const favIds = currentUser ? new Set((await loadFavorites()).map(t => t.id)) : new Set();
      listEl.innerHTML = tracks.map(t => trackCardHtml(t, {
        favorite: favIds.has(t.id),
        canDelete: currentUser && t.uploaderUid === currentUser.uid
      })).join("");
      wireTrackCards(listEl, tracks, refresh);
    } catch (e) {
      listEl.innerHTML = `<div class="stub-note">Ошибка: ${escapeHtml(e.message)}</div>`;
    }
  }
  refresh();

  // Загрузка: файл, затем название и исполнитель, затем необязательная обложка.
  const fileInput = host.querySelector("#trackFileInput");
  const coverInput = host.querySelector("#trackCoverInput");
  host.querySelector("#uploadTrackBtn")?.addEventListener("click", () => fileInput.click());

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;

    const guess = file.name.replace(/\.[^.]+$/, "");
    const title = await askText("Название трека", { value: guess, maxlength: 80 });
    if (!title) return;
    const artist = await askText("Исполнитель", { placeholder: "можно оставить пустым", maxlength: 60 });

    const wantCover = await askConfirm("Добавить обложку?", { okLabel: "Выбрать" });
    let coverFile = null;
    if (wantCover) {
      coverFile = await new Promise(resolve => {
        coverInput.onchange = () => { const f = coverInput.files[0]; coverInput.value = ""; resolve(f || null); };
        coverInput.click();
      });
    }

    showToast("Загружаю трек…");
    try {
      const { publicUid } = await uploadTrack({ file, title, artist, coverFile });
      showToast(`Готово ♡ Идентификатор: ${publicUid}`);
      refresh();
    } catch (e) {
      showToast("Не вышло: " + e.message);
    }
  });
}
