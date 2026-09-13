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

// Мордочка бота по эскизу Неко: крупный силуэт снизу, ушки-треугольники,
// глаза. Отличается от обычной анонимной пропорциями, поэтому узнаётся сразу.
function botSvg() {
  // Эскиз Неко без изменений: чёрно-белая мордочка, рожки и глаза-искры.
  // Цвета не подстраиваются под тему — бот должен узнаваться сразу,
  // как бы ни было раскрашено всё вокруг.
  //
  // В теме «Абсолютное ничего» рожки красные — отсылка, ради которой
  // тема и появилась.
  const nothing = document.documentElement.dataset.theme === "nothing";
  const horns = nothing ? "#ad2831" : "#ffffff";

  const horn = "586.08,439.64 480.39,433.72 478.12,523.45 670.24,635.42";
  // глаз — четырёхлучевая искра, повёрнутая на 45 градусов
  const eye = "M454.03 663.92 L488.42 577.95 L454.03 491.98 L540 526.37 "
            + "L625.97 491.98 L591.58 577.95 L625.97 663.92 L540 629.53 "
            + "L454.03 663.92 Z";
  const turn = "0.707106781186547,0.707106781186547,-0.707106781186547,0.707106781186547";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080">
  <ellipse cx="540" cy="540" rx="536.07" ry="536.07" fill="#000000"/>
  <polygon points="${horn}" fill="${horns}"
           transform="matrix(-0.6,-0.8,0.8,-0.6,688.4,1265.2)"/>
  <polygon points="${horn}" fill="${horns}"
           transform="matrix(0.6,-0.8,-0.8,-0.6,390.4,1265.2)"/>
  <ellipse cx="540" cy="1051.53" rx="449.09" ry="449.09" fill="#ffffff"/>
  <path d="${eye}" fill="#000000" transform="matrix(${turn},741.036756446092,27.9296007812643)"/>
  <path d="${eye}" fill="#000000" transform="matrix(${turn},391.468279999276,27.9296007812643)"/>
</svg>`;
}

const BUILDERS = { neko: nekoSvg, hidden: hiddenSvg, anon: nekoSvg, bot: botSvg };
const cache = new Map();

export function defaultAvatar(variant = "neko", seed = null) {
  const theme = readTheme();
  // Аватарка анонима красится в его личный оттенок, а не в акцент темы:
  // так участники общего чата отличаются друг от друга.
  if (variant === "anon") {
    // Свой оттенок, если он задан: так старые сообщения тоже раскрашиваются,
    // и один и тот же человек всегда одного цвета.
    const base = seed ? anonColorFor(seed) : anonColor();
    theme.accent = base;
    theme.light = lightenHex(base, 0.62);
  }
  const key = `${variant}|${seed || ""}|${theme.accent}|${theme.light}|${theme.dark}|${document.documentElement.dataset.theme || ""}`;
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


// ============================================================
//  Обложка по умолчанию для трека
//
//  У треков без обложки её просто не было — и нажимать было не на что.
//  Рисуем ноту на цветном фоне, а цвет выбираем по идентификатору трека:
//  так у каждого он свой, но всегда один и тот же, а не случайный при
//  каждой отрисовке.
// ============================================================
const COVER_PALETTE = [
  ["#e88fd0", "#a98bf0"], ["#f5a45c", "#e8865f"], ["#8fe0b0", "#5ec9a0"],
  ["#7fc8f0", "#7f9cf5"], ["#b48ce8", "#c986c9"], ["#f0c674", "#e6cf8b"],
  ["#6fd3cf", "#4fb3b0"], ["#f2b9a0", "#e78fa4"]
];

export function defaultCover(seed = "") {
  // Цвет по идентификатору трека: у каждого свой, но всегда один и тот же.
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const [tint] = COVER_PALETTE[hash % COVER_PALETTE.length];

  // Эскиз Неко без изменений: тёмный фон, силуэт и нота. Меняется только
  // цвет светлых частей — чтобы обложки не были одинаковыми.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080">
    <rect x="-3.42" y="-3.42" width="1086.84" height="1086.84" fill="#17131c"/>
    <ellipse transform="matrix(0.9982692,0.0588099,-0.0588099,0.9982692,531.6587,1217.4765)"
             cx="0" cy="0" rx="520.57" ry="520.57" fill="${tint}"/>
    <polygon transform="matrix(0.9035287,0.4285275,-0.4285275,0.9035287,607.0199,13.5111)"
             points="284.41,796.69 540,353.99 795.59,796.69" fill="${tint}"/>
    <polygon transform="matrix(-0.947595,0.3194743,0.3194743,0.9475950,546.6423,28.9278)"
             points="284.41,796.69 540,353.99 795.59,796.69" fill="${tint}"/>
    <ellipse transform="matrix(0.9982692,0.0588099,-0.0588099,0.9982692,302.4332,927.0722)"
             cx="0" cy="0" rx="86.44" ry="86.44" fill="#17131c"/>
    <ellipse transform="matrix(0.9982692,0.0588099,-0.0588099,0.9982692,707.412,950.9303)"
             cx="0" cy="0" rx="86.44" ry="86.44" fill="#17131c"/>
    <rect x="847.66" y="186.57" width="101.64" height="46.54" fill="${tint}"/>
    <rect transform="matrix(0,-1,1,0,870.9349,298.7300)"
          x="-112.16" y="-23.27" width="224.33" height="46.54" fill="${tint}"/>
    <ellipse cx="820.2" cy="410.89" rx="73.47" ry="73.47" fill="${tint}"/>
  </svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg.replace(/\s+/g, " "));
}

// Оттенок анонима можно задать извне: у старых сообщений он берётся по имени
// автора, чтобы один и тот же человек всегда был одного цвета.
export function anonColorFor(seed) {
  if (!seed) return anonColor();
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return ANON_PALETTE[hash % ANON_PALETTE.length];
}
