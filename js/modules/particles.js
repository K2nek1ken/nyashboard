// ============================================================
//  Частицы на фоне и узоры на цитатах
//
//  Здесь всё, что падает на фоне и лежит на цитатах: название, символ
//  или своя фигура. Логика — в layout.js и chat.js, сюда она не заглядывает.
//
//  ---- как добавить свою частицу ----
//
//  Простейший случай — символ шрифта:
//
//      снежинка: { label: "Снежинки", glyph: "❄" }
//
//  Текст тоже можно — хоть каомодзи. Только задай масштаб: они в разы
//  шире одного значка и при обычном размере растянутся через пол-экрана.
//
//      лица: { label: "Лица", glyph: "( ͡o ͜ʖ ͡o)", scale: 0.42 }
//
//  Масштаб подбирается на глаз: 1 — как обычный значок, 0.4 — примерно
//  для каомодзи из десятка символов. Чем длиннее текст, тем меньше число.
//
//  Своя фигура — рисуется на холсте:
//
//      треугольник: {
//        label: "Треугольники",
//        draw: (ctx, size) => {
//          ctx.beginPath();
//          ctx.moveTo(0, -size);
//          ctx.lineTo(size, size);
//          ctx.lineTo(-size, size);
//          ctx.closePath();
//          ctx.fill();
//        }
//      }
//
//  Начало координат — центр частицы, поворот и цвет уже применены:
//  рисуй вокруг нуля и не думай про положение на экране.
//  «size» — половина размера этой частицы, они бывают разные.
//
//  ---- узоры на цитатах ----
//
//  Устроены так же, но рисуются не на холсте, а символом в разметке:
//  поэтому там только «glyph». Для фигур есть особый случай «petals» —
//  он рисуется картинкой, это отдельная ветка в chat.js.
//
//  ---- что учесть ----
//
//  Ключ слева — как вариант хранится в настройках. Менять его у уже
//  существующей частицы не стоит: у тех, кто её выбрал, сбросится настройка.
//
//  «custom» и «off» — служебные, их трогать не нужно.
// ============================================================

// Падающие частицы на фоне
export const PARTICLES = {
  stars: {
    label: "Звёздочки",
    // Пятиконечная звезда: рисуется фигурой, а не символом — так она
    // выглядит одинаково в любом шрифте.
    draw: (ctx, size) => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? size : size * 0.45;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  },

  flowers: { label: "Цветочки",        glyph: "\u2740" },   // ❀
  leaves:  { label: "Кленовые листья", glyph: "\uD83C\uDF41" },  // 🍁
  sakura:  { label: "Цветы сакуры",    glyph: "\u273F" },   // ✿

  petals: {
    label: "Лепестки сакуры",
    // Лепесток рисуется картинкой — она собирается в layout.js,
    // потому что должна перекрашиваться под тему.
    image: true
  },

  // Пример текстовой частицы — можно менять или убрать.
  // Масштаб подобран под длину: чем длиннее текст, тем меньше число.
  kaomoji: { label: "Лени фейс", glyph: "( ͡o ͜ʖ ͡o)", scale: 0.42 },

  custom: {
    label: "Своя картинка",
    image: true,
    // Картинку выбирает человек в настройках — см. logo-sound.js
    fromSettings: true
  },

  off: { label: "Без частиц" }
};

// Узор на фоне цитаты в чате
export const QUOTE_DECOR = {
  stars:   { label: "Звёздочки", glyph: "\u2726" },   // ✦
  flowers: { label: "Цветочки",  glyph: "\u2740" },   // ❀
  leaves:  { label: "Листья",    glyph: "\uD83C\uDF41" },
  petals:  { label: "Лепестки",  shape: true },       // рисуется фигурой, см. chat.js
  kaomoji: { label: "Лени фейс", glyph: "( ͡o ͜ʖ ͡o)", scale: 0.42 },
  custom:  { label: "Своя картинка", image: true },
  none:    { label: "Без узора" }
};


