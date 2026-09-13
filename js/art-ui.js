import { listArtworks, uploadArt, deleteArtwork, toggleArtLike } from "./art.js";
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
          <img class="art-image" src="${a.imageUrl}" alt="${escapeHtml(a.title)}" loading="lazy">
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

    // картинка открывается на весь экран, с приближением
    const images = found.map(a => a.imageUrl);
    listEl.querySelectorAll(".art-image").forEach((img, i) => {
      img.addEventListener("click", () => openLightbox(img.src, images, i));
    });

    listEl.querySelectorAll("[data-like]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const art = allArt.find(a => a.id === btn.dataset.like);
        try {
          const nowLiked = await toggleArtLike(art);
          art.likedBy = nowLiked
            ? [...(art.likedBy || []), currentUser.uid]
            : (art.likedBy || []).filter(u => u !== currentUser.uid);
          art.likesCount = Math.max(0, (art.likesCount || 0) + (nowLiked ? 1 : -1));
          btn.classList.toggle("liked", nowLiked);
          btn.innerHTML = `<span class="nf">${nowLiked ? ICON.heartFilled : ICON.heart}</span> ${art.likesCount}`;
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

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-content" style="max-width:460px;">
      <button class="closeBtn modalClose" data-cancel><span class="nf">${ICON.close}</span></button>
      <h2 style="margin-top:0;font-size:17px;">${editing ? "Изменить работу" : "Новая работа"}</h2>

      <div class="art-form">
        <div class="art-form-preview">
          <img data-preview alt="">
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

  const preview = box.querySelector("[data-preview]");
  preview.src = editing ? art.imageUrl : URL.createObjectURL(file);

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
      } else {
        const { publicUid } = await uploadArt({ file, title, description });
        showToast(`Готово ♡ Номер: ${publicUid}`);
      }
      close();
      onDone?.();
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
          ? `<img src="${art.imageUrl}" alt="" style="width:100%;border-radius:12px;display:block;">
             <h2 style="font-size:17px;margin:12px 0 4px;">${escapeHtml(art.title)}</h2>
             ${art.description ? `<p class="art-desc">${escapeHtml(art.description)}</p>` : ""}
             <p class="muted" style="font-size:12px;">
               ${escapeHtml(art.authorName || "аноним")} · ${art.publicUid || ""}
             </p>`
          : `<div class="stub-note">Работа не найдена — возможно, удалена</div>`}
      </div>
    </div>`;
  document.body.appendChild(box);

  const close = () => closeOverlay(box);
  box.querySelector("[data-close]").addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
}
