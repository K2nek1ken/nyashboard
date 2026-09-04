import { ICON } from "./icons.js";

// Просмотр изображения на весь экран с приближением.
// Зум: колесо мыши, щипок двумя пальцами, двойное нажатие. Перетаскивание —
// мышью или пальцем. Никаких библиотек: всё через transform, поэтому плавно
// даже на слабом устройстве.
export function openLightbox(src, allSrcs = [], startIndex = 0) {
  const list = allSrcs.length ? allSrcs : [src];
  let index = Math.max(0, startIndex);

  const box = document.createElement("div");
  box.className = "lightbox";
  box.innerHTML = `
    <button class="lightbox-close" data-close><span class="nf">${ICON.close}</span></button>
    ${list.length > 1 ? `
      <button class="lightbox-nav prev" data-prev><span class="nf">${ICON.left}</span></button>
      <button class="lightbox-nav next" data-next><span class="nf">${ICON.right}</span></button>
      <div class="lightbox-counter" data-counter></div>` : ""}
    <div class="lightbox-stage" data-stage>
      <img data-img src="${list[index]}" alt="">
    </div>
    <div class="lightbox-hint">колесом или щипком — приблизить, двойное нажатие — сбросить</div>`;
  document.body.appendChild(box);
  document.body.style.overflow = "hidden";   // фон не должен прокручиваться

  const img = box.querySelector("[data-img]");
  const stage = box.querySelector("[data-stage]");
  const counter = box.querySelector("[data-counter]");

  let scale = 1, tx = 0, ty = 0;

  function apply() {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    img.classList.toggle("zoomed", scale > 1.02);
  }

  function reset() { scale = 1; tx = 0; ty = 0; apply(); }

  function setIndex(next) {
    index = (next + list.length) % list.length;
    img.src = list[index];
    if (counter) counter.textContent = `${index + 1} / ${list.length}`;
    reset();
  }
  if (counter) counter.textContent = `${index + 1} / ${list.length}`;

  // ограничиваем сдвиг, чтобы картинку нельзя было утащить за пределы экрана
  function clamp() {
    const rect = stage.getBoundingClientRect();
    const maxX = Math.max(0, (rect.width * scale - rect.width) / 2);
    const maxY = Math.max(0, (rect.height * scale - rect.height) / 2);
    tx = Math.min(maxX, Math.max(-maxX, tx));
    ty = Math.min(maxY, Math.max(-maxY, ty));
  }

  function zoomAt(factor, cx, cy) {
    const prev = scale;
    scale = Math.min(6, Math.max(1, scale * factor));
    // приближаем к точке под курсором, а не к центру
    const rect = stage.getBoundingClientRect();
    const dx = cx - rect.left - rect.width / 2;
    const dy = cy - rect.top - rect.height / 2;
    tx = (tx - dx) * (scale / prev) + dx;
    ty = (ty - dy) * (scale / prev) + dy;
    if (scale === 1) { tx = 0; ty = 0; }
    clamp(); apply();
  }

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX, e.clientY);
  }, { passive: false });

  let lastTap = 0;
  stage.addEventListener("click", (e) => {
    const now = Date.now();
    if (now - lastTap < 300) {
      scale > 1.02 ? reset() : zoomAt(2.4, e.clientX, e.clientY);
    }
    lastTap = now;
  });

  // перетаскивание
  let dragging = false, lastX = 0, lastY = 0;
  const point = (e) => e.touches ? e.touches[0] : e;
  stage.addEventListener("pointerdown", (e) => {
    if (scale <= 1.02) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tx += e.clientX - lastX; ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    clamp(); apply();
  });
  stage.addEventListener("pointerup", () => { dragging = false; });

  // щипок двумя пальцами
  let pinchStart = 0, startScale = 1;
  stage.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 2) return;
    pinchStart = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                            e.touches[0].clientY - e.touches[1].clientY);
    startScale = scale;
  }, { passive: true });
  stage.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 2 || !pinchStart) return;
    e.preventDefault();
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                         e.touches[0].clientY - e.touches[1].clientY);
    scale = Math.min(6, Math.max(1, startScale * (d / pinchStart)));
    if (scale === 1) { tx = 0; ty = 0; }
    clamp(); apply();
  }, { passive: false });
  stage.addEventListener("touchend", () => { pinchStart = 0; });

  function close() {
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    box.remove();
  }
  function onKey(e) {
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight" && list.length > 1) setIndex(index + 1);
    if (e.key === "ArrowLeft" && list.length > 1) setIndex(index - 1);
  }
  document.addEventListener("keydown", onKey);

  box.querySelector("[data-close]").addEventListener("click", close);
  box.querySelector("[data-prev]")?.addEventListener("click", (e) => { e.stopPropagation(); setIndex(index - 1); });
  box.querySelector("[data-next]")?.addEventListener("click", (e) => { e.stopPropagation(); setIndex(index + 1); });
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
}

// Вешает открытие на все изображения внутри контейнера. Внутри одной записи
// картинки листаются между собой — как в галерее.
export function wireImageZoom(container) {
  const groups = container.querySelectorAll(".post-card, .chat-msg");
  groups.forEach(group => {
    const imgs = [...group.querySelectorAll(".post-img, .carousel-slide img, .reply-img, .chat-msg > img")];
    if (!imgs.length) return;
    const srcs = imgs.map(i => i.src);
    imgs.forEach((im, i) => {
      im.style.cursor = "zoom-in";
      im.addEventListener("click", (e) => {
        e.stopPropagation();
        openLightbox(im.src, srcs, i);
      });
    });
  });
}
