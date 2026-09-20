// Настройки живут в localStorage и применяются через data-атрибуты на <html>,
// поэтому CSS может реагировать на них без единой строчки JS в стилях.
const KEY = "nyash_settings";

// Справочники живут отдельно — см. data-settings.js. Отсюда их видно так же,
// как раньше, поэтому ничего в остальном проекте менять не пришлось.
export {
  THEMES, GENDERS, TIME_FORMATS, TAB_LABELS, CHAT_IDENTITY, DM_NAMING, TINT_MODES, EMOJI_SOURCES
} from "./modules/settings.js";

// Частицы и узоры — в своём модуле: там можно задать и фигуру, не только
// название. Наружу видны так же, как раньше.
// Наружу отдаём подписи — их ждут выпадающие списки. Сами описания
// с фигурами берутся напрямую из модуля теми, кому они нужны.
import { PARTICLES as PARTICLE_ITEMS, QUOTE_DECOR as DECOR_ITEMS, labelsOf }
  from "./modules/particles.js";

export const PARTICLES = labelsOf(PARTICLE_ITEMS);
export const QUOTE_DECOR = labelsOf(DECOR_ITEMS);

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
  dmCustomName: "",      // своё слово для собеседника, если выбран этот способ
  logoSound: "",         // имя выбранного звука; сам файл лежит отдельно
  quoteDecor: "flowers", // узор на фоне цитаты в чате
  chatIdentity: "both",  // both | anon | account — что доступно в чате
  meowReaction: "on",
  botNameLinks: "on",
  publicBalance: "on",       // показывать остаток в общем чате        // имена в сообщениях бота — ссылками на профиль
  commandPrefix: "",        // свой знак перед командами бота, например «!»
  blockedCommands: "",       // команды бота, отключённые в этом чате
  rouletteConfetti: "on",    // конфетти при выигрыше в рулетке    // отзываться на команду «мяукнуть» звуком
  webNotify: "off",      // уведомления браузера, пока вкладка открыта
  particleTint: "silhouette",  // off | silhouette | duotone — как красить частицы
  quoteTint: "silhouette",     // то же для узора на цитатах
  hourlyDigest: "on",    // сводка о лайках раз в час
  dmNaming: "nickname",  // как подписывать собеседника в личке
  timeFormat: "relative",// relative = «5 мин назад»; exact = дата и время
  showFriends: "on",     // показывать вкладку «Друзья»
  // порядок вкладок: на телефоне слева направо, на ПК сверху вниз
  showAbout: "on",       // вкладка «Возможности»
  tabOrder: ["feed", "chat", "friends", "content", "people", "about"]
};

// Акценты — та же палитра, что у рамок аватарок: один список оттенков на всё
// оформление, чтобы цвета сайта и профиля были из одного набора.
export { PALETTE as ACCENT_PALETTE } from "./palette.js";

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
  let text;
  try {
    text = await file.text();
  } catch (e) {
    // Чаще всего это файл на подключённом телефоне или сетевом диске: там
    // доступ идёт по особому протоколу, и браузер прочитать содержимое не
    // может, хотя выбрать файл даёт. Лечится копированием на сам компьютер.
    throw new Error("файл не читается — скопируй его на компьютер и выбери оттуда");
  }
  if (!text) {
    throw new Error("файл пустой или недоступен — скопируй его на компьютер");
  }

  let parsed;
  try {
    // Убираем метку кодировки в начале файла: некоторые редакторы её
    // дописывают, и разбор из-за одного невидимого символа падал.
    parsed = JSON.parse(text.replace(/^\uFEFF/, "").trim());
  } catch {
    throw new Error("это не файл настроек");
  }

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
