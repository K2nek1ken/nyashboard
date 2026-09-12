// ============================================================
//  Перекрашивание картинок
//
//  Три способа, от простого к сложному:
//
//    off        — оставить как есть
//    silhouette — залить одним цветом: от рисунка остаётся только форма,
//                 детали пропадают. Подходит для чёрных значков.
//    duotone    — обесцветить и затонировать: детали сохраняются, но всё
//                 оказывается в оттенках акцентного цвета. Подходит для
//                 фотографий и цветных рисунков.
//
//  Везде сохраняется прозрачность: фон остаётся фоном, иначе частица
//  превратилась бы в прямоугольник.
// ============================================================

export function tintImage(img, color, mode = "silhouette") {
  if (mode === "off") return img;

  const size = Math.max(img.naturalWidth || 64, img.naturalHeight || 64, 16);
  const side = Math.min(size, 256);
  const scale = side / Math.max(img.naturalWidth || side, img.naturalHeight || side);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((img.naturalWidth || side) * scale));
  canvas.height = Math.max(1, Math.round((img.naturalHeight || side) * scale));
  const ctx = canvas.getContext("2d");

  if (mode === "duotone") {
    drawDuotone(ctx, canvas, img, color);
  } else {
    // Силуэт: рисуем, затем заливаем цветом только там, где уже нарисовано.
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const out = new Image();
  out.src = canvas.toDataURL();
  return out;
}

// Дуотон в три шага:
//   1. рисуем картинку обесцвеченной — остаётся светотень
//   2. умножаем на акцентный цвет: тёмные места остаются тёмными,
//      светлые окрашиваются. Так получаются оттенки одного цвета
//   3. возвращаем прозрачность по исходной картинке — умножение залило
//      бы и пустые места
function drawDuotone(ctx, canvas, img, color) {
  const { width: w, height: h } = canvas;

  if ("filter" in ctx) {
    ctx.filter = "grayscale(1)";
    ctx.drawImage(img, 0, 0, w, h);
    ctx.filter = "none";
  } else {
    // Запасной путь для браузеров без фильтров: считаем яркость вручную.
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      // веса по восприятию глазом: зелёный кажется ярче синего
      const grey = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      px[i] = px[i + 1] = px[i + 2] = grey;
    }
    ctx.putImageData(data, 0, 0);
  }

  // Светлые места окрашиваем, тёмные оставляем тёмными
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);

  // Чуть осветляем, иначе тёмные картинки уходят в почти чёрное
  ctx.globalCompositeOperation = "lighten";
  ctx.fillStyle = withAlpha(color, 0.18);
  ctx.fillRect(0, 0, w, h);

  // Прозрачность берём у исходной картинки
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
}

function withAlpha(hex, alpha) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map(c => parseInt(c, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}



// Анимированные картинки (gif, webp) показываются первым кадром: холст
// забирает кадр в момент отрисовки, и поддерживать движение пришлось бы
// перерисовкой десятки раз в секунду — на десятках частиц это не окупается.
