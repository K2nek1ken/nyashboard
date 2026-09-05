import { paletteColor, lighten } from "./palette.js";

// Украшения вокруг аватарки. Рисуются отдельным слоем поверх картинки, но ПОД
// эмодзи-статусом, чтобы статус оставался читаемым.
//
// Координаты в системе 100×100, где аватарка занимает центральный круг
// радиусом 50. Слой чуть шире картинки и не обрезается, поэтому элементы
// могут заходить за её край.
//
// Цвет задаётся владельцем профиля из общей палитры и не зависит от того,
// какой акцент выбрал смотрящий: украшение должно выглядеть одинаково у всех.
const ITEMS = {
  none: { label: "Без украшений", svg: () => "" },

  // Ободок с ушками: дуга по верхней части аватарки плюс два треугольника.
  // Именно ободок, а не приставленные ушки — так он выглядит как надетая вещь.
  // Ободок с ушками. Разбор эскиза:
  //   • сама дуга лежит ВНУТРИ круга аватарки, а не поверх её края —
  //     получается надетый ободок, а не кольцо вокруг;
  //   • ушки — четырёхугольники (не треугольники), стоят на концах дуги
  //     и торчат наружу вверх, не залезая на лицо.
  // Дуга строится как разность двух окружностей почти одного радиуса,
  // поэтому она тонкая и повторяет изгиб аватарки.
  ears: {
    label: "Ушки",
    svg: (c) => `
      <path d="M14,44 A38,38 0 0 1 86,44" fill="none" stroke="${c}"
            stroke-width="3" stroke-linecap="round"/>
      <polygon points="15.5,41 12,3 34,17 30,33" fill="${c}"/>
      <polygon points="84.5,41 88,3 66,17 70,33" fill="${c}"/>`
  },

  // Цветок сбоку: шесть овальных лепестков и более яркая сердцевина.
  flower: {
    label: "Цветочек",
    svg: (c) => {
      const core = lighten(c, 0.45);
      const petals = [0, 60, 120, 180, 240, 300].map(a =>
        `<ellipse cx="0" cy="-9.5" rx="6" ry="9.5" fill="${c}" transform="rotate(${a})"/>`
      ).join("");
      return `<g transform="translate(81,30)">${petals}<circle cx="0" cy="0" r="5.2" fill="${core}"/></g>`;
    }
  },

  halo: {
    label: "Нимб",
    svg: (c) => `
      <ellipse cx="50" cy="14" rx="26" ry="7.5" fill="none"
               stroke="${c}" stroke-width="4.5"/>`
  }
};

export const ACCESSORIES = Object.fromEntries(
  Object.entries(ITEMS).map(([k, v]) => [k, v.label])
);

export function accessoryHtml(key, colorKey) {
  const item = ITEMS[key];
  if (!item || key === "none") return "";
  const svg = item.svg(paletteColor(colorKey));
  if (!svg) return "";
  return `<svg class="avatar-accessory" viewBox="0 0 100 100" aria-hidden="true">${svg}</svg>`;
}
