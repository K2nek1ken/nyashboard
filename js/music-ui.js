import { listTracks, toggleFavorite, loadFavorites, deleteTrack, uploadTrack, formatDuration } from "./music.js";
import { playTrack, queueNext, currentTrackId } from "./player.js";
import { kebabHtml, wireKebab } from "./kebab.js";
import { defaultCover } from "./default-avatar.js";
import { currentUser, authReady } from "./auth.js";
import { escapeHtml, showToast, closeOverlay } from "./ui.js";
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
        <img class="track-cover" src="${track.coverUrl || defaultCover(track.id || track.title)}" alt="">
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
        ${track.publicUid ? `<span class="track-nuid" data-copy-nuid="${track.publicUid}">${track.publicUid}</span>` : ""}
      </div>
      <div class="track-actions">
        <button class="subBtn ${favorite ? "liked" : ""}" data-fav="${track.id}" title="в любимое">
          <span class="nf">${favorite ? ICON.heartFilled : ICON.heart}</span>
        </button>
        ${kebabHtml([
          { action: "playNext", label: "Играть следующим", icon: ICON.play },
          { action: "download", label: "Скачать", icon: ICON.down },
          { action: "copyNuid", label: "Скопировать NUID", icon: ICON.hash },
          ...(canDelete ? [{ action: "removeTrack", label: "Удалить", icon: ICON.close, danger: true }] : [])
        ], track.id)}
      </div>
    </div>`;
}

export function wireTrackCards(container, tracks, onChanged) {
  container.querySelectorAll("[data-track-play]").forEach(btn => {
    btn.addEventListener("click", () => {
      const track = tracks.find(t => t.id === btn.dataset.trackPlay);
      if (!track) return;
      // Играем один трек: если человек нажал именно на него, включать следом
      // весь список — не то, чего он просил.
      playTrack(track);
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

  // Остальные действия — в меню карточки: по значкам было непонятно,
  // что каждый из них делает.
  container.querySelectorAll(".track-card").forEach(card => {
    const track = tracks.find(t => t.id === card.dataset.track);
    if (!track) return;

    wireKebab(card, {
      playNext: () => { queueNext(track); showToast("Заиграет следующим ♡"); },
      download: () => {
        const a = document.createElement("a");
        a.href = track.url;
        a.download = `${track.title || "track"}.${track.format || "mp3"}`;
        a.target = "_blank";
        a.rel = "noopener";
        a.click();
      },
      copyNuid: async () => {
        if (!track.publicUid) { showToast("У трека нет номера"); return; }
        try {
          await navigator.clipboard.writeText(track.publicUid);
          showToast("Номер скопирован");
        } catch { showToast(track.publicUid); }
      },
      removeTrack: async () => {
        if (!await askConfirm("Удалить трек?", { okLabel: "Удалить", danger: true })) return;
        try {
          await deleteTrack(track.id);
          showToast("Удалён");
          onChanged?.();
        } catch (e) { showToast("Ошибка: " + e.message); }
      }
    });
  });
}

// Подвкладка «Музыка» во вкладке «Контент».
export async function initMusicPanel(host) {
  // Разметку рисуем сразу, не дожидаясь ничего: кнопка нужна на экране
  // с первой секунды. Состояние входа проверяется уже при нажатии — раньше
  // ожидание здесь задерживало появление кнопки на всё время проверки.
  host.innerHTML = `
    <button class="secondaryBtn upload-zip-btn" id="uploadZipBtn" title="загрузить архивом">
      <span class="nf">${ICON.archive || ICON.attach}</span> Архивом
    </button>
    <input type="file" id="zipFileInput" accept=".zip,application/zip" hidden>
    <button class="primaryBtn upload-track-btn" id="uploadTrackBtn">
      <span class="nf">${ICON.plus}</span><span class="upload-track-label">Загрузить трек</span>
    </button>
    <input type="file" id="trackFileInput" accept="audio/*,.flac,.m4a,.opus,.wav,.ogg,.aac" hidden>
    <div id="tracksList"><div class="stub-note">Загружаю…</div></div>`;

  const listEl = host.querySelector("#tracksList");

  let allTracks = [];

  // Поиск по названию, исполнителю и идентификатору — по уже загруженному
  // списку, без обращения к базе.
  function wireSearch() {
    const input = document.getElementById("musicSearch");
    if (!input || input.dataset.wired) return;
    input.dataset.wired = "1";
    input.addEventListener("input", () => paint(input.value.trim().toLowerCase()));
  }

  async function refresh() {
    try {
      const tracks = await listTracks();
      allTracks = tracks;
      if (!tracks.length) {
        listEl.innerHTML = `<div class="stub-note">Пока пусто. Загрузи что-нибудь первым ♡</div>`;
        return;
      }
      const favIds = currentUser ? new Set((await loadFavorites()).map(t => t.id)) : new Set();
      paint("", favIds);
      wireSearch();
    } catch (e) {
      listEl.innerHTML = `<div class="stub-note">Ошибка: ${escapeHtml(e.message)}</div>`;
    }
  }
  let favCache = new Set();

  function paint(query = "", favIds = null) {
    if (favIds) favCache = favIds;
    const found = query
      ? allTracks.filter(t =>
          (t.title || "").toLowerCase().includes(query) ||
          (t.artist || "").toLowerCase().includes(query) ||
          (t.publicUid || "").toLowerCase().includes(query))
      : allTracks;

    if (!found.length) {
      listEl.innerHTML = `<div class="stub-note">${query ? "Ничего не нашлось" : "Пока пусто. Загрузи что-нибудь первым ♡"}</div>`;
      return;
    }
    listEl.innerHTML = found.map(t => trackCardHtml(t, {
      favorite: favCache.has(t.id),
      canDelete: currentUser && t.uploaderUid === currentUser.uid
    })).join("");
    wireTrackCards(listEl, found, refresh);
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

  // Загрузка архивом: треки идут по очереди, с показом хода работы.
  const zipInput = host.querySelector("#zipFileInput");
  host.querySelector("#uploadZipBtn")?.addEventListener("click", async () => {
    await authReady;
    if (!currentUser) { showToast("Войди, чтобы выкладывать музыку"); return; }
    zipInput.click();
  });

  zipInput?.addEventListener("change", async () => {
    const zip = zipInput.files[0];
    zipInput.value = "";
    if (zip) openZipUpload(zip, refresh);
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

      <label class="toggle-anon" style="margin:6px 0 0;">
        <input type="checkbox" data-favorite checked>
        <span>сразу в любимое</span>
      </label>

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

  const close = () => closeOverlay(modal);
  modal.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", close));
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("[data-submit]").addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) { showToast("Нужно название"); return; }

    const btn = modal.querySelector("[data-submit]");
    btn.disabled = true;
    btn.textContent = "Загружаю… 0%";
    try {
      const uploaded = await uploadTrack({
        file, title, artist: artistInput.value.trim(), coverFile,
        // показываем ход отправки прямо на кнопке: у больших файлов без этого
        // непонятно, идёт ли что-то вообще
        onProgress: (ratio) => { btn.textContent = `Загружаю… ${Math.round(ratio * 100)}%`; }
      });

      // Сразу в любимое, если отмечено: иначе после загрузки пришлось бы
      // искать свой же трек в общем списке и отмечать вручную.
      if (modal.querySelector("[data-favorite]")?.checked) {
        await toggleFavorite({ id: uploaded.id, ...uploaded }).catch(() => {});
      }

      close();
      showToast(`Готово ♡ Идентификатор: ${uploaded.publicUid}`);
      onDone?.();
    } catch (e) {
      console.error(e);
      showToast("Не вышло: " + e.message);
      btn.disabled = false;
      btn.textContent = "Опубликовать";
    }
  });
}


// Окно загрузки архивом: показывает, какой файл сейчас идёт, и что вышло
// в итоге. Прерывать нельзя — уже загруженное останется, и обрывать на
// середине было бы обманом.
function openZipUpload(zipFile, onDone) {
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-content" style="max-width:380px;">
      <button class="closeBtn modalClose" data-cancel><span class="nf">${ICON.close}</span></button>
      <h2 style="margin-top:0;font-size:17px;">Треки из архива</h2>
      <p class="muted" style="margin-top:0;font-size:12px;">${escapeHtml(zipFile.name)}</p>

      <label class="toggle-anon" style="margin:10px 0;">
        <input type="checkbox" data-favorite checked>
        <span>сразу в любимое</span>
      </label>

      <p class="muted" style="font-size:11px;line-height:1.5;">
        Название, исполнитель и обложка берутся из тегов файлов.
        Треки загружаются по очереди — это может занять время.
      </p>

      <div data-status class="zip-status hidden"></div>

      <div class="dialog-buttons">
        <button class="secondaryBtn" data-cancel>Отмена</button>
        <button class="primaryBtn" data-start>Загрузить</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  const close = () => closeOverlay(box);
  box.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", close));

  box.querySelector("[data-start]").addEventListener("click", async () => {
    const toFavorites = box.querySelector("[data-favorite]").checked;
    const status = box.querySelector("[data-status]");
    const startBtn = box.querySelector("[data-start]");

    startBtn.disabled = true;
    box.querySelectorAll("[data-cancel]").forEach(b => b.disabled = true);
    status.classList.remove("hidden");

    try {
      const { uploadTracksFromZip } = await import("./music.js");
      const { done, failed } = await uploadTracksFromZip(zipFile, {
        toFavorites,
        onProgress: ({ index, total, name, stage, ratio }) => {
          const pct = ratio ? ` ${Math.round(ratio * 100)}%` : "";
          status.innerHTML = `
            <div class="zip-line">${index} из ${total}${pct}</div>
            <div class="zip-name">${escapeHtml(name)}</div>
            <div class="zip-bar"><div style="width:${(index / total) * 100}%"></div></div>`;
          startBtn.textContent = stage === "uploading" ? "Загружаю…" : "Читаю…";
        }
      });

      close();
      showToast(failed.length
        ? `Загружено: ${done.length}, пропущено: ${failed.length}`
        : `Загружено треков: ${done.length} ♡`);
      if (failed.length) console.warn("Не загрузились:", failed);
      onDone?.();
    } catch (e) {
      console.error(e);
      status.innerHTML = `<div class="zip-line" style="color:var(--danger)">${escapeHtml(e.message)}</div>`;
      startBtn.disabled = false;
      startBtn.textContent = "Попробовать снова";
      box.querySelectorAll("[data-cancel]").forEach(b => b.disabled = false);
    }
  });
}
