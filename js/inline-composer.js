import { currentUser, currentUserDoc, authReady } from "./auth.js";
import { initPostIdentity, identityFields, getPostIdentity } from "./post-identity.js";
import { registerPostNuid } from "./nuid.js";
import { uploadImages } from "./storage.js";
import { db, auth, collection, addDoc, doc, setDoc, serverTimestamp, updateDoc } from "./firebase.js";
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
  initPostIdentity(document.getElementById("icIdentityHost"));
  const hint = document.getElementById("icHint");
  let images = [];

  // высота по содержимому: без этого поле осталось бы в одну строку
  function autoGrow() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 420) + "px";
  }
  textarea.addEventListener("input", autoGrow);

  // Гостю выбирать не из чего — это решает сам модуль выбора имени,
  // отдельная проверка здесь больше не нужна.

  function renderStrip() {
    strip.innerHTML = images.map((f, i) => `
      <div class="thumb" data-idx="${i}">
        <img src="${URL.createObjectURL(f)}">
        <button class="removeThumb" data-remove="${i}"><span class="nf">${ICON.close}</span></button>
      </div>`).join("");
    hint.textContent = images.length ? `${images.length}/10` : "";
    strip.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        images.splice(Number(btn.dataset.remove), 1);
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

  document.getElementById("icEmoji")?.addEventListener("click", (e) => {
    e.stopPropagation();
    openEmojiPicker(box, (emoji) => { textarea.value += emoji; textarea.focus(); autoGrow(); });
  });

  publishBtn.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text && !images.length) { showToast("Пустую запись не отправить"); return; }
    if (publishBtn.disabled) return;

    // Поле очищается сразу: с фотографиями публикация занимает секунды,
    // и без отклика легко нажать ещё раз, получив две одинаковые записи.
    const pending = images.slice();
    const savedText = text;
    textarea.value = "";
    images = [];
    renderStrip();
    autoGrow();

    publishBtn.disabled = true;
    publishBtn.textContent = "Публикую...";
    if (pending.length) showToast("Отправляю…");

    try {
      const imageUrls = pending.length ? await uploadImages(pending) : [];
      if (imageUrls.some(u => !u)) throw new Error("Одна из картинок не загрузилась");
      const ref = await addDoc(collection(db, "posts"), {
        ...identityFields(),
        place: "feed",   // из ленты пишем в ленту; на стену — со своей страницы
        wallInFeed: currentUserDoc?.wallInFeed !== false,
        channelId: null,
                text: savedText,
        hashtags: extractHashtags(savedText),
        imageUrls,
        likesCount: 0, likedBy: [],
        dislikesCount: 0, dislikedBy: [],
        createdAt: serverTimestamp()
      });
      await setDoc(doc(db, "postSecrets", ref.id), { ownerUid: auth.currentUser.uid });
      if (getPostIdentity().kind === "self" && currentUser && currentUserDoc) {
        await setDoc(doc(db, "postAuthors", ref.id), {
          uid: currentUser.uid,
          nickname: currentUserDoc.nickname || "",
          avatarUrl: currentUserDoc.avatarUrl || "",
          avatarShape: currentUserDoc.avatarShape || "circle",
          statusEmoji: currentUserDoc.statusEmoji || ""
        }).catch(() => {});
      }
      markOwned("post", ref.id);

      registerPostNuid(ref.id)
        .then(nuid => updateDoc(doc(db, "posts", ref.id), { publicUid: nuid }))
        .catch(e => console.warn("Идентификатор записи не записался:", e.message));

      showToast("Опубликовано ♡");
      onPublished?.();
    } catch (e) {
      console.error(e);
      // возвращаем написанное, чтобы не пришлось набирать заново
      textarea.value = savedText;
      images = pending;
      renderStrip();
      autoGrow();
      showToast(friendlyError(e));
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = "Опубликовать";
    }
  });
}


// Отказ базы приходит по-английски и человеку ничего не объясняет.
// Переводим самое частое, остальное показываем как есть.
function friendlyError(e) {
  const msg = e?.message || "";
  if (/permission|insufficient/i.test(msg)) {
    return "Не хватает прав — проверь, что правила базы обновлены";
  }
  if (/network|offline|unavailable/i.test(msg)) {
    return "Нет связи с сервером — попробуй ещё раз";
  }
  if (/quota|resource-exhausted/i.test(msg)) {
    return "Слишком много запросов — подожди немного";
  }
  return "Ошибка: " + msg;
}
