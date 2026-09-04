// Настройки живут в localStorage и применяются через data-атрибуты на <html>,
// поэтому CSS может реагировать на них без единой строчки JS в стилях.
const KEY = "nyash_settings";

export const DEFAULTS = {
  theme: "default",
  accent: "pink",        // pink | orange | mint
  particles: "stars",    // stars | flowers | leaves | off
  emoji: "noto",         // noto (CDN, лёгкий) | apple (локальный, 8 МБ) | system
  feedMode: "smart",     // smart = подписки и непросмотренное выше; new = просто по времени
  recommendations: "on", // учитывать похожесть на лайкнутое
  gender: "x",           // m | f | x — для родовых окончаний в интерфейсе
  timezone: "auto",      // auto = как на устройстве, иначе смещение вида "+03:00"
  logoMessage: "мяу!",   // что говорит логотип, если по нему нажать
  logoSound: "",         // имя выбранного звука; сам файл лежит отдельно
  quoteDecor: "flowers", // узор на фоне цитаты в чате
  timeFormat: "relative",// relative = «5 мин назад»; exact = дата и время
  showFriends: "on",     // показывать вкладку «Друзья»
  // порядок вкладок: на телефоне слева направо, на ПК сверху вниз
  showAbout: "on",       // вкладка «Возможности»
  tabOrder: ["feed", "chat", "friends", "content", "people", "about"]
};

export const THEMES = {
  default: "Ночная сирень",
  midnight: "Полночь",
  sakura: "Сакура",
  quiet: "Ночная тишь"
};

// Символы для фона цитаты в чате — та же логика, что и у частиц фона
export const QUOTE_DECOR = {
  flowers: "Цветочки",
  petals:  "Лепестки",
  stars:   "Звёздочки",
  leaves:  "Листья",
  none:    "Без узора"
};

export const ACCENTS = {
  pink:   "Розовый",
  orange: "Оранжевый",
  mint:   "Пастельно-зелёный"
};

export const PARTICLES = {
  stars:   "Звёздочки",
  flowers: "Цветочки",
  leaves:  "Кленовые листья",
  sakura:  "Цветы сакуры",
  petals:  "Лепестки сакуры",
  off:     "Без частиц"
};

export const GENDERS = {
  m: "Мужской",
  f: "Женский",
  x: "Не указывать"
};

// Список смещений вместо справочника городов: короче, понятнее и не требует
// тащить базу часовых поясов ради одной строчки настроек.
export const TIMEZONES = (() => {
  const list = { auto: "Как на устройстве" };
  const halves = { "-9.5": 1, "-3.5": 1, "3.5": 1, "4.5": 1, "5.5": 1, "5.75": 1, "6.5": 1, "8.75": 1, "9.5": 1, "10.5": 1, "12.75": 1 };
  const offsets = [];
  for (let h = -12; h <= 14; h++) {
    offsets.push(h);
    if (halves[String(h + 0.5)]) offsets.push(h + 0.5);
    if (halves[String(h + 0.75)]) offsets.push(h + 0.75);
  }
  for (const o of offsets.sort((a, b) => a - b)) {
    const sign = o < 0 ? "-" : "+";
    const abs = Math.abs(o);
    const hh = String(Math.floor(abs)).padStart(2, "0");
    const mm = String(Math.round((abs % 1) * 60)).padStart(2, "0");
    const key = `${sign}${hh}:${mm}`;
    list[key] = `UTC${key}`;
  }
  return list;
})();

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
  people:  "Люди",
  about:   "Возможности"
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
  root.dataset.tz = settings.timezone;
  ensureNotoLink(settings.emoji === "noto");
}


// ============================================================
//  Сохранение и восстановление настроек
//
//  Настройки отвечают за внешний вид и удобство, а не за данные аккаунта,
//  поэтому в базе им делать нечего. Зато перенести подобранное оформление
//  на другое устройство — как раз то, ради чего стоит держать файл.
// ============================================================
export function exportSettings() {
  const data = {
    kind: "nyashboard-settings",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getSettings()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nyashboard-настройки-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Принимаем только известные ключи: чужой или битый файл не должен занести
// в настройки мусор, из-за которого потом ничего не открывается.
export async function importSettings(file) {
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("это не файл настроек"); }

  const incoming = parsed?.settings || parsed;
  if (!incoming || typeof incoming !== "object") throw new Error("в файле нет настроек");

  const clean = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (incoming[key] === undefined) continue;
    // порядок вкладок — массив, остальное простые значения
    if (key === "tabOrder") {
      if (Array.isArray(incoming[key])) clean[key] = incoming[key].filter(k => typeof k === "string");
    } else if (typeof incoming[key] === typeof DEFAULTS[key]) {
      clean[key] = incoming[key];
    }
  }
  if (!Object.keys(clean).length) throw new Error("не нашла знакомых настроек");

  const next = { ...getSettings(), ...clean };
  localStorage.setItem(KEY, JSON.stringify(next));
  applySettings(next);
  return Object.keys(clean).length;
}
