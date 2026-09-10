import { db, auth, collection, addDoc, doc, setDoc, serverTimestamp } from "./firebase.js";
import { currentUser, currentUserDoc } from "./auth.js";
import { uploadImages } from "./storage.js";
import { extractHashtags } from "./hashtags.js";
import { markOwned } from "./ownership.js";
import { showToast, escapeHtml } from "./ui.js";
import { ICON } from "./icons.js";

// Окно записи на стену. Отдельное от ленты: здесь запись сразу помечается
// как «на стену» — за этим на свою страницу и заходят.
export function openWallComposer(onDone) {
  if (!currentUser) { showToast("Нужен аккаунт"); return; }

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-content" style="max-width:520px;">
      <button class="closeBtn modalClose" data-cancel><span class="nf">${ICON.close}</span></button>
      <h2 style="margin-top:0;font-size:17px;">Запись на стену</h2>
      <textarea class="edit-post-area" data-text placeholder="Что у тебя нового? ♡"></textarea>
      <div data-strip class="image-strip"></div>
      <div class="dialog-buttons" style="justify-content:space-between;">
        <label class="secondaryBtn" style="width:auto;margin:0;cursor:pointer;">
          <span class="nf">${ICON.image}</span>
          <input type="file" accept="image/*" multiple data-images style="display:none;">
        </label>
        <div style="display:flex;gap:8px;">
          <button class="secondaryBtn" data-cancel style="width:auto;margin:0;">Отмена</button>
          <button class="primaryBtn" data-save style="width:auto;margin:0;">Опубликовать</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(box);

  const area = box.querySelector("[data-text]");
  const strip = box.querySelector("[data-strip]");
  const fileInput = box.querySelector("[data-images]");
  let images = [];

  const close = () => box.remove();
  box.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", close));
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  area.focus();

  fileInput.addEventListener("change", () => {
    const picked = Array.from(fileInput.files || []);
    fileInput.value = "";
    const room = 10 - images.length;
    if (picked.length > room) showToast(`Максимум 10 фото — добавила ${Math.max(0, room)}`);
    images.push(...picked.slice(0, Math.max(0, room)));
    renderStrip();
  });

  function renderStrip() {
    strip.innerHTML = images.map((f, i) => `
      <div class="thumb">
        <img src="${URL.createObjectURL(f)}">
        <button class="removeThumb" data-remove="${i}"><span class="nf">${ICON.close}</span></button>
      </div>`).join("");
    strip.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => { images.splice(Number(btn.dataset.remove), 1); renderStrip(); });
    });
  }

  box.querySelector("[data-save]").addEventListener("click", async () => {
    const text = area.value.trim();
    if (!text && !images.length) { showToast("Пустую запись не отправить"); return; }

    const btn = box.querySelector("[data-save]");
    btn.disabled = true;
    btn.textContent = "Публикую…";
    try {
      const imageUrls = images.length ? await uploadImages(images) : [];
      const ref = await addDoc(collection(db, "posts"), {
        authorUid: currentUser.uid,
        authorNickname: currentUserDoc?.nickname || "",
        authorAvatar: currentUserDoc?.avatarUrl || "",
        authorShape: currentUserDoc?.avatarShape || "circle",
        authorStatus: currentUserDoc?.statusEmoji || "",
        authorAccessory: currentUserDoc?.accessory || "none",
        authorBorder: currentUserDoc?.avatarBorder || "pink",
        authorNickColor: currentUserDoc?.nickColor || "",
        channelId: null,
        isAnonymous: false,
        place: "wall",                                   // это запись стены
        wallInFeed: currentUserDoc?.wallInFeed !== false,
        text,
        hashtags: extractHashtags(text),
        imageUrls,
        likesCount: 0, likedBy: [],
        dislikesCount: 0, dislikedBy: [],
        createdAt: serverTimestamp()
      });
      await setDoc(doc(db, "postSecrets", ref.id), { ownerUid: auth.currentUser.uid });
      markOwned("post", ref.id);

      close();
      showToast("Опубликовано на стене ♡");
      onDone?.();
    } catch (e) {
      console.error(e);
      showToast("Ошибка: " + e.message);
      btn.disabled = false;
      btn.textContent = "Опубликовать";
    }
  });
}
