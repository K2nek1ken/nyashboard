import { listTracks, toggleFavorite, loadFavorites, deleteTrack, uploadTrack, formatDuration } from "./music.js";
import { playTrack, currentTrackId } from "./player.js";
import { currentUser, authReady } from "./auth.js";
import { escapeHtml, showToast } from "./ui.js";
import { askConfirm } from "./dialog.js";
import { readAudioMeta } from "./audio-meta.js";
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
  // Разметку рисуем сразу, не дожидаясь ничего: кнопка нужна на экране
  // с первой секунды. Состояние входа проверяется уже при нажатии — раньше
  // ожидание здесь задерживало появление кнопки на всё время проверки.
  host.innerHTML = `
    <button class="primaryBtn upload-track-btn" id="uploadTrackBtn">
      <span class="nf">${ICON.plus}</span><span class="upload-track-label">Загрузить трек</span>
    </button>
    <input type="file" id="trackFileInput" accept="audio/*,.flac,.m4a,.opus,.wav,.ogg,.aac" hidden>
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

  // Загрузка одним окном: файл выбирается первым, всё остальное — сразу вместе.
  // Пошаговые вопросы были неудобны, а отмена на любом шаге просто пропускала
  // его вместо того, чтобы прервать загрузку.
  const fileInput = host.querySelector("#trackFileInput");
  host.querySelector("#uploadTrackBtn")?.addEventListener("click", async () => {
    // Кнопка видна всем: если её прятать, невошедшему непонятно, можно ли
    // тут вообще что-то выложить. Вход проверяем здесь — к моменту нажатия
    // он уже наверняка восстановлен.
    await authReady;
    if (!currentUser) { showToast("Войди, чтобы выкладывать музыку"); return; }
    fileInput.click();
  });

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    openUploadForm(file, refresh);
  });
}

// Форма загрузки: название, исполнитель и обложка в одном окне. Название,
// исполнителя и картинку пробуем достать прямо из файла — у большинства
// скачанных треков теги на месте, и заполнять руками ничего не придётся.
async function openUploadForm(file, onDone) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-content">
      <button class="closeBtn modalClose" data-cancel><span class="nf">${ICON.close}</span></button>
      <h2 style="margin-top:0; font-size:18px;">Новый трек</h2>
      <p class="muted" style="margin-top:0; font-size:12px;">${escapeHtml(file.name)}</p>

      <div class="upload-form">
        <label class="upload-cover" data-cover-pick title="нажми, чтобы выбрать обложку">
          <img data-cover-preview alt="">
          <span class="upload-cover-hint nf">${ICON.image}</span>
        </label>
        <div style="flex:1; min-width:0;">
          <input class="inlineEdit" data-title placeholder="Название" maxlength="80">
          <input class="inlineEdit" data-artist placeholder="Исполнитель" maxlength="60" style="margin-top:8px;">
        </div>
      </div>
      <input type="file" accept="image/*" hidden data-cover-input>
      <p class="muted" data-meta-note style="font-size:12px;"></p>

      <div class="dialog-buttons">
        <button class="secondaryBtn" data-cancel>Отмена</button>
        <button class="primaryBtn" data-submit>Опубликовать</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const titleInput = modal.querySelector("[data-title]");
  const artistInput = modal.querySelector("[data-artist]");
  const coverInput = modal.querySelector("[data-cover-input]");
  const coverPreview = modal.querySelector("[data-cover-preview]");
  const note = modal.querySelector("[data-meta-note]");

  titleInput.value = file.name.replace(/\.[^.]+$/, "");
  let coverFile = null;

  const setCover = (blob) => {
    coverFile = blob;
    coverPreview.src = URL.createObjectURL(blob);
    coverPreview.style.display = "block";
    modal.querySelector(".upload-cover-hint").style.display = "none";
  };

  // теги читаем в фоне: окно уже открыто, ждать разбора файла незачем
  note.textContent = "Читаю сведения из файла…";
  readAudioMeta(file).then(meta => {
    if (meta.title) titleInput.value = meta.title;
    if (meta.artist) artistInput.value = meta.artist;
    if (meta.cover) {
      setCover(meta.cover);
      note.textContent = "Обложка и название взяты из файла — можно поменять";
    } else {
      note.textContent = meta.title ? "Название взято из файла" : "";
    }
  }).catch(() => { note.textContent = ""; });

  modal.querySelector("[data-cover-pick]").addEventListener("click", () => coverInput.click());
  coverInput.addEventListener("change", () => {
    const f = coverInput.files[0];
    coverInput.value = "";
    if (f) { setCover(f); note.textContent = "Обложка выбрана"; }
  });

  const close = () => modal.remove();
  modal.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("[data-submit]").addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) { showToast("Нужно название"); return; }

    const btn = modal.querySelector("[data-submit]");
    btn.disabled = true;
    btn.textContent = "Загружаю… 0%";
    try {
      const { publicUid } = await uploadTrack({
        file, title, artist: artistInput.value.trim(), coverFile,
        // показываем ход отправки прямо на кнопке: у больших файлов без этого
        // непонятно, идёт ли что-то вообще
        onProgress: (ratio) => { btn.textContent = `Загружаю… ${Math.round(ratio * 100)}%`; }
      });
      close();
      showToast(`Готово ♡ Идентификатор: ${publicUid}`);
      onDone?.();
    } catch (e) {
      console.error(e);
      showToast("Не вышло: " + e.message);
      btn.disabled = false;
      btn.textContent = "Опубликовать";
    }
  });
}
