import { paletteColor } from "./palette.js";
import { ITEMS } from "./modules/accessories.js";

// Украшения вокруг аватарки. Рисуются отдельным слоем поверх картинки, но ПОД
// эмодзи-статусом, чтобы статус оставался читаемым.
//
// Координаты в системе 100×100, где аватарка занимает центральный круг
// радиусом 50. Слой чуть шире картинки и не обрезается, поэтому элементы
// могут заходить за её край.
//
// Цвет задаётся владельцем профиля из общей палитры и не зависит от того,
// какой акцент выбрал смотрящий: украшение должно выглядеть одинаково у всех.
// Наборы разделены: у профилей и каналов свои украшения, и смешивать их
// не стоит — принадлежность к каналу должна читаться с первого взгляда.
// Пометка forChannel означает «только для каналов», её отсутствие — «только
// для людей». Вариант «без украшений» доступен и там, и там.

// Для людей — всё, что не помечено как «только для каналов».
export const ACCESSORIES = Object.fromEntries(
  Object.entries(ITEMS)
    .filter(([, v]) => !v.forChannel || v.forUser)
    .map(([k, v]) => [k, v.label])
);

// Для каналов — только помеченные.
export const CHANNEL_ACCESSORIES = Object.fromEntries(
  Object.entries(ITEMS)
    .filter(([, v]) => v.forChannel)
    .map(([k, v]) => [k, v.label])
);

// Украшение поверх аватарки. Параметр preview — для кнопок выбора:
// там оно должно вписаться в кнопку, а не разложиться вокруг аватарки.
export function accessoryHtml(key, colorKey, preview = false) {
  const item = ITEMS[key];
  if (!item || key === "none") return "";
  const svg = item.svg(paletteColor(colorKey));
  if (!svg) return "";

  // Размеры вписаны прямо в разметку: если стиль почему-то не применился,
  // элемент со стороной ноль просто не был бы виден, и причину искать долго.
  // Из-за этого же они сильнее любого правила снаружи — поэтому для кнопок
  // выбора подставляем свои, а не пытаемся перебить их со стороны.
  const box = preview
    ? "position:absolute;inset:12%;width:76%;height:76%;"
    : "position:absolute;inset:-18%;width:136%;height:136%;";

  // В превью показываем только саму фигуру: украшения нарисованы со сдвигом
  // к краю аватарки, и при полной области они оказывались в углу кнопки.
  const viewBox = preview ? (item.box || "0 0 100 100") : "0 0 100 100";

  return `<svg class="avatar-accessory${preview ? " accessory-preview" : ""}"
    viewBox="${viewBox}" aria-hidden="true"
    style="${box}pointer-events:none;z-index:1;overflow:visible;"
  >${svg}</svg>`;
}
