import { listArtworks, uploadArt, deleteArtwork, toggleArtLike, artMediaHtml, artImages, wireArtVideos } from "./art.js";
import { currentUser, authReady } from "./auth.js";
import { openLightbox } from "./lightbox.js";
import { askText, askConfirm } from "./dialog.js";
import { showToast, escapeHtml, timeAgo, closeOverlay } from "./ui.js";
import { ICON } from "./icons.js";

// Раздел с работами: сетка картинок, под каждой автор и оценки.
// Картинка крупная и открывается на весь экран — ради неё сюда и приходят.

let allArt = [];

export async function initArtPanel() {
  const listEl = document.getElementById("artList");
  const fileInput = document.getElementById("artFileInput");

  document.getElementById("uploadArtBtn")?.addEventListener("click", async () => {
    await authReady;
    if (!currentUser) { showToast("Войди, чтобы выкладывать работы"); return; }
    fileInput.click();
  });

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (file) openArtForm({ file, onDone: refresh });
  });

  // Видео — отдельной кнопкой над «+»: так же удобно, как в редакторе,
  // без похода в файловый менеджер за нужным фильтром.
  const videoInput = document.getElementById("artVideoInput");
  document.getElementById("uploadArtVideoBtn")?.addEventListener("click", async () => {
    await authReady;
    if (!currentUser) { showToast("Войди, чтобы выкладывать работы"); return; }
    videoInput.click();
  });

  videoInput?.addEventListener("change", async () => {
    const file = videoInput.files[0];
    videoInput.value = "";
    if (!file) return;

    const { isVideoFile } = await import("./storage.js");
    if (!isVideoFile(file)) { showToast("Это не видео"); return; }
    if (file.size > 5 * 1024 * 1024) {
      showToast(`Видео на ${(file.size / 1024 / 1024).toFixed(1)} МБ — предел 5 МБ`);
      return;
    }
    openArtForm({ file, onDone: refresh });
  });

  const search = document.getElementById("artSearch");
  search?.addEventListener("input", () => paint(search.value.trim().toLowerCase()));

  async function refresh() {
    try {
      allArt = await listArtworks();
      paint("");
    } catch (e) {
      listEl.innerHTML = `<div class="stub-note">Ошибка: ${escapeHtml(e.message)}</div>`;
    }
  }

  function paint(query = "") {
    const found = query
      ? allArt.filter(a =>
          (a.title || "").toLowerCase().includes(query) ||
          (a.authorName || "").toLowerCase().includes(query) ||
          (a.publicUid || "").toLowerCase().includes(query))
      : allArt;

    if (!found.length) {
      listEl.innerHTML = `<div class="stub-note">${
        query ? "Ничего не нашлось" : "Пока пусто. Выложи работу первым ♡"}</div>`;
      return;
    }

    listEl.innerHTML = found.map(a => {
      const liked = currentUser && (a.likedBy || []).includes(currentUser.uid);
      const mine = currentUser && a.authorUid === currentUser.uid;
      return `
        <div class="art-card" data-art="${a.id}">
          ${artMediaHtml(a, "art-image", { preview: true })}
          <div class="art-body">
            <div class="art-title">${escapeHtml(a.title)}</div>
            ${a.description ? `<div class="art-desc">${escapeHtml(a.description)}</div>` : ""}
            <div class="art-meta">
              <span>${escapeHtml(a.authorName || "аноним")} · ${timeAgo(a.createdAt)}</span>
              ${a.publicUid ? `<span class="track-nuid" data-copy-nuid="${a.publicUid}">${a.publicUid}</span>` : ""}
            </div>
            <div class="art-actions">
              <button class="subBtn ${liked ? "liked" : ""}" data-like="${a.id}">
                <span class="nf">${liked ? ICON.heartFilled : ICON.heart}</span> ${a.likesCount || 0}
              </button>
              ${mine ? `<button class="subBtn" data-edit="${a.id}" title="изменить"><span class="nf">${ICON.pencil}</span></button>
              <button class="subBtn" data-del="${a.id}" title="удалить"><span class="nf">${ICON.close}</span></button>` : ""}
            </div>
          </div>
        </div>`;
    }).join("");

    // Картинка открывается на весь экран, с приближением. Видео играет
    // на месте — у него свои кнопки, — и в листание картинок не входит.
    // Видеоработы — своим проигрывателем.
    wireArtVideos(listEl);

    const images = artImages(found);
    listEl.querySelectorAll("img.art-image").forEach((img, i) => {
      img.addEventListener("click", () => openLightbox(img.src, images, i));
    });

    listEl.querySelectorAll("[data-like]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const art = allArt.find(a => a.id === btn.dataset.like);
        try {
          const { liked: nowLiked, likesCount } = await toggleArtLike(art);
          art.likedBy = nowLiked
            ? [...(art.likedBy || []), currentUser.uid]
            : (art.likedBy || []).filter(u => u !== currentUser.uid);
          art.likesCount = likesCount;
          btn.classList.toggle("liked", nowLiked);
          btn.innerHTML = `<span class="nf">${nowLiked ? ICON.heartFilled : ICON.heart}</span> ${likesCount}`;
        } catch (e) { showToast(e.message); }
      });
    });

    listEl.querySelectorAll("[data-edit]").forEach(btn => {
      btn.addEventListener("click", () => {
        const art = allArt.find(a => a.id === btn.dataset.edit);
        if (art) openArtForm({ art, onDone: refresh });
      });
    });

    listEl.querySelectorAll("[data-del]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!await askConfirm("Удалить работу?", { okLabel: "Удалить", danger: true })) return;
        await deleteArtwork(btn.dataset.del);
        showToast("Удалена");
        refresh();
      });
    });
  }

  refresh();
}


