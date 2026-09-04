import { currentUser, currentUserDoc, authReady } from "./auth.js";
import { uploadImages } from "./storage.js";
import { db, auth, collection, addDoc, doc, setDoc, serverTimestamp } from "./firebase.js";
import { extractHashtags } from "./hashtags.js";
import { markOwned } from "./ownership.js";
import { openEmojiPicker } from "./emoji.js";
import { showToast } from "./ui.js";
import { ICON } from "./icons.js";

// Строка создания записи прямо в ленте — только для широких экранов.
// Смысл в том, что на компьютере тянуться к кнопке в углу неудобно, а места
// хватает, чтобы писать сразу на месте. Поле растёт по мере набора текста,
// отдельный экран не открывается.
export function initInlineComposer(onPublished) {
  const box = document.getElementById("inlineComposer");
  if (!box) return;

  const textarea = document.getElementById("icText");
  const strip = document.getElementById("icStrip");
  const fileInput = document.getElementById("icImages");
  const publishBtn = document.getElementById("icPublish");
  const anonToggle = document.getElementById("icAnon");
  const anonLabel = document.getElementById("icAnonLabel");
  const hint = document.getElementById("icHint");
  let images = [];

  // высота по содержимому: без этого поле осталось бы в одну строку
  function autoGrow() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 420) + "px";
  }
  textarea.addEventListener("input", autoGrow);

  authReady.then(() => {
    if (!currentUser) {
      anonToggle.checked = true;
      anonToggle.disabled = true;
      anonLabel.textContent = "гость — всегда анонимно";
    }
  });

  anonToggle.addEventListener("change", () => {
    anonLabel.textContent = anonToggle.checked ? "анонимно" : "от своего имени";
  });

  // Ссылка на файл создаётся один раз и живёт, пока файл в списке. Раньше
  // createObjectURL звался прямо в шаблоне — новая ссылка на каждую
  // перерисовку, и ни одна не освобождалась.
  const previews = new WeakMap();
  function previewUrl(file) {
    if (!previews.has(file)) previews.set(file, URL.createObjectURL(file));
    return previews.get(file);
  }
  function releasePreviews(files) {
    files.forEach(f => {
      if (previews.has(f)) { URL.revokeObjectURL(previews.get(f)); previews.delete(f); }
    });
  }

  function renderStrip() {
    strip.innerHTML = images.map((f, i) => `
      <div class="thumb" data-idx="${i}">
        <img src="${previewUrl(f)}">
        <button class="removeThumb" data-remove="${i}"><span class="nf">${ICON.close}</span></button>
      </div>`).join("");
    hint.textContent = images.length ? `${images.length}/10` : "";
    strip.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        releasePreviews(images.splice(Number(btn.dataset.remove), 1));
        renderStrip();
      });
    });
  }

  fileInput.addEventListener("change", () => {
    const picked = Array.from(fileInput.files || []);
    const room = 10 - images.length;
    if (picked.length > room) showToast(`Максимум 10 фото — добавила ${room}`);
    picked.slice(0, room).forEach(f => images.push(f));
    fileInput.value = "";
    renderStrip();
  });

  document.getElementById("icEmoji").addEventListener("click", (e) => {
    e.stopPropagation();
    openEmojiPicker(box, (emoji) => { textarea.value += emoji; textarea.focus(); autoGrow(); });
  });

  publishBtn.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text && !images.length) { showToast("Пустую запись не отправить"); return; }
    publishBtn.disabled = true;
    publishBtn.textContent = "Публикую...";
    try {
      const imageUrls = images.length ? await uploadImages(images) : [];
      if (imageUrls.some(u => !u)) throw new Error("Одна из картинок не загрузилась");

      const isAnon = !currentUser || anonToggle.checked;
      const ref = await addDoc(collection(db, "posts"), {
        authorUid: (!isAnon && currentUser) ? currentUser.uid : null,
        authorNickname: (!isAnon && currentUserDoc) ? currentUserDoc.nickname : null,
        authorAvatar: (!isAnon && currentUserDoc) ? currentUserDoc.avatarUrl : null,
        authorShape: (!isAnon && currentUserDoc) ? (currentUserDoc.avatarShape || "circle") : null,
        authorStatus: (!isAnon && currentUserDoc) ? (currentUserDoc.statusEmoji || "") : null,
        channelId: null,
        isAnonymous: isAnon,
        text,
        hashtags: extractHashtags(text),
        imageUrls,
        likesCount: 0, likedBy: [],
        dislikesCount: 0, dislikedBy: [],
        createdAt: serverTimestamp()
      });
      await setDoc(doc(db, "postSecrets", ref.id), { ownerUid: auth.currentUser.uid });
      if (!isAnon && currentUser && currentUserDoc) {
        await setDoc(doc(db, "postAuthors", ref.id), {
          uid: currentUser.uid,
          nickname: currentUserDoc.nickname || "",
          avatarUrl: currentUserDoc.avatarUrl || "",
          avatarShape: currentUserDoc.avatarShape || "circle",
          statusEmoji: currentUserDoc.statusEmoji || ""
        }).catch(() => {});
      }
      markOwned("post", ref.id);

      textarea.value = "";
      releasePreviews(images);
      images = [];
      renderStrip();
      autoGrow();
      showToast("Опубликовано ♡");
      onPublished?.();
    } catch (e) {
      console.error(e);
      showToast("Ошибка: " + e.message);
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = "Опубликовать";
    }
  });
}
