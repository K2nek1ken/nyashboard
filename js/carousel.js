import { ICON } from "./icons.js";

// Универсальная карусель для постов с несколькими фото. Если фото одно — просто
// обычная картинка без всякой карусели (не усложняем, где не нужно).
export function imagesToHtml(images) {
  if (!images || !images.length) return "";
  if (images.length === 1) return `<img class="post-img" src="${images[0]}">`;
  const slides = images.map(url => `<div class="carousel-slide"><img src="${url}"></div>`).join("");
  return `
    <div class="carousel" data-carousel>
      <div class="carousel-track" data-carousel-track>${slides}</div>
      <div class="carousel-badge" data-carousel-badge>1/${images.length}</div>
      <button class="carousel-nav prev nf" data-carousel-prev disabled>${ICON.left}</button>
      <button class="carousel-nav next nf" data-carousel-next>${ICON.right}</button>
    </div>`;
}

// Считает бейдж "N/M" по скроллу и обслуживает стрелки. Стрелки нужны на ПК:
// мышью трек не свайпнёшь, а тянуть скроллбар под картинкой — так себе UX.
// На телефоне они скрыты через CSS, там работает обычный свайп.
export function wireCarousels(container) {
  container.querySelectorAll("[data-carousel]").forEach(carousel => {
    const track = carousel.querySelector("[data-carousel-track]");
    const badge = carousel.querySelector("[data-carousel-badge]");
    const prev = carousel.querySelector("[data-carousel-prev]");
    const next = carousel.querySelector("[data-carousel-next]");
    const total = track.children.length;

    const currentIndex = () => Math.round(track.scrollLeft / track.clientWidth);

    function sync() {
      const idx = currentIndex();
      badge.textContent = `${Math.min(idx + 1, total)}/${total}`;
      if (prev) prev.disabled = idx <= 0;
      if (next) next.disabled = idx >= total - 1;
    }

    let ticking = false;
    track.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { sync(); ticking = false; });
    });

    function go(delta) {
      const target = Math.min(Math.max(currentIndex() + delta, 0), total - 1);
      track.scrollTo({ left: target * track.clientWidth, behavior: "smooth" });
    }
    // stopPropagation — иначе клик по стрелке всплывёт до карточки поста
    if (prev) prev.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); go(-1); });
    if (next) next.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); go(1); });

    sync();
  });
}

// Достаёт массив картинок поста с учётом старых постов (у них только imageUrl,
// не imageUrls) — чтобы не трогать уже существующие данные при миграции.
export function getPostImages(p) {
  if (p.imageUrls && p.imageUrls.length) return p.imageUrls;
  if (p.imageUrl) return [p.imageUrl];
  return [];
}
