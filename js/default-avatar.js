// Стандартные аватарки рисуются кодом, а не лежат картинкой, чтобы подхватывать
// цвета текущей темы: розовый котик на оранжевой теме смотрелся чужеродно.
// Результат — data-URI, поэтому его можно подставлять в обычный <img src>.

// ============================================================
//  Свой оттенок для анонимной аватарки
//
//  Присваивается при первом заходе и хранится отдельно от аккаунта — поэтому
//  переживает и выход, и повторный вход: в общем чате человек остаётся узнаваем
//  по цвету, но связать его с профилем всё так же нечем.
//
//  Тем, кто заходил раньше, оттенок выдаётся при первом появлении этого кода —
//  проверка стоит на чтении, а не только на регистрации.
// ============================================================
const ANON_COLOR_KEY = "nyash_anon_color";

const ANON_PALETTE = [
  "#e88fd0", "#e78fa4", "#f5a45c", "#f0c674", "#c3e88d", "#8fe0b0",
  "#6fd3cf", "#7fc8f0", "#7f9cf5", "#b48ce8", "#c986c9", "#f2b9a0"
];

export function anonColor() {
  let color = localStorage.getItem(ANON_COLOR_KEY);
  if (color && /^#[0-9a-f]{6}$/i.test(color)) return color;
  color = ANON_PALETTE[Math.floor(Math.random() * ANON_PALETTE.length)];
  localStorage.setItem(ANON_COLOR_KEY, color);
  return color;
}

// Светлее основного — чтобы сам силуэт был виден на цветном фоне.
function lightenHex(hex, amount = 0.55) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return "#ffffff";
  const mix = (c) => Math.round(parseInt(c, 16) + (255 - parseInt(c, 16)) * amount);
  return "#" + [m[1], m[2], m[3]].map(c => mix(c).toString(16).padStart(2, "0")).join("");
}

function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
  return {
    accent: pick("--accent", "#e88fd0"),
    light:  pick("--text", "#f1e9f7"),
    dark:   pick("--bg", "#17131c")
  };
}

// Обычный аноним — котик с ушками.
function nekoSvg({ accent, light }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath></defs>
  <circle cx="50" cy="50" r="50" fill="${accent}"/>
  <g clip-path="url(#c)">
    <ellipse cx="50" cy="94" rx="25" ry="42" fill="${light}"/>
    <path d="M68,20 L64.25,40.05 L48.77,26.77 Z" fill="${light}"/>
    <path d="M32,20 L35.75,40.05 L51.23,26.77 Z" fill="${light}"/>
    <circle cx="50" cy="41" r="18" fill="${light}"/>
  </g>
</svg>`;
}

// Скрытый профиль — тот же силуэт, но с закрытыми глазами и ровным ртом:
// сразу читается как «этот человек не показывает себя».
// Круглая маска обязательна, иначе тело и глаза вылезают за пределы круга.
function hiddenSvg({ accent, light, dark }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath>
    <clipPath id="eyeL"><rect x="34" y="30" width="12" height="6"/></clipPath>
    <clipPath id="eyeR"><rect x="54" y="30" width="12" height="6"/></clipPath>
  </defs>
  <circle cx="50" cy="50" r="50" fill="${accent}"/>
  <g clip-path="url(#c)">
    <ellipse cx="50" cy="94" rx="25" ry="42" fill="${light}"/>
    <path d="M68,20 L64.25,40.05 L48.77,26.77 Z" fill="${light}"/>
    <path d="M32,20 L35.75,40.05 L51.23,26.77 Z" fill="${light}"/>
    <circle cx="50" cy="41" r="18" fill="${light}"/>
    <g clip-path="url(#eyeL)"><circle cx="40" cy="30" r="6" fill="${dark}"/></g>
    <g clip-path="url(#eyeR)"><circle cx="60" cy="30" r="6" fill="${dark}"/></g>
    <rect x="45" y="46" width="10" height="3" rx="1.5" fill="${dark}"/>
  </g>
</svg>`;
}

const BUILDERS = { neko: nekoSvg, hidden: hiddenSvg, anon: nekoSvg };
const cache = new Map();

export function defaultAvatar(variant = "neko") {
  const theme = readTheme();
  // Аватарка анонима красится в его личный оттенок, а не в акцент темы:
  // так участники общего чата отличаются друг от друга.
  if (variant === "anon") {
    const base = anonColor();
    theme.accent = base;
    theme.light = lightenHex(base, 0.62);
  }
  const key = `${variant}|${theme.accent}|${theme.light}|${theme.dark}`;
  if (cache.has(key)) return cache.get(key);
  const svg = (BUILDERS[variant] || nekoSvg)(theme);
  const uri = "data:image/svg+xml," + encodeURIComponent(svg.replace(/\s+/g, " "));
  cache.set(key, uri);
  return uri;
}

// Пересобрать уже отрисованные аватарки после смены темы — на месте, без
// перезагрузки страницы.
export function refreshDefaultAvatars() {
  cache.clear();
  // Только те, что мы сами и нарисовали: пометка data-default-avatar стоит
  // исключительно на сгенерированных. Загруженные картинки трогать нельзя,
  // иначе при смене темы своя аватарка подменялась бы анонимной.
  document.querySelectorAll("img[data-default-avatar]").forEach(img => {
    img.src = defaultAvatar(img.dataset.defaultAvatar);
  });
}
