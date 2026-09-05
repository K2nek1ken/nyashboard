// Общая палитра оттенков. Одна на всё: рамки аватарок, акценты интерфейса,
// цвет аксессуаров. Готовые цвета вместо ввода кода — так ничего не выглядит
// сломанным: любой оттенок отсюда читается на тёмном фоне и сочетается
// с остальным оформлением.
export const PALETTE = {
  pink:      { label: "Розовый",      color: "#e88fd0", soft: "#a98bf0" },
  rose:      { label: "Пыльная роза", color: "#e78fa4", soft: "#f0aebe" },
  crimson:   { label: "Вишнёвый",     color: "#e05c6e", soft: "#f08a97" },
  orange:    { label: "Оранжевый",    color: "#f5a45c", soft: "#e8865f" },
  amber:     { label: "Янтарный",     color: "#f0c674", soft: "#e8b04b" },
  gold:      { label: "Золото",       color: "#e6cf8b", soft: "#d4b45e" },
  lime:      { label: "Лайм",         color: "#c3e88d", soft: "#a8d672" },
  mint:      { label: "Мятный",       color: "#8fe0b0", soft: "#79c8a8" },
  emerald:   { label: "Изумруд",      color: "#5ec9a0", soft: "#41a884" },
  teal:      { label: "Бирюза",       color: "#6fd3cf", soft: "#4fb3b0" },
  sky:       { label: "Небесный",     color: "#7fc8f0", soft: "#5aa8d8" },
  blue:      { label: "Васильковый",  color: "#7f9cf5", soft: "#6b83d6" },
  indigo:    { label: "Индиго",       color: "#9b8cf0", soft: "#7d6fd4" },
  violet:    { label: "Фиалка",       color: "#b48ce8", soft: "#9a72d0" },
  lavender:  { label: "Лаванда",      color: "#c9b6f5", soft: "#a894e0" },
  plum:      { label: "Слива",        color: "#c986c9", soft: "#a86ba8" },
  peach:     { label: "Персик",       color: "#f2b9a0", soft: "#e09b7e" },
  sand:      { label: "Песок",        color: "#dcc6a8", soft: "#c2a983" },
  silver:    { label: "Серебро",      color: "#c3cad6", soft: "#9aa4b3" },
  slate:     { label: "Графит",       color: "#8d97a8", soft: "#6f7889" }
};

export function paletteColor(key, fallback = "#e88fd0") {
  return PALETTE[key]?.color || fallback;
}

// Список для выпадающих списков и выбора кружочками
export function paletteEntries() {
  return Object.entries(PALETTE).map(([key, v]) => ({ key, ...v }));
}

// Осветление оттенка — нужно для сердцевины цветка: она должна быть ярче
// лепестков, но того же цвета, а не белой.
export function lighten(hex, amount = 0.42) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const mix = (c) => Math.round(parseInt(c, 16) + (255 - parseInt(c, 16)) * amount);
  return "#" + [m[1], m[2], m[3]].map(c => mix(c).toString(16).padStart(2, "0")).join("");
}
