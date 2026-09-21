import { db, auth, collection, addDoc, doc, setDoc, updateDoc, serverTimestamp } from "./firebase.js";
import { currentUser, currentUserDoc, authReady } from "./auth.js";
import { uploadImages } from "./storage.js";
import { extractHashtags } from "./hashtags.js";
import { markOwned } from "./ownership.js";
import { initPostIdentity, identityFields, getPostIdentity } from "./post-identity.js";
import { showToast, escapeHtml, closeOverlay } from "./ui.js";
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

  // Два слоя: снизу неподвижный фон, поверх — содержимое. Так плеер и его
  // меню остаются выше окна и не проваливаются под фон, а перестановка
  // элементов внутри не трогает подложку.
  const box = document.createElement("div");
  box.className = "composer-screen";
  box.innerHTML = `
    <div class="composer-backdrop"></div>

    <div class="composer-body">
      <div class="composer-top">
        <span class="composer-title">${editing ? "Изменить запись"
          : place === "wall" ? "Запись на стену" : "Новая запись"}</span>
        <button class="closeBtn" data-cancel><span class="nf">${ICON.close}</span></button>
      </div>

      <div id="composerIdentity" class="${editing ? "hidden" : ""}"></div>

      <!-- Поле набора и слой подсветки лежат друг на друге: видно, как
           оформление применяется прямо во время набора. -->
      <div class="composer-field">
        <div class="composer-highlight" data-highlight aria-hidden="true"></div>
        <textarea class="composer-area" data-text spellcheck="true"
          placeholder="${place === "wall" ? "Что у тебя нового? ♡" : "Что расскажешь? ♡"}"
        >${editing ? escapeHtml(post.text || "") : ""}</textarea>
      </div>

      <div class="image-strip" data-strip></div>

      <!-- Кнопки под полем: на телефоне они иначе оказываются под клавиатурой -->
      <div class="composer-bottom">
        <label class="composer-attach" title="фото">
          <span class="nf">${ICON.image}</span>
          <input type="file" accept="image/*" multiple data-images style="display:none;">
        </label>
        <label class="composer-attach" title="видео (до 5 МБ)">
          <span class="nf">${ICON.play}</span>
          <input type="file" accept="video/*" data-video style="display:none;">
        </label>
        <span class="composer-hint">**жирный** · __курсив__ · \`код\` · ### заголовок</span>
        <button class="primaryBtn" data-save>${editing ? "Сохранить" : "Опубликовать"}</button>
      </div>
    </div>`;
  document.body.appendChild(box);
  document.body.classList.add("composer-open");

  // Двигаем плеер на место шапки: пока пишешь, шапки нет, а он иначе
  // накрывает заголовок и выбор имени.
  //
  // Задаём прямо здесь, а не только в стилях: у плеера своё положение
  // прописано несколькими правилами сразу, и надёжнее поставить явно,
  // чем гадать, какое из них победит.
  const bar = document.querySelector(".player-bar");
  const barTop = bar?.style.top || "";
  if (bar && !window.matchMedia("(min-width: 900px)").matches) {
    // Не под самый край: вплотную к верху он смотрится приклеенным,
    // и между ним и полем набора остаётся неловкая пустота.
    bar.style.top = "26px";
  }

  // Содержимое отодвигаем под плеер — по его настоящему нижнему краю,
  // а не по высоте: он стоит не вплотную к верху.
  const body = box.querySelector(".composer-body");
  if (body && bar && document.body.classList.contains("player-open")
      && !window.matchMedia("(min-width: 900px)").matches) {
    // Считаем на следующем кадре: плеер только что сдвинули, и до
    // перерисовки он всё ещё числится на старом месте.
    requestAnimationFrame(() => {
      const bottom = Math.round(bar.getBoundingClientRect().bottom);
      if (bottom > 0) body.style.paddingTop = (bottom + 12) + "px";
    });
  }

  const area = box.querySelector("[data-text]");
  const strip = box.querySelector("[data-strip]");
  const fileInput = box.querySelector("[data-images]");

  // Новые файлы, выбранные сейчас.
  let images = [];

  // Уже приложенное к записи — при правке его видно и можно убрать.
  // Храним ссылками: файлов у нас нет, они давно в хранилище.
  let keptImages = editing ? [...(post.imageUrls || [])] : [];
  let keptVideo = editing ? (post.videoUrl || null) : null;
  let keptPoster = editing ? (post.videoPoster || null) : null;

  if (!editing) initPostIdentity(box.querySelector("#composerIdentity"));

  const close = () => {
    // Возвращаем плеер туда, где он стоял.
    if (bar) bar.style.top = barTop;
    closeOverlay(box);
  };
  box.querySelector("[data-cancel]").addEventListener("click", close);

  const highlight = box.querySelector("[data-highlight]");

  // Подсветка разметки прямо во время набора: под полем лежит тот же текст,
  // но уже оформленный, а сам текст в поле прозрачный — видно только курсор
  // и выделение. Так сразу понятно, что получится, и публиковать ради
  // проверки не нужно.
  //
  // Звёздочки и решётки остаются на месте: их видно оформленными, а не
  // спрятанными — иначе непонятно, где правка разметки, а где текст.
  const paintHighlight = async () => {
    try {
      const { markupPreview } = await import("./markup.js");
      // перенос в конце нужен, чтобы последняя строка не обрезалась
      highlight.innerHTML = markupPreview(escapeHtml(area.value)) + "\n";
    } catch {
      highlight.textContent = area.value;
    }
  };

  // Поле растёт под текст. Потолок невысокий: длинный текст удобнее
  // прокручивать, чем тянуться к кнопкам через весь экран.
  // Подсветка лежит под прозрачным полем и должна совпадать с ним до
  // пикселя — и по высоте, и по прокрутке. Иначе видишь одно место текста,
  // а курсор стоит в другом: нажимаешь тут, а стирается там.
  const syncHighlight = () => { highlight.scrollTop = area.scrollTop; };

  const grow = () => {
    // Чтобы узнать нужную высоту, поле на мгновение сбрасывают в «auto» —
    // и при этом теряется его прокрутка. Запоминаем и возвращаем.
    const keepTop = area.scrollTop;
    area.style.height = "auto";
    const max = Math.min(window.innerHeight * 0.34, 320);
    area.style.height = Math.min(area.scrollHeight, max) + "px";
    highlight.style.height = area.style.height;
    area.scrollTop = keepTop;
    syncHighlight();
  };

  area.addEventListener("input", () => {
    grow();
    paintHighlight();
    // Перерисованная подсветка начинает с самого верха — возвращаем её
    // туда же, где стоит поле.
    syncHighlight();
  });
  area.addEventListener("scroll", syncHighlight);
  // Курсор может уйти за край без прокрутки как таковой — например,
  // стрелками или выделением. Подгоняем и тогда.
  area.addEventListener("keyup", syncHighlight);
  area.addEventListener("click", syncHighlight);
  area.addEventListener("select", syncHighlight);

  requestAnimationFrame(() => { grow(); paintHighlight(); syncHighlight(); area.focus(); });

  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    // Отправка по Shift+Enter или Ctrl+Enter — как и везде на сайте.
    if (e.key === "Enter" && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      box.querySelector("[data-save]").click();
    }
  });

  // Видео: одно на запись. Больше — и лента превратится в видеохостинг,
  // а хранилище кончится за неделю.
  let videoFile = null;
  const videoInput = box.querySelector("[data-video]");

  videoInput?.addEventListener("change", async () => {
    const picked = videoInput.files[0];
    videoInput.value = "";
    if (!picked) return;

    const { isVideoFile } = await import("./storage.js");
    if (!isVideoFile(picked)) { showToast("Это не видео"); return; }
    if (picked.size > 5 * 1024 * 1024) {
      showToast(`Видео на ${(picked.size / 1024 / 1024).toFixed(1)} МБ — предел 5 МБ`);
      return;
    }

    videoFile = picked;
    showToast("Видео прикреплено ♡");
    renderStrip();
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
    // Видео: либо только что выбранное, либо то, что уже было в записи.
    const videoRow = (videoFile || keptVideo)
      ? `<div class="thumb thumb-video">
           <span class="nf">${ICON.play}</span>
           <span class="thumb-name">${escapeHtml(videoFile ? videoFile.name : "видео в записи")}</span>
           <button class="removeThumb" data-drop-video><span class="nf">${ICON.close}</span></button>
         </div>`
      : "";

    // Картинки, которые уже в записи. Убрать можно любую.
    const keptRows = keptImages.map((url, i) => `
      <div class="thumb">
        <img src="${escapeHtml(url)}" alt="">
        <button class="removeThumb" data-drop-image="${i}"><span class="nf">${ICON.close}</span></button>
      </div>`).join("");

    strip.innerHTML = videoRow + keptRows + images.map((f, i) => `
      <div class="thumb">
        <img src="${URL.createObjectURL(f)}" alt="">
        <button class="removeThumb" data-remove="${i}"><span class="nf">${ICON.close}</span></button>
      </div>`).join("");
    strip.querySelector("[data-drop-video]")?.addEventListener("click", () => {
      videoFile = null;
      keptVideo = null;
      keptPoster = null;
      renderStrip();
    });

    strip.querySelectorAll("[data-drop-image]").forEach(btn => {
      btn.addEventListener("click", () => {
        keptImages.splice(Number(btn.dataset.dropImage), 1);
        renderStrip();
      });
    });

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
        // Новые файлы, добавленные при правке, тоже нужно загрузить.
        const added = images.length ? await uploadImages(images) : [];

        let video = keptVideo ? { url: keptVideo, poster: keptPoster } : null;
        if (videoFile) {
          btn.textContent = "Загружаю видео…";
          const { uploadVideo } = await import("./storage.js");
          video = await uploadVideo(videoFile, (r) => {
            btn.textContent = `Видео… ${Math.round(r * 100)}%`;
          });
        }

        const imageUrls = [...keptImages, ...added];

        await updateDoc(doc(db, "posts", post.id), {
          text,
          hashtags: extractHashtags(text),
          imageUrls,
          videoUrl: video?.url || null,
          videoPoster: video?.poster || null,
          editedAt: serverTimestamp()
        });

        // Обновляем запись на месте, чтобы карточка перерисовалась с тем,
        // что получилось, а не с прежним набором вложений.
        post.text = text;
        post.imageUrls = imageUrls;
        post.videoUrl = video?.url || null;
        post.videoPoster = video?.poster || null;
        post.editedAt = { toMillis: () => Date.now() };
        showToast("Изменено ♡");
      } else {
        const imageUrls = images.length ? await uploadImages(images) : [];

        let video = null;
        if (videoFile) {
          btn.textContent = "Загружаю видео…";
          const { uploadVideo } = await import("./storage.js");
          video = await uploadVideo(videoFile, (r) => {
            btn.textContent = `Видео… ${Math.round(r * 100)}%`;
          });
        }
        const ref = await addDoc(collection(db, "posts"), {
          ...identityFields(),
          place,
          wallInFeed: currentUserDoc?.wallInFeed !== false,
          text,
          hashtags: extractHashtags(text),
          imageUrls,
          videoUrl: video?.url || null,
          videoPoster: video?.poster || null,
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

      // Сначала окно уходит, потом обновление: перерисовка сбивает
      // анимацию закрытия, и окно пропадает рывком.
      closeOverlay(box, () => onDone?.());
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