// ============================================================
//  Служебное
//
//  Выпадающим спискам в настройках нужны просто подписи, без фигур.
//  Собираем их отсюда, чтобы список вариантов и их описания не
//  расходились: добавил частицу — она появилась в настройках сама.
// ============================================================

export const labelsOf = (dict) =>
  Object.fromEntries(Object.entries(dict).map(([key, item]) => [key, item.label]));

// Как рисовать эту частицу: своей фигурой, символом или картинкой.
export function particleKindOf(key) {
  const item = PARTICLES[key];
  if (!item) return "none";
  if (item.draw) return "shape";
  if (item.image) return "image";
  if (item.glyph) return "glyph";
  return "none";
}

// ============================================================
//  Превью для настроек
//
//  Кнопка рядом со списком показывает, как выглядит выбранное. Собирается
//  из этого же описания, поэтому новая частица появляется в настройках
//  сама — раньше там лежала отдельная копия списка, и добавленное в модуле
//  до настроек не доходило.
//
//  Длинный текст не влезает в маленькую кнопку, поэтому он уменьшается,
//  а если и так не помещается — обрезается многоточием. Лучше показать
//  начало, чем расползшуюся кашу.
// ============================================================

// Сколько знаков влезает в превью при обычном размере.
// Подобрано под кнопку 40 на 40: дальше текст начинает вылезать.
const PREVIEW_FITS = 3;
const PREVIEW_MAX = 10;

export function previewHtml(dict, key) {
  const item = dict[key];
  if (!item) return "\u2014";

  // Своя фигура: рисуем её же на маленьком холсте — превью не может
  // разойтись с тем, что падает на фоне.
  if (item.draw) return `<canvas class="particle-canvas" data-particle="${key}" width="34" height="34"></canvas>`;

  // Картинка из папки проекта
  if (item.preview) return `<img src="${item.preview}" alt="" class="particle-img">`;

  // Лепестки и своя картинка рисуются по-особому — у них своя заготовка
  if (item.image) return `<span class="petal-preview"></span>`;

  if (item.glyph) {
    // Считаем видимые знаки: в каомодзи много надстрочных добавок вроде
    // « ͡ », они ширины почти не занимают, но по счёту идут отдельно —
    // без этого «( ͡o ͜ʖ ͡o)» считался длиннее, чем выглядит.
    const text = [...item.glyph];
    const visible = text.filter(ch => !/[\u0300-\u036f\u0483-\u0489\u20d0-\u20f0]/.test(ch)).length;

    if (visible <= PREVIEW_FITS) return item.glyph;

    // Не влезает — уменьшаем. Коэффициент подобран так, чтобы
    // «( ͡o ͜ʖ ͡o)» читалось целиком.
    if (visible <= PREVIEW_MAX) {
      const scale = Math.max(0.34, PREVIEW_FITS / visible);
      return `<span class="particle-text" style="font-size:${(19 * scale).toFixed(1)}px">${item.glyph}</span>`;
    }

    // Совсем длинный — показываем начало и многоточие: лучше так,
    // чем нечитаемая каша в четыре пикселя.
    const short = text.slice(0, PREVIEW_MAX + 2).join("") + "\u2026";
    return `<span class="particle-text" style="font-size:6.5px" title="${item.glyph}">${short}</span>`;
  }

  return "\u2014";
}

// Дорисовывает фигуры в превью: их нельзя вставить разметкой, они
// рисуются на холсте.
export function paintPreviewCanvases(root = document, color = null) {
  const accent = color || getComputedStyle(document.documentElement)
    .getPropertyValue("--accent").trim() || "#e88fd0";

  root.querySelectorAll("canvas[data-particle]").forEach(canvas => {
    const item = PARTICLES[canvas.dataset.particle] || QUOTE_DECOR[canvas.dataset.particle];
    if (!item?.draw) return;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = accent;
    item.draw(ctx, canvas.width * 0.34);
    ctx.restore();
  });
}