// Окно работы: одно на создание и правку — поля те же, меняется только
// заголовок и что происходит при сохранении. Пошаговые вопросы были неудобны.
export function openArtForm({ file = null, art = null, onDone } = {}) {
  const editing = !!art;
  // Видео — либо новое (выбран файл-видео), либо правим видеоработу.
  const isVideo = editing ? art.kind === "video" : !!file?.type?.startsWith("video/");

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-content" style="max-width:460px;">
      <button class="closeBtn modalClose" data-cancel><span class="nf">${ICON.close}</span></button>
      <h2 style="margin-top:0;font-size:17px;">${editing ? "Изменить работу" : (isVideo ? "Новое видео" : "Новая работа")}</h2>

      <div class="art-form">
        <div class="art-form-preview">
          ${isVideo
            ? `<video data-preview muted playsinline loop autoplay></video>`
            : `<img data-preview alt="">`}
        </div>
        <div style="flex:1;min-width:0;">
          <input class="inlineEdit" data-title placeholder="Название" maxlength="60"
                 value="${editing ? escapeHtml(art.title || "") : ""}">
          <textarea class="inlineEdit art-form-desc" data-desc placeholder="Описание"
                    maxlength="300">${editing ? escapeHtml(art.description || "") : ""}</textarea>
        </div>
      </div>

      <div class="dialog-buttons">
        <button class="secondaryBtn" data-cancel>Отмена</button>
        <button class="primaryBtn" data-save>${editing ? "Сохранить" : "Выложить"}</button>
      </div>
    </div>`;
  document.body.appendChild(box);
  wireArtVideos(box);   // видеоработа — своим проигрывателем

  const preview = box.querySelector("[data-preview]");
  preview.src = editing ? (isVideo ? art.videoUrl : art.imageUrl) : URL.createObjectURL(file);

  const close = () => closeOverlay(box);
  box.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", close));
  box.addEventListener("click", (e) => { if (e.target === box) close(); });

  box.querySelector("[data-save]").addEventListener("click", async () => {
    const title = box.querySelector("[data-title]").value.trim();
    const description = box.querySelector("[data-desc]").value.trim();
    if (!title) { showToast("Нужно название"); return; }

    const btn = box.querySelector("[data-save]");
    btn.disabled = true;
    btn.textContent = editing ? "Сохраняю…" : "Загружаю…";
    try {
      if (editing) {
        const { updateArtwork } = await import("./art.js");
        await updateArtwork(art.id, { title, description });
        showToast("Изменено ♡");
      } else if (isVideo) {
        // Видео грузится дольше картинки — показываем ход на кнопке,
        // иначе непонятно, идёт ли что-то вообще.
        const { uploadArtVideo } = await import("./art.js");
        const { publicUid } = await uploadArtVideo({
          file, title, description,
          onProgress: (r) => { btn.textContent = `Загружаю… ${Math.round(r * 100)}%`; }
        });
        showToast(`Готово ♡ Номер: ${publicUid}`);
      } else {
        const { publicUid } = await uploadArt({ file, title, description });
        showToast(`Готово ♡ Номер: ${publicUid}`);
      }
      // Сначала окно уходит, потом обновляется список: иначе
      // перерисовка сбивает анимацию закрытия.
      closeOverlay(box, () => onDone?.());
    } catch (e) {
      console.error(e);
      showToast("Не вышло: " + e.message);
      btn.disabled = false;
      btn.textContent = editing ? "Сохранить" : "Выложить";
    }
  });
}


// Карточка работы по её номеру — открывается из текста записи или сообщения.
export async function openArtPreview(artId) {
  const { getArtwork } = await import("./art.js");
  const art = await getArtwork(artId).catch(() => null);

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-content" style="max-width:420px;max-height:86vh;display:flex;flex-direction:column;">
      <button class="closeBtn modalClose" data-close><span class="nf">${ICON.close}</span></button>
      <div style="overflow-y:auto;min-height:0;">
        ${art
          ? `${artMediaHtml(art, "art-popup-media")}
             <h2 style="font-size:17px;margin:12px 0 4px;">${escapeHtml(art.title)}</h2>
             ${art.description ? `<p class="art-desc">${escapeHtml(art.description)}</p>` : ""}
             <p class="muted" style="font-size:12px;">
               ${escapeHtml(art.authorName || "аноним")} · ${art.publicUid || ""}
             </p>

             <!-- Оценка прямо здесь: раньше поставить сердечко можно было
                  только в списке работ, а из записи туда ещё надо дойти. -->
             <div class="art-actions">
               <button class="subBtn ${(art.likedBy || []).includes(currentUser?.uid) ? "liked" : ""}"
                       data-like-art>
                 <span class="nf">${(art.likedBy || []).includes(currentUser?.uid) ? ICON.heartFilled : ICON.heart}</span>
                 <span data-likes>${art.likesCount || 0}</span>
               </button>
             </div>`
          : `<div class="stub-note">Работа не найдена — возможно, удалена</div>`}
      </div>
    </div>`;
  document.body.appendChild(box);

  wireArtVideos(box);   // видеоработа — своим проигрывателем

  box.querySelector("[data-like-art]")?.addEventListener("click", async (e) => {
    const button = e.currentTarget;
    try {
      const { toggleArtLike } = await import("./art.js");
      const { liked, likesCount } = await toggleArtLike(art);

      button.classList.toggle("liked", liked);
      button.querySelector(".nf").textContent = liked ? ICON.heartFilled : ICON.heart;
      button.querySelector("[data-likes]").textContent = likesCount;
    } catch (e) {
      showToast(e.message);
    }
  });

  const close = () => closeOverlay(box);
  box.querySelector("[data-close]").addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
}
