import { db, auth, collection, addDoc, doc, setDoc, updateDoc, serverTimestamp } from "./firebase.js";
import { currentUser, currentUserDoc, authReady } from "./auth.js";
import { uploadImages } from "./storage.js";
import { extractHashtags } from "./hashtags.js";
import { markOwned } from "./ownership.js";
import { initPostIdentity, identityFields, getPostIdentity } from "./post-identity.js";
import { showToast, escapeHtml } from "./ui.js";
import { ICON } from "./icons.js";

// ============================================================
//  Редактор записи
//
//  Один на всё: новая запись в ленту, запись на стену, правка существующей.
//  Раньше их было три — полноэкранный экран в ленте, маленькое окно на стене
//  и ещё одно для правки. Отличались они мелочами, а расходились быстро:
//  что-то чинилось в одном месте и оставалось сломанным в двух других.
//
//  Открывается на весь экран: писать в узкой полоске неудобно, а места
//  на любом устройстве достаточно.
//
//  Плеер остаётся видимым — он живёт выше и сдвигает содержимое вниз,
//  а не прячется за окном.
// ============================================================

export function openPostComposer({ post = null, place = "feed", onDone } = {}) {
  const editing = !!post;

  const box = document.createElement("div");
  box.className = "composer-screen";
  box.innerHTML = `
    <div class="composer-top">
      <span class="composer-title">${editing ? "Изменить запись"
        : place === "wall" ? "Запись на стену" : "Новая запись"}</span>
      <div id="composerIdentity" class="${editing ? "hidden" : ""}"></div>
      <button class="closeBtn" data-cancel><span class="nf">${ICON.close}</span></button>
    </div>

    <textarea class="composer-area" data-text
      placeholder="${place === "wall" ? "Что у тебя нового? ♡" : "Что расскажешь? ♡"}"
    >${editing ? escapeHtml(post.text || "") : ""}</textarea>

    <div class="image-strip" data-strip></div>

    <div class="composer-bottom">
      <label class="composer-attach">
        <span class="nf">${ICON.image}</span>
        <input type="file" accept="image/*" multiple data-images style="display:none;">
      </label>
      <button class="primaryBtn" data-save>${editing ? "Сохранить" : "Опубликовать"}</button>
    </div>`;
  document.body.appendChild(box);
  document.body.classList.add("composer-open");

  const area = box.querySelector("[data-text]");
  const strip = box.querySelector("[data-strip]");
  const fileInput = box.querySelector("[data-images]");
  let images = [];

  if (!editing) initPostIdentity(box.querySelector("#composerIdentity"));

  const close = () => {
    box.remove();
    document.body.classList.remove("composer-open");
  };
  box.querySelector("[data-cancel]").addEventListener("click", close);

  // Поле растёт под текст, но не выше экрана: дальше прокручивается.
  const grow = () => {
    area.style.height = "auto";
    area.style.height = Math.min(area.scrollHeight, window.innerHeight * 0.5) + "px";
  };
  area.addEventListener("input", grow);
  requestAnimationFrame(() => { grow(); area.focus(); });

  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) box.querySelector("[data-save]").click();
  });

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
        <img src="${URL.createObjectURL(f)}" alt="">
        <button class="removeThumb" data-remove="${i}"><span class="nf">${ICON.close}</span></button>
      </div>`).join("");
    strip.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        images.splice(Number(btn.dataset.remove), 1);
        renderStrip();
      });
    });
  }

  box.querySelector("[data-save]").addEventListener("click", async () => {
    const text = area.value.trim();
    if (!text && !images.length) { showToast("Пустую запись не отправить"); return; }

    const btn = box.querySelector("[data-save]");
    btn.disabled = true;
    btn.textContent = editing ? "Сохраняю…" : "Публикую…";

    try {
      if (editing) {
        await updateDoc(doc(db, "posts", post.id), {
          text,
          hashtags: extractHashtags(text),
          editedAt: serverTimestamp()
        });
        post.text = text;
        post.editedAt = { toMillis: () => Date.now() };
        showToast("Изменено ♡");
      } else {
        const imageUrls = images.length ? await uploadImages(images) : [];
        const ref = await addDoc(collection(db, "posts"), {
          ...identityFields(),
          place,
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

        // Копия авторства нужна только записям от своего имени — у анонимных
        // и канальных её быть не должно.
        if (getPostIdentity().kind === "self" && currentUser && currentUserDoc) {
          await setDoc(doc(db, "postAuthors", ref.id), {
            uid: currentUser.uid,
            nickname: currentUserDoc.nickname || "",
            avatarUrl: currentUserDoc.avatarUrl || "",
            avatarShape: currentUserDoc.avatarShape || "circle",
            statusEmoji: currentUserDoc.statusEmoji || ""
          }).catch(() => {});
        }

        import("./nuid.js")
          .then(({ registerPostNuid }) => registerPostNuid(ref.id))
          .then(nuid => updateDoc(doc(db, "posts", ref.id), { publicUid: nuid }))
          .catch(e => console.warn("Номер записи не записался:", e.message));

        showToast(place === "wall" ? "Опубликовано на стене ♡" : "Опубликовано ♡");
      }

      close();
      onDone?.();
    } catch (e) {
      console.error(e);
      showToast(/permission|insufficient/i.test(e.message)
        ? "Не хватает прав — проверь, что правила базы обновлены"
        : "Не вышло: " + e.message);
      btn.disabled = false;
      btn.textContent = editing ? "Сохранить" : "Опубликовать";
    }
  });
}
