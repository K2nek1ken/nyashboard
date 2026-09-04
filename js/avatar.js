import { ICON } from "./icons.js";
import { defaultAvatar } from "./default-avatar.js";

// Форма аватарки — только CSS-класс поверх картинки. Само изображение хранится
// НЕобрезанным, поэтому форму можно менять когда угодно, задним числом, без
// перезаливки фото. Прозрачные PNG не заливаются белым: под картинкой фон
// карточки, а рамка не даёт полностью прозрачной аве слиться с фоном.
export const AVATAR_SHAPES = {
  circle:   { label: "Круг",     cls: "shape-circle" },
  rounded:  { label: "Квадрат",  cls: "shape-rounded" },
  squircle: { label: "Пиксель",  cls: "shape-squircle" }
};

export function shapeClass(shape) {
  return (AVATAR_SHAPES[shape] || AVATAR_SHAPES.circle).cls;
}

// Единый рендер аватарки со статусом-эмодзи в углу.
export function avatarHtml(user, size = 34, extraAttrs = "", variant = "neko") {
  const shape = shapeClass(user?.avatarShape);
  const custom = user?.avatarUrl && user.avatarUrl !== "assets/anon.svg";
  const src = custom ? user.avatarUrl : defaultAvatar(variant);
  // data-default-avatar помечает сгенерированные аватарки, чтобы перекрасить их
  // на месте при смене темы
  const mark = custom ? "" : `data-default-avatar="${variant}"`;
  const status = user?.statusEmoji || "";
  return `
    <span class="avatar-wrap" style="width:${size}px;height:${size}px;">
      <img class="avatar-shaped ${shape}" src="${src}" style="width:${size}px;height:${size}px;" ${mark} ${extraAttrs}>
      ${status ? `<span class="avatar-status">${status}</span>` : ""}
    </span>`;
}

// Для мест, где аватарка ставится напрямую в существующий <img>
export function applyAvatar(imgEl, user, variant = "neko") {
  if (!imgEl) return;
  const custom = user?.avatarUrl && user.avatarUrl !== "assets/anon.svg";
  imgEl.src = custom ? user.avatarUrl : defaultAvatar(variant);
  if (custom) imgEl.removeAttribute("data-default-avatar");
  else imgEl.dataset.defaultAvatar = variant;
  imgEl.className = `avatar-shaped ${shapeClass(user?.avatarShape)}`;
}

export function shapePickerHtml(selected = "circle") {
  return `<div class="shape-picker">
    ${Object.entries(AVATAR_SHAPES).map(([key, s]) => `
      <button type="button" class="shapeOption ${s.cls} ${key === selected ? "selected" : ""}"
              data-shape="${key}" title="${s.label}"></button>`).join("")}
  </div>`;
}

// ================== Ручное кадрирование ==================
// Показывает картинку на canvas, даёт таскать и зумить, и отдаёт обрезанный
// квадрат. Именно квадрат, а не форму — форма применяется поверх через CSS,
// так что её можно менять потом без потери исходника.
export function openCropper(file, onDone) {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-content">
      <button class="closeBtn modalClose" data-close><span class="nf">${ICON.close}</span></button>
      <h2><span class="nf">${ICON.crop}</span> Кадрирование</h2>
      <p class="muted">Тащи, чтобы подвинуть. Ползунком — приблизить.</p>
      <div class="crop-stage" data-stage><canvas data-canvas></canvas></div>
      <div class="crop-controls">
        <span class="nf">${ICON.image}</span>
        <input type="range" data-zoom min="1" max="4" step="0.01" value="1">
      </div>
      <button class="primaryBtn" data-apply>Готово</button>
    </div>`;
  document.body.appendChild(modal);

  const stage = modal.querySelector("[data-stage]");
  const canvas = modal.querySelector("[data-canvas]");
  const ctx = canvas.getContext("2d");
  const zoomInput = modal.querySelector("[data-zoom]");

  const img = new Image();
  img.onload = () => { fit(); draw(); };
  img.src = URL.createObjectURL(file);

  let scale = 1, minScale = 1, offsetX = 0, offsetY = 0;
  const SIZE = 300; // логический размер сцены (совпадает с CSS-высотой)

  function fit() {
    canvas.width = SIZE;
    canvas.height = SIZE;
    minScale = Math.max(SIZE / img.width, SIZE / img.height);
    scale = minScale;
    zoomInput.min = String(minScale);
    zoomInput.max = String(minScale * 4);
    zoomInput.value = String(minScale);
    offsetX = (SIZE - img.width * scale) / 2;
    offsetY = (SIZE - img.height * scale) / 2;
  }

  function clamp() {
    const w = img.width * scale, h = img.height * scale;
    offsetX = Math.min(0, Math.max(SIZE - w, offsetX));
    offsetY = Math.min(0, Math.max(SIZE - h, offsetY));
  }

  function draw() {
    clamp();
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, offsetX, offsetY, img.width * scale, img.height * scale);
  }

  let dragging = false, lastX = 0, lastY = 0;
  // Пересчёт в координаты холста: контейнер на узком экране может быть меньше
  // 300px, поэтому опираемся на его фактический размер, а не на константу.
  const toLocal = (e) => {
    const r = stage.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: (p.clientX - r.left) * (SIZE / r.width), y: (p.clientY - r.top) * (SIZE / r.height) };
  };
  const start = (e) => { dragging = true; const p = toLocal(e); lastX = p.x; lastY = p.y; };
  const move = (e) => {
    if (!dragging) return;
    e.preventDefault();
    const p = toLocal(e);
    offsetX += p.x - lastX; offsetY += p.y - lastY;
    lastX = p.x; lastY = p.y;
    draw();
  };
  const end = () => { dragging = false; };

  stage.addEventListener("mousedown", start);
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  stage.addEventListener("touchstart", start, { passive: true });
  stage.addEventListener("touchmove", move, { passive: false });
  stage.addEventListener("touchend", end);

  zoomInput.addEventListener("input", () => {
    const prev = scale;
    scale = Number(zoomInput.value);
    // зумим относительно центра, а не левого верхнего угла
    offsetX = SIZE / 2 - (SIZE / 2 - offsetX) * (scale / prev);
    offsetY = SIZE / 2 - (SIZE / 2 - offsetY) * (scale / prev);
    draw();
  });

  const close = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", end);
    modal.remove();
  };
  modal.querySelector("[data-close]").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  modal.querySelector("[data-apply]").addEventListener("click", () => {
    // рендерим в 512px — с запасом под любой размер отображения
    const out = document.createElement("canvas");
    out.width = out.height = 512;
    const octx = out.getContext("2d");
    const k = 512 / SIZE;
    octx.drawImage(img, offsetX * k, offsetY * k, img.width * scale * k, img.height * scale * k);
    // PNG, чтобы не терять прозрачность у прозрачных исходников
    out.toBlob((blob) => {
      close();
      onDone(new File([blob], "avatar.png", { type: "image/png" }));
    }, "image/png");
  });
}
