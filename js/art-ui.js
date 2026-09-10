import { listArtworks, uploadArt, deleteArtwork, toggleArtLike } from "./art.js";
import { currentUser, authReady } from "./auth.js";
import { openLightbox } from "./lightbox.js";
import { askText, askConfirm } from "./dialog.js";
import { showToast, escapeHtml, timeAgo } from "./ui.js";
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

  fileInput?.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;

    const title = await askText("Название работы", { maxlength: 60 });
    if (!title?.trim()) return;
    const description = await askText("Описание", { placeholder: "можно пропустить", maxlength: 300 });

    showToast("Загружаю…");
    try {
      const { publicUid } = await uploadArt({ file, title, description });
      showToast(`Готово ♡ Идентификатор: ${publicUid}`);
      refresh();
    } catch (e) { showToast("Не вышло: " + e.message); }
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
              ${a.publicUid ? `<span class="track-nuid">${a.publicUid}</span>` : ""}
            </div>
            <div class="art-actions">
              <button class="subBtn ${liked ? "liked" : ""}" data-like="${a.id}">
                <span class="nf">${liked ? ICON.heartFilled : ICON.heart}</span> ${a.likesCount || 0}
              </button>
              ${mine ? `<button class="subBtn" data-del="${a.id}"><span class="nf">${ICON.close}</span></button>` : ""}
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
