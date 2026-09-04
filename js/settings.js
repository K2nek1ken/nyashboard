// Настройки живут в localStorage и применяются через data-атрибуты на <html>,
// поэтому CSS может реагировать на них без единой строчки JS в стилях.
const KEY = "nyash_settings";

export const DEFAULTS = {
  theme: "default",
  accent: "pink",        // pink | orange | mint
  particles: "stars",    // stars | flowers | leaves | off
  emoji: "noto",         // noto (CDN, лёгкий) | apple (локальный, 8 МБ) | system
  feedMode: "smart",     // smart = подписки и непросмотренное выше; new = просто по времени
  timeFormat: "relative",// relative = «5 мин назад»; exact = дата и время
  showFriends: "on",     // показывать вкладку «Друзья»
  // порядок вкладок: на телефоне слева направо, на ПК сверху вниз
  tabOrder: ["feed", "chat", "friends", "content", "people"]
};

export const THEMES = {
  default: "Ночная сирень",
  midnight: "Полночь",
  sakura: "Сакура"
};

export const ACCENTS = {
  pink:   "Розовый",
  orange: "Оранжевый",
  mint:   "Пастельно-зелёный"
};

export const PARTICLES = {
  stars:   "Звёздочки",
  flowers: "Цветочки",
  leaves:  "Листики",
  off:     "Без частиц"
};

export const TIME_FORMATS = {
  relative: "Относительное («5 мин назад»)",
  exact:    "Точное (дата и время)"
};

// Ключи должны совпадать с NAV_ITEMS в layout.js
export const TAB_LABELS = {
  feed:    "Лента",
  chat:    "Чат",
  friends: "Друзья",
  content: "Контент",
  people:  "Люди"
};

export const EMOJI_SOURCES = {
  noto:   "Noto (грузится с CDN, лёгкий)",
  apple:  "Apple (локальный файл, +8 МБ)",
  system: "Системные (ничего не грузится)"
};

export function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) }; }
  catch { return { ...DEFAULTS }; }
}

export function setSetting(key, value) {
  const next = { ...getSettings(), [key]: value };
  localStorage.setItem(KEY, JSON.stringify(next));
  applySettings(next);
  return next;
}

// Noto Color Emoji официально раздаётся через Google Fonts — именно то, о чём
// спрашивал Неко. Google сам режет шрифт на подмножества по unicode-range, так
// что браузер тянет только те куски, которые реально нужны странице, и всё это
// кешируется на стороне CDN. Apple-шрифт так раздать нельзя: он проприетарный,
// публичных CDN с ним нет — поэтому он остаётся локальным файлом-опцией.
const NOTO_URL = "https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap";

function ensureNotoLink(enabled) {
  const id = "notoEmojiLink";
  const existing = document.getElementById(id);
  if (!enabled) { existing?.remove(); return; }
  if (existing) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = NOTO_URL;
  document.head.appendChild(link);
}

export function applySettings(settings = getSettings()) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.accent = settings.accent;
  root.dataset.particles = settings.particles;
  root.dataset.emoji = settings.emoji;
  root.dataset.time = settings.timeFormat;
  ensureNotoLink(settings.emoji === "noto");
}
