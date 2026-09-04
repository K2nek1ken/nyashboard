// Стандартные аватарки рисуются кодом, а не лежат картинкой, чтобы подхватывать
// цвета текущей темы: розовый котик на оранжевой теме смотрелся чужеродно.
// Результат — data-URI, поэтому его можно подставлять в обычный <img src>.

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

const BUILDERS = { neko: nekoSvg, hidden: hiddenSvg };
const cache = new Map();

export function defaultAvatar(variant = "neko") {
  const theme = readTheme();
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
  document.querySelectorAll('img[data-default-avatar]').forEach(img => {
    img.src = defaultAvatar(img.dataset.defaultAvatar);
  });
}
