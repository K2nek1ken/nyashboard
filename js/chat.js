import {
  db, auth, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDocs,
  query, orderBy, limit, startAfter, onSnapshot, serverTimestamp
} from "./firebase.js";
import { getGuestIdentity, setGuestNickname, syncChatNickname } from "./identity.js";
import { getSettings } from "./settings.js";
import { QUOTE_DECOR as DECOR_ITEMS } from "./modules/particles.js";
import { parseCommand } from "./bot.js";
import { currentUser, currentUserDoc, authReady } from "./auth.js";
import { getUserDoc } from "./data.js";
import { relationBadge, badgeHtml, nameHtml } from "./person.js";
import { avatarHtml } from "./avatar.js";
import { CHANNEL_COLOR, paletteColor } from "./palette.js";
import { loadFriends } from "./friends.js";
import { openPersonPreview } from "./person-preview.js";
import { initChatNav, trackMentions } from "./chat-nav.js";
import { notify } from "./web-notify.js";
import { registerMessageNuid, resolveNuid } from "./nuid.js";
import { wireImageZoom } from "./lightbox.js";
import { imagesToHtml, wireCarousels } from "./carousel.js";
import { askText, askConfirm } from "./dialog.js";
import { uploadImages } from "./storage.js";
import { showToast, escapeHtml, timeAgo } from "./ui.js";
import { ICON } from "./icons.js";
import { markOwned, isOwned } from "./ownership.js";
import { linkifyMentions, wireMentions } from "./mentions.js";
import { kebabHtml, wireKebab } from "./kebab.js";
import { openEmojiPicker } from "./emoji.js";

// Ссылки на элементы обновляются при каждом запуске страницы: переход между
// вкладками заменяет разметку, а взятые один раз ссылки после этого указывают
// на элементы, которых больше нет в документе.
let messagesEl = null;
let nickLabel = null;

function grabElements() {
  // Убираем задвоившуюся разметку, если она есть.
  //
  // При переходах между вкладками закреплённые части страницы переносятся
  // заново, и от прошлого захода может остаться копия. Тогда getElementById
  // отдаёт первую — а видно на экране последнюю: сообщения приходили,
  // рисовались в невидимую копию, и чат навсегда оставался с надписью
  // «загружаю».
  dropDuplicates("chatMessages");
  dropDuplicates("chatForm");
  dropDuplicates("chatNickLabel");
  dropDuplicates("botHelpBtn");

  const bars = document.querySelectorAll(".chat-floating-bar");
  for (let i = 0; i < bars.length - 1; i++) bars[i].remove();

  messagesEl = document.getElementById("chatMessages");
  nickLabel = document.getElementById("chatNickLabel");
}

// Оставляет последний элемент с таким идентификатором: он и есть настоящий,
// перенесённый вместе с текущей страницей.
function dropDuplicates(id) {
  const all = document.querySelectorAll(`[id="${id}"]`);
  for (let i = 0; i < all.length - 1; i++) all[i].remove();
}
let chatUnsub = null;
let pendingChatImages = [];

// Сколько сообщений показываем сразу и сколько добавляем за одну подгрузку
// На широком экране десять сообщений умещаются целиком, прокручивать нечего —
// и подгрузка истории просто не запускалась. Поэтому там берём больше сразу.
const PAGE_SIZE = window.matchMedia("(min-width: 900px)").matches ? 30 : 10;
let olderMessages = [];   // подгруженная история, старше живой подписки
let oldestDoc = null;     // граница, от которой продолжаем читать
let loadingOlder = false;

// Подгрузка истории при прокрутке к началу переписки.
function wireHistoryLoader() {
  window.addEventListener("scroll", async () => {
    if (loadingOlder || window.scrollY > 120 || !oldestDoc) return;
    loadingOlder = true;

    // Пока история едет, показываем на её месте пустые заготовки.
    // Так видно, что она грузится, и страница не прыгает: место под
    // сообщения занято заранее.
    showSkeletons(messagesEl);

    const heightBefore = document.body.scrollHeight;
    try {
      const older = await loadOlderMessages();
      hideSkeletons(messagesEl);

      if (older.length) {
        olderMessages = [...older, ...olderMessages];
        lastMessages = [...older, ...lastMessages];
        renderChat(lastMessages, { keepScroll: true });
        // сохраняем положение: иначе добавленные сверху сообщения
        // «выталкивают» переписку из виду
        window.scrollTo({ top: document.body.scrollHeight - heightBefore + window.scrollY });
      }
    } catch (e) {
      hideSkeletons(messagesEl);
      console.warn("История не догрузилась:", e.message);
    } finally {
      loadingOlder = false;
    }
  }, { passive: true });
}

async function loadOlderMessages() {
  const q = query(collection(db, "chatMessages"),
                  orderBy("createdAt", "desc"),
                  startAfter(oldestDoc),
                  limit(PAGE_SIZE));
  const snap = await getDocs(q);
  if (snap.empty) { oldestDoc = null; return []; }   // дошли до начала переписки
  oldestDoc = snap.docs[snap.docs.length - 1];
  return sortByTime(snap.docs.map(d => ({ id: d.id, ...d.data() })));
}
let replyingTo = null;   // { id, nickname, text }
let lastMessages = [];

export function subscribeChat() {
  grabElements();
  if (!messagesEl) return;
  nickLabel.textContent = getGuestIdentity().nickname;
  // подтягиваем ник из аккаунта: локальный мог слететь или отличаться
  syncChatNickname()
    .then(n => { if (n) nickLabel.textContent = n; })
    .catch(e => console.warn("Ник не подтянулся:", e.message));
  // Подписка переживает переход между вкладками, а разметка — нет.
  // Поэтому при возврате в чат рисуем накопленное сразу: сама подписка
  // пришлёт что-то только когда придёт новое сообщение, а до тех пор
  // экран оставался пустым.
  if (chatUnsub) {
    if (lastMessages.length) renderChat(lastMessages);
    initChatNav(messagesEl);
    applyMute();
    return;
  }
  // Живая подписка только на последние сообщения: грузить всю переписку разом
  // и долго, и дорого по обращениям к базе. Остальное подтягивается порциями
  // при прокрутке вверх.
  const q = query(collection(db, "chatMessages"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
  chatUnsub = onSnapshot(q, (snap) => {
    const fresh = sortByTime(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    oldestDoc = snap.docs[snap.docs.length - 1] || oldestDoc;
    // склеиваем с ранее подгруженной историей, без повторов
    const seenIds = new Set(fresh.map(m => m.id));
    lastMessages = [...olderMessages.filter(m => !seenIds.has(m.id)), ...fresh];
    // Рисуем сразу, не дожидаясь ничего постороннего. Раньше отрисовка
    // шла после загрузки меток, и если та подвисала — чат навсегда
    // оставался с надписью «загружаю».
    renderChat(lastMessages);

    // Метки — украшение: приходят следом и обновляют уже показанное.
    refreshBadges(lastMessages)
      .catch(e => console.warn("Метки собеседников:", e.message))
      .then(() => {
      renderChat(lastMessages);
      reactToMeow(fresh);

      // Что считать «моим»: сообщения, отправленные с этого устройства, плюс
      // все от моего аккаунта — упоминание может прийти на любое из них.
      const mine = new Set(lastMessages
        .filter(m => isOwned("chatMessage", m.id) || (currentUser && m.authorUid === currentUser.uid))
        .map(m => m.id));
      // Уведомление о чужих сообщениях, пока вкладка в фоне
      const others = fresh.filter(m => !m.isBot && !isOwned("chatMessage", m.id));
      if (others.length) {
        const last = others[others.length - 1];
        // Одна метка на весь чат: новое уведомление заменяет прошлое,
        // а не копит их стопкой.
        notify(
          others.length === 1 ? "Новое в чате" : `Новое в чате (${others.length})`,
          `${last.nickname}: ${(last.text || "фото").slice(0, 80)}`,
          { tag: "nyash-chat" }
        );
      }

      trackMentions(fresh, {
        myUsername: currentUserDoc?.username || null,
        myMessageIds: mine
      });
    });
  }, (err) => {
    console.error(err);
    messagesEl.innerHTML = `<div class="stub-note">Не смогла загрузить чат: ${err.message}</div>`;
  });

  // Если за несколько секунд ничего не пришло — скажем об этом. Пустой
  // экран без объяснений выглядит как поломка, хотя причина может быть
  // в связи или в правилах базы.
  // Заглушка только если рисовать пока нечего: иначе она затирала
  // уже показанные сообщения.
  if (!messagesEl.children.length) {
    messagesEl.innerHTML = `<div class="stub-note">Загружаю чат…</div>`;
  }
  setTimeout(() => {
    if (!lastMessages.length && messagesEl.textContent.includes("Загружаю")) {
      messagesEl.innerHTML = `<div class="stub-note">
        Чат не загрузился. Проверь связь и правила базы — сообщения читает
        коллекция chatMessages.
      </div>`;
    }
  }, 6000);

  // Картинка для узора готовится заранее: перекрашивание идёт на холсте,
  // и делать его для каждой цитаты было бы расточительно. Когда готова —
  // перерисовываем, иначе цитаты, нарисованные раньше, остались бы без узора.
  applyMute();

  // Свои команды: загружаются один раз при открытии чата, дальше разбор
  // работает с ними наравне со встроенными.
  import("./custom-commands.js").then(async (cc) => {
    const { setCustomRules } = await import("./bot.js");
    setCustomRules(cc.asRules(await cc.loadCustomCommands()));
  }).catch(e => console.warn("Свои команды не загрузились:", e.message));

  prepareQuoteImage()
    .then(() => { if (lastMessages.length) renderChat(lastMessages, { keepScroll: true }); })
    .catch(e => console.warn("Узор для цитат:", e.message));

  wireHistoryLoader();

  // Возврат в браузер иногда оставляет экранную клавиатуру открытой, а поле
  // ввода при этом уже не в фокусе — получается полэкрана занято впустую.
  // Снимаем фокус при уходе со страницы: тогда клавиатура закрывается сама.
  const blurInput = () => {
    if (document.hidden) document.activeElement?.blur?.();
  };
  document.addEventListener("visibilitychange", blurInput);
  window.addEventListener("pagehide", blurInput);
  initChatNav(messagesEl);
  keepInputClearance();
  openLinkedMessage();
}

// Узор на фоне цитаты. Символ выбирается в настройках — та же логика, что и у
// частиц фона. Позиция, поворот и размер у каждого свои, а сетка с разбросом
// не даёт им наложиться друг на друга.
// Лепесток — не символ, а настоящая форма из assets/petal.svg. Он подставляется
// маской, поэтому красится текущим акцентом так же, как обычные символы.
// Остальное — обычные глифы.


// Своя картинка для узора: подготавливается один раз и дальше берётся готовой.
// Подготовка нужна потому, что картинку надо перекрасить, а это делается
// на холсте — каждый раз для каждой цитаты было бы расточительно.
let quoteImageUrl = null;

export async function prepareQuoteImage() {
  if (getSettings().quoteDecor !== "custom") { quoteImageUrl = null; return; }

  try {
    const { getQuoteImage } = await import("./logo-sound.js");
    const rec = await getQuoteImage();
    if (!rec?.blob) { quoteImageUrl = null; return; }

    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent").trim() || "#e88fd0";
    const mode = getSettings().quoteTint || "silhouette";

    const img = new Image();
    img.src = URL.createObjectURL(rec.blob);
    await img.decode().catch(() => {});

    const { tintImage } = await import("./tint.js");

    // Один путь для любых картинок, включая гифки: берётся первый кадр.
    // Прежняя попытка сохранить анимацию через маски и фильтры не работала
    // и вдобавок ломала показ — узор просто не появлялся.
    quoteImageUrl = tintImage(img, accent, mode).src;
  } catch (e) {
    console.warn("Картинка для цитат не подготовилась:", e.message);
    quoteImageUrl = null;
  }
}

// Узор одинаков для одной цитаты: он собирается из случайных смещений,
// и при каждой отрисовке получался новый — фон менялся на глазах при
// отправке или удалении соседнего сообщения.
const decorCache = new Map();

function decorHtml(seed = null) {
  if (seed !== null && decorCache.has(seed)) return decorCache.get(seed);
  const html = buildDecor(seed);
  if (seed !== null) decorCache.set(seed, html);
  return html;
}

function buildDecor(seed = null) {
  const kind = getSettings().quoteDecor || "flowers";
  const isShape = !!DECOR_ITEMS[kind]?.shape;
  const isImage = !!DECOR_ITEMS[kind]?.image;
  const glyph = DECOR_ITEMS[kind]?.glyph;
  if (!glyph && !isShape && !isImage) return "";        // выбран вариант «без узора»
  // Пока своя картинка не готова, рисуем цветочки: пустая цитата выглядит
  // как поломка, а так узор просто сменится, когда картинка подгрузится.
  const fallbackGlyph = isImage && !quoteImageUrl ? DECOR_ITEMS.flowers?.glyph : null;

  // Цитата стала выше, поэтому узоров больше и лежат они свободнее:
  // прежняя сетка рассчитывалась на полоску в пару строк.
  // Для картинок сетка реже: они плотнее символов и при частом шаге
  // накладываются друг на друга.
  const isImageDecor = getSettings().quoteDecor === "custom";
  const cols = isImageDecor ? 5 : 7;
  const rows = 2;

  // Расположение зависит от сообщения, а не от случая: одна и та же цитата
  // всегда выглядит одинаково, даже если список перерисовали.
  let state = 0;
  for (let i = 0; i < String(seed ?? "").length; i++) {
    state = (state * 31 + String(seed).charCodeAt(i)) >>> 0;
  }
  const rnd = () => {
    if (seed === null) return rnd();
    state = (state * 1103515245 + 12345) >>> 0;
    return (state % 10000) / 10000;
  };
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rnd() < 0.18) continue;    // местами пропускаем — живее
      const x = (c + 0.5) / cols * 100 + (rnd() - 0.5) * 9;
      const y = (r + 0.5) / rows * 100 + (rnd() - 0.5) * 30;
      const rot = Math.floor(rnd() * 360);
      const scale = (0.6 + rnd() * 0.8).toFixed(2);
      const style = `left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;` +
                    `transform:translate(-50%,-50%) rotate(${rot}deg) scale(${scale})`;
      out.push(fallbackGlyph
        ? `<span style="${style}">${fallbackGlyph}</span>`
        : isImage
        ? `<img class="quote-image" src="${quoteImageUrl}" style="${style}" alt="">`
        : isShape
        ? `<span class="petal-shape" style="${style}"></span>`
        : `<span style="${style}">${glyph}</span>`);
    }
  }
  return out.join("");
}

function quoteHtml(m) {
  if (!m.replyToId) return "";
  const text = m.replyToText || "(сообщение удалено)";
  return `
    <div class="chat-reply-quote" data-jump="${m.replyToId}">
      <span class="petals">${decorHtml(m.replyToId || m.id)}</span>
      <b>${escapeHtml(m.replyToNickname || "???")}</b>
      <span class="quote-text">${escapeHtml(text.slice(0, 90))}${text.length > 90 ? "…" : ""}</span>
    </div>`;
}

// Копирование в буфер. Современный способ доступен не везде (нужен защищённый
// протокол), поэтому оставлен и старый — иначе на части устройств кнопка бы
// молча ничего не делала.
async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(okMessage);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0;";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    showToast(ok ? okMessage : "Не вышло скопировать: " + text);
  }
}

// Пять фотографий на сообщение: больше — это уже поток загрузок на бесплатном
// хранилище. Старые сообщения хранят одну картинку в imageUrl, поэтому
// приводим оба вида к одному списку.
const MAX_CHAT_IMAGES = 5;

function chatImages(m) {
  if (m.imageUrls?.length) return m.imageUrls;
  if (m.imageUrl) return [m.imageUrl];
  return [];
}

let badges = new Map();
let meowSeen = new Set();   // чтобы не мяукать повторно на те же сообщения
let chatStarted = false;

// Кто-то написал «мяукнуть» — отзываемся звуком и подсказкой. Отключается
// в настройках. При первом открытии чата молчим: иначе вся история за день
// разом устроила бы кошачий концерт.
function reactToMeow(msgs) {
  if (!chatStarted) { msgs.forEach(m => meowSeen.add(m.id)); chatStarted = true; return; }
  if (getSettings().meowReaction === "off") return;

  const fresh = msgs.filter(m => !meowSeen.has(m.id));
  fresh.forEach(m => meowSeen.add(m.id));
  const meowed = fresh.some(m => m.isBot && /мяукнул/i.test(m.text || ""));
  if (!meowed) return;

  playMeow();
}

// Упомянутый в сообщении трек показываем проигрывателем — так же, как в ленте.
async function renderChatTracks(container, msgs) {
  const withTracks = msgs.filter(m => /#U3\d{6}/i.test(m.text || ""));
  if (!withTracks.length) return;

  try {
    const { resolveNuid } = await import("./nuid.js");
    const { getTrack } = await import("./music.js");
    const { trackCardHtml, wireTrackCards } = await import("./music-ui.js");

    for (const m of withTracks) {
      const row = container.querySelector(`.chat-msg[data-id="${m.id}"] .txt`);
      if (!row || row.dataset.tracksDone) continue;
      row.dataset.tracksDone = "1";

      const ids = [...new Set((m.text.match(/#U3\d{6}/gi) || []))].map(t => t.slice(1).toUpperCase());
      const tracks = [];
      for (const nuid of ids.slice(0, 2)) {
        // Берём из памяти, если уже загружали: иначе каждое новое сообщение
        // в чате перезапрашивало все прикреплённые треки заново.
        let track = chatAttachCache.get(nuid);
        if (track === undefined) {
          const hit = await resolveNuid(nuid);
          track = hit?.type === "track" ? await getTrack(hit.uid) : null;
          chatAttachCache.set(nuid, track);
        }
        if (track) tracks.push(track);
      }
      if (!tracks.length) continue;

      // из текста идентификатор убираем — он написан на карточке
      row.innerHTML = linkifyMentions(escapeHtml(m.text.replace(/\s*#U3\d{6}/gi, "").trim()));
      const host = document.createElement("div");
      host.className = "chat-tracks";
      host.innerHTML = tracks.map(t => trackCardHtml(t)).join("");
      row.after(host);
      wireTrackCards(host, tracks);
    }
  } catch (e) {
    console.warn("Треки в чате не загрузились:", e.message);
  }
}

// Панель ввода бывает разной высоты: появляется цитата, миниатюры фото,
// выбор личности. Отступ снизу подгоняем под её настоящий размер, иначе
// последние сообщения то прячутся под ней, то висит лишняя пустота.
function keepInputClearance() {
  const bar = document.querySelector(".chat-floating-bar");
  if (!bar || !messagesEl) return;

  const apply = () => {
    messagesEl.style.paddingBottom = (bar.offsetHeight + 24) + "px";
  };
  apply();

  if ("ResizeObserver" in window) {
    new ResizeObserver(apply).observe(bar);
  } else {
    window.addEventListener("resize", apply);
  }
}

// Работы из «Творчества», упомянутые номером — картинкой под сообщением.
// Загруженные работы и треки держим в памяти: разметка чата пересоздаётся
// при каждом новом сообщении, и без этого всё прикреплённое перезапрашивалось
// заново — успевало мигнуть и «станцевать».
const chatAttachCache = new Map();

async function renderChatArtworks(container, msgs) {
  const withArt = msgs.filter(m => /#U5\d{6}/i.test(m.text || ""));
  if (!withArt.length) return;

  try {
    const { resolveNuid } = await import("./nuid.js");
    const { getArtwork } = await import("./art.js");
    const { openLightbox } = await import("./lightbox.js");

    for (const m of withArt) {
      const row = container.querySelector(`.chat-msg[data-id="${m.id}"] .txt`);
      if (!row || row.dataset.artDone) continue;
      row.dataset.artDone = "1";

      const ids = [...new Set((m.text.match(/#U5\d{6}/gi) || []))]
        .map(t => t.slice(1).toUpperCase()).slice(0, 2);
      const works = [];
      for (const nuid of ids) {
        let art = chatAttachCache.get(nuid);
        if (art === undefined) {
          const hit = await resolveNuid(nuid);
          art = hit?.type === "art" ? await getArtwork(hit.uid) : null;
          chatAttachCache.set(nuid, art);
        }
        if (art) works.push(art);
      }
      if (!works.length) continue;

      const host = document.createElement("div");
      host.className = "post-artworks";
      host.innerHTML = works.map(a => `
        <div class="art-attached">
          <img src="${a.imageUrl}" alt="${escapeHtml(a.title)}" loading="lazy">
          <div class="art-attached-body">
            <div class="art-attached-title">${escapeHtml(a.title)}</div>
            ${a.description ? `<div class="art-desc">${escapeHtml(a.description)}</div>` : ""}
          </div>
        </div>`).join("");
      row.after(host);

      host.querySelectorAll("img").forEach((img, i) => {
        img.addEventListener("click", () => openLightbox(img.src, works.map(w => w.imageUrl), i));
      });
    }
  } catch (e) {
    console.warn("Работы в чате не загрузились:", e.message);
  }
}

// Молчание после проигрыша в рулетке. Держится в этом браузере: обойти
// можно, но это игра, а не наказание — важна сама механика.
function muteSelf(seconds) {
  const until = Date.now() + seconds * 1000;
  try { localStorage.setItem("nyash_mute_until", String(until)); } catch {}
  applyMute();
}

function applyMute() {
  let until = 0;
  try { until = Number(localStorage.getItem("nyash_mute_until")) || 0; } catch {}

  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatInput");
  const left = until - Date.now();

  if (left <= 0) {
    input?.removeAttribute("disabled");
    if (input) input.placeholder = "Сообщение...";
    return;
  }

  if (input) {
    input.setAttribute("disabled", "disabled");
    input.placeholder = `Молчание ещё ${Math.ceil(left / 1000)} с`;
  }
  setTimeout(applyMute, 1000);
}

// Добавление и удаление своих команд. Возвращает сообщение для человека,
// если это была такая строка, и ничего — если обычное сообщение.
async function handleCustomCommand(text) {
  // Граница слова здесь не годится: она считает границей только латиницу
  // и цифры, а после кириллической «т» её нет — условие не срабатывало
  // никогда, и «+бот …» уходило в чат обычным текстом.
  if (!/^[+-]\s*бот(?=\s|$)/i.test(text.trim())) return null;

  const cc = await import("./custom-commands.js");
  const { setCustomRules } = await import("./bot.js");

  try {
    const removing = cc.parseRemoveCommand(text);
    if (removing) {
      const key = await cc.removeCustomCommand(removing);
      setCustomRules(cc.asRules(await cc.loadCustomCommands()));
      return { ok: true, message: `Команда «${key}» убрана` };
    }

    const parsed = cc.parseAddCommand(text);
    if (!parsed) return { ok: false, message: "Не поняла. Пример: «+бот обнимашки обнял|обняла»" };
    if (parsed.error) return { ok: false, message: parsed.error };

    const key = await cc.addCustomCommand(parsed);
    setCustomRules(cc.asRules(await cc.loadCustomCommands()));
    return { ok: true, message: `Команда «${key}» добавлена ♡` };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// Порядок сообщений по времени отправки.
//
// Время проставляет сервер, и пока подтверждение не пришло, у свежего
// сообщения его просто нет. Такие сообщения оказывались не на своём месте,
// а после подтверждения прыгали — особенно заметно на ответах бота, которые
// уходят сразу следом за командой и теряли с ней связь.
//
// Поэтому у неподтверждённых берём текущее время: они и есть самые новые.
function sortByTime(list) {
  const now = Date.now();
  return list
    .map(m => ({ ...m, _at: m.createdAt?.toMillis?.() ?? now }))
    .sort((a, b) => a._at - b._at);
}

// Имена в тексте бота: показываем цветом владельца и, если он вошёл,
// делаем ссылкой на профиль. Так видно, что это тот самый человек,
// а не кто-то взявший похожий ник.
function decorateBotNames(text, msgs) {
  if (getSettings().botNameLinks === "off") return escapeHtml(text);

  // Собираем имена, которые встречались в чате, с их владельцами. Берём
  // только вошедших: у гостя ник не закреплён, ссылаться не на кого.
  const known = new Map();
  for (const m of msgs) {
    if (m.isBot || !m.authorUid || !m.nickname) continue;
    known.set(m.nickname, { uid: m.authorUid, color: m.authorNickColor || null });
  }

  let out = escapeHtml(text);
  for (const [name, who] of known) {
    const safe = escapeHtml(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const color = who.color ? ` style="color:${paletteColor(who.color)}"` : "";
    out = out.replace(
      new RegExp(`(^|[^\\wа-яё])(${safe})(?=[^\\wа-яё]|$)`, "gi"),
      // Открываем карточку, а не уводим со страницы: из чата уходить
      // ради того, чтобы взглянуть на профиль, неудобно.
      `$1<span class="bot-name" data-person="${who.uid}"${color}>$2</span>`
    );
  }
  return out;
}

// Крутится ли колесо у этого сообщения прямо сейчас.
//
// Решается по времени самого сообщения, а не по памяти вкладки: тогда
// колесо видят все, кто открыл чат в эти секунды, и оно не исчезает
// при перерисовке списка.
// Длительность берём у самого колеса — см. WHEEL_TOTAL_MS в roulette-wheel.js.
// Пока она была записана здесь отдельным числом, два значения расходились,
// и колесо успевало запуститься по второму разу.
let spinTotal = 4500;   // запасное значение, пока модуль не подгрузился
let spinRepaint = null; // перерисовка по окончании показа — одна на все колёса
import("./roulette-wheel.js")
  .then(({ WHEEL_TOTAL_MS }) => { spinTotal = WHEEL_TOTAL_MS; })
  .catch(() => {});

function spinningNow(m) {
  if (m.spinNumber === null || m.spinNumber === undefined) return false;
  const at = m.createdAt?.toMillis?.() || Date.now();
  return Date.now() - at < spinTotal;
}

// Кладёт сообщения на страницу, не пересоздавая те, что уже там.
//
// Раньше разметка заменялась целиком при каждом обновлении. Из-за этого
// анимация появления стартовала заново и сбрасывалась через доли секунды —
// выглядело так, будто сообщения возникают из ниоткуда. По той же причине
// дёргалось колесо рулетки и заново подгружалось всё прикреплённое.
//
// Теперь сравниваем по одному: что было — остаётся на месте, новое
// добавляется, исчезнувшее убирается. Меняем только то, что правда
// изменилось.
function applyMessages(host, html, msgs) {
  const next = document.createElement("div");
  next.innerHTML = html;

  const have = new Map(
    [...host.children].map(el => [el.dataset.id, el])
  );

  // Запоминаем, где сейчас стоит каждое сообщение. Когда появится новое,
  // соседи сдвинутся — и мы проиграем этот сдвиг движением, а не рывком.
  //
  // Приём известный: замерить до, поменять, замерить после и показать
  // разницу. Браузер уже всё переставил, а глазу кажется, что вещи
  // разъехались плавно.
  const before = new Map();
  for (const [id, el] of have) before.set(id, el.getBoundingClientRect().top);

  const wanted = [...next.children];
  const keep = new Set(wanted.map(el => el.dataset.id));

  // убираем то, чего больше нет
  for (const [id, el] of have) {
    if (!keep.has(id)) el.remove();
  }

  let prev = null;
  for (const fresh of wanted) {
    const id = fresh.dataset.id;
    const old = have.get(id);

    if (!old) {
      // новое сообщение — вставляем на своё место
      if (prev) prev.after(fresh);
      else host.prepend(fresh);
      prev = fresh;
      continue;
    }

    // Уже есть. Разметку целиком не подменяем: это стирает всё живое
    // внутри — крутящееся колесо, открытую карусель, подгруженный трек.
    // Вместо этого правим по частям, и только те, что правда изменились.
    patchMessage(old, fresh);
    prev = old;
  }

  playShift(host, before);
}

// Мягко проявляет историю при открытии чата — снизу вверх, с небольшим
// запозданием у каждого следующего. Не «эффект ради эффекта»: без него
// переписка возникает разом, и непонятно, загрузилась она или ещё нет.
function revealHistory(host) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const rows = [...host.children].reverse();   // снизу вверх
  rows.forEach((el, i) => {
    // Задержка нарастает, но упирается в потолок: при сотне сообщений
    // ждать последнего пришлось бы несколько секунд.
    el.style.animationDelay = `${Math.min(i * 22, 320)}ms`;
    el.classList.add("history-in");
  });

  setTimeout(() => {
    rows.forEach(el => {
      el.classList.remove("history-in");
      el.style.animationDelay = "";
    });
  }, 900);
}

// Пустые заготовки на месте ещё не пришедших сообщений.
//
// Три штуки: достаточно, чтобы место было занято и страница не дёрнулась,
// и не столько, чтобы это выглядело как настоящая переписка.
function showSkeletons(host) {
  if (host.querySelector(".msg-skeleton")) return;

  const widths = [72, 54, 86];   // разной длины — иначе похоже на таблицу
  const box = document.createElement("div");
  box.className = "skeleton-group";
  box.innerHTML = widths.map(w => `
    <div class="msg-skeleton">
      <div class="skeleton-line" style="width:${w}%"></div>
      <div class="skeleton-line short"></div>
    </div>`).join("");

  host.prepend(box);
}

function hideSkeletons(host) {
  host.querySelector(".skeleton-group")?.remove();
}

// Обновляет сообщение по частям.
//
// Меняется обычно немногое: подпись времени («только что» → «5 мин назад»),
// отметка «изменено», иногда текст. Пересобирать ради этого всё сообщение —
// значит терять то, что внутри уже живёт своей жизнью: проигрыватель,
// открытую картинку, крутящееся колесо.
const PARTS = [".txt", ".chat-msg-head", ".chat-reply-quote", ".chat-images"];

function patchMessage(oldEl, freshEl) {
  // Колесо крутится — не трогаем сообщение вовсе, пока не остановится.
  if (oldEl.querySelector("[data-spin]")) return;

  for (const part of PARTS) {
    const a = oldEl.querySelector(part);
    const b = freshEl.querySelector(part);

    if (!a && b) { oldEl.appendChild(b.cloneNode(true)); continue; }
    if (a && !b) { a.remove(); continue; }
    if (!a || !b) continue;

    if (a.innerHTML !== b.innerHTML) a.innerHTML = b.innerHTML;
    if (a.className !== b.className) a.className = b.className;
  }

  // Класс самого сообщения: «своё», «от бота». Меняется редко, но бывает —
  // например, когда подгрузился профиль автора.
  const keepAppear = oldEl.classList.contains("just-came")
                  || oldEl.classList.contains("history-in");
  if (!keepAppear && oldEl.className !== freshEl.className) {
    oldEl.className = freshEl.className;
  }
}

// Доигрывает сдвиг соседей после вставки нового сообщения.
function playShift(host, before) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  for (const el of host.children) {
    const was = before.get(el.dataset.id);
    if (was === undefined) continue;          // новое — у него своя анимация

    const now = el.getBoundingClientRect().top;
    const shift = was - now;
    if (Math.abs(shift) < 2) continue;        // не сдвинулось

    // Ставим элемент туда, где он был, и отпускаем: он сам доедет на место.
    el.style.transition = "none";
    el.style.transform = `translateY(${shift}px)`;

    requestAnimationFrame(() => {
      el.style.transition = "transform .24s cubic-bezier(.2,.8,.3,1)";
      el.style.transform = "";
    });

    // Убираем следы, иначе они помешают следующему обновлению.
    setTimeout(() => {
      el.style.transition = "";
      el.style.transform = "";
    }, 260);
  }
}

function playMeow() {
  showToast("мяу!");
  try {
    const audio = new Audio("assets/sounds/meow.mp3");
    audio.volume = 0.6;
    audio.play().catch(() => {});   // браузер может не дать звук без действия человека
  } catch {}
}

// Метки собираем один раз на список: у каждой свой запрос про взаимность,
// и делать их во время отрисовки означало бы мигающие подписи.
const authorProfiles = new Map();
const channelCache = new Map();

async function refreshBadges(msgs) {
  const uids = [...new Set(msgs.filter(m => m.authorUid).map(m => m.authorUid))];
  if (!uids.length) return;
  await loadFriends().catch(() => {});
  await Promise.all(uids.map(async uid => {
    if (badges.has(uid)) return;
    const user = await getUserDoc(uid).catch(() => null);
    authorProfiles.set(uid, user);
    badges.set(uid, await relationBadge(uid, user).catch(() => null));
  }));

  // Каналы: оформление берём из самого канала — в сообщении лежит копия
  // на момент отправки, и она устаревает при первой же смене цвета.
  const channelIds = [...new Set(msgs.filter(m => m.channelId).map(m => m.channelId))];
  if (channelIds.length) {
    try {
      const { getChannel } = await import("./channels.js");
      await Promise.all(channelIds.map(async id => {
        if (channelCache.has(id)) return;
        channelCache.set(id, await getChannel(id).catch(() => null));
      }));
      msgs.forEach(m => {
        const ch = m.channelId && channelCache.get(m.channelId);
        if (!ch) return;
        m.channelName = ch.name || m.channelName;
        m.channelAvatar = ch.avatarUrl || m.channelAvatar;
        m.channelShape = ch.avatarShape || "circle";
        m.channelAccessory = ch.accessory || "none";
        m.channelBorder = ch.avatarBorder || "teal";
      });
    } catch (e) { console.warn("Оформление каналов в чате:", e.message); }
  }

  // Оформление берём из профиля, а не из того, что записалось при отправке:
  // человек мог сменить цвет ника или аватарку уже после сообщения, и в чате
  // осталось бы старое.
  msgs.forEach(m => {
    const u = m.authorUid && authorProfiles.get(m.authorUid);
    if (!u) return;
    m.nickColor = u.nickColor || "";
    m.authorAvatar = u.avatarUrl || m.authorAvatar;
    m.authorShape = u.avatarShape || m.authorShape;
    m.authorAccessory = u.accessory || "none";
    m.authorBorder = u.avatarBorder || "pink";
    if (!m.isBot) m.nickname = u.nickname || m.nickname;
  });
}

// Когда сообщение впервые попало на экран. Нужно, чтобы отличить
// действительно новое от перерисованного: список пересобирается целиком
// при любом изменении, и без этого «появлялось» бы всё разом.
//
// Храним время, а не просто отметку: чат успевает перерисоваться два-три
// раза подряд (сразу, потом после загрузки меток), и при простой отметке
// вторая отрисовка обрывала анимацию через миллисекунды после начала —
// выглядело так, будто её нет вовсе.
const shownAt = new Map();
const APPEAR_MS = 400;   // столько сообщение считается появляющимся

function renderChat(msgs, { keepScroll = false } = {}) {
  const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
  const wasAtBottom = !keepScroll && (nearBottom || messagesEl.childElementCount === 0);

  // Первая отрисовка: история не въезжает снизу — это выглядело бы так,
  // будто всё написали только что. Вместо этого она мягко проступает,
  // от нижних сообщений к верхним: взгляд и так начинает снизу.
  const first = shownAt.size === 0;
  const now = Date.now();

  const fresh = first ? new Set() : new Set(
    msgs.filter(m => now - (shownAt.get(m.id) ?? now) < APPEAR_MS).map(m => m.id)
  );
  msgs.forEach(m => { if (!shownAt.has(m.id)) shownAt.set(m.id, now); });

  // Собираем разметку, но в страницу кладём по-умному — см. applyMessages
  // ниже: существующие сообщения не пересоздаются.
  const html = msgs.map(m => {
    // Сообщения бота править нельзя даже автору команды: иначе можно
    // подделать чужую фразу, выданную ботом.
    // Своим считается и сообщение от аккаунта, отправленное с другого
    // устройства: раньше владение определялось только локальной отметкой,
    // и на втором устройстве своих сообщений будто не существовало.
    // Своим считается и сообщение бота, вызванное тобой: удалить его можно,
    // а вот изменить — нет, иначе легко подделать выданную ботом фразу.
    const owned = isOwned("chatMessage", m.id)
      || (currentUser && m.authorUid === currentUser.uid)
      // сообщение бота принадлежит тому, кто вызвал команду
      || (currentUser && m.invokedByUid === currentUser.uid);
    const canManage = owned && !m.isBot;    // правка
    const canDelete = owned;                // удаление
    const kebabItems = [
      { action: "replyMsg", label: "Ответить", icon: ICON.reply },
      ...(m.publicUid ? [
        { action: "copyLink", label: "Скопировать ссылку", icon: ICON.open },
        { action: "copyNuid", label: "Скопировать NUID", icon: ICON.hash }
      ] : []),
      ...(canManage ? [{ action: "editMsg", label: "Изменить", icon: ICON.pencil }] : []),
      ...(canDelete ? [{ action: "deleteMsg", label: "Удалить", icon: ICON.close, danger: true }] : [])
    ];
    // Сообщение либо анонимное (просто ник), либо от аккаунта — тогда рядом
    // миниатюра аватарки, имя своим цветом, метка и переход к профилю.
    const authorHtml = m.isBot
      ? `<span class="person-chip">${avatarHtml({}, 22, "", "bot")}meowbot</span>`
      : m.channelId
        ? `<span class="person-chip" data-channel="${m.channelId}">
             ${avatarHtml({ avatarUrl: m.channelAvatar, avatarShape: m.channelShape,
                            accessory: m.channelAccessory, avatarBorder: m.channelBorder }, 22)}
             <span class="person-name" style="color:${CHANNEL_COLOR}">${escapeHtml(m.channelName || "канал")}</span>
           </span>`
      : m.authorUid
        ? `<span class="person-chip" data-person="${m.authorUid}">
             ${avatarHtml({
                 avatarUrl: m.authorAvatar, avatarShape: m.authorShape,
                 accessory: m.authorAccessory, avatarBorder: m.authorBorder
               }, 22)}
             ${nameHtml({ nickname: m.nickname, nickColor: m.nickColor })}
             ${badgeHtml(badges.get(m.authorUid))}
           </span>`
        // Аноним получает свой оттенок по имени: у сообщений, написанных до
        // появления этой раскраски, оттенок тоже будет — устойчивый, а не
        // случайный при каждой отрисовке.
        : `<span class="person-chip">
             ${avatarHtml({}, 22, "", "anon", m.guestId || m.nickname || "")}
             ${escapeHtml(m.nickname)}
           </span>`;

    // Своё сообщение — справа, чужое слева: так переписка читается как
    // разговор, а не как список, прижатый к одному краю.
    // Сообщения бота всегда слева: их пишет не человек, и ставить их
    // на свою сторону странно. Но удалять их автор команды по-прежнему может —
    // это решается отдельно, ниже.
    const isMine = !m.isBot && (
      isOwned("chatMessage", m.id)
      || (currentUser && m.authorUid === currentUser.uid)
      || (!m.authorUid && m.guestId === getGuestIdentity().id)
    );

    return `
    <div class="chat-msg ${m.isBot ? "is-bot" : ""} ${isMine ? "is-mine" : ""}" data-id="${m.id}">
      <div class="chat-msg-head">
        <b>${authorHtml}</b>
        <span class="muted">· ${timeAgo(m.createdAt)}${m.editedAt ? '<span class="post-edited-tag">(изменено)</span>' : ""}</span>
        ${kebabHtml(kebabItems, m.id)}
      </div>
      ${quoteHtml(m)}
      ${m.text ? `<div class="txt ${/мяукнул/i.test(m.text) ? "meow-again" : ""}"
                       ${/мяукнул/i.test(m.text) ? 'title="нажми, чтобы услышать"' : ""}
                  >${spinningNow(m)
                      // Колесо и текст рисуем вместе: текст пока спрятан,
                      // а когда колесо уйдёт — просто проступит на его месте.
                      // Если рисовать только колесо, после его удаления
                      // в сообщении осталась бы пустота.
                      ? `<div class="wheel-inline" data-spin="${m.spinNumber}"></div>`
                        + `<span class="wheel-text">${decorateBotNames(m.text, msgs)}</span>`
                      : m.isBot
                        ? decorateBotNames(m.text, msgs)
                        : linkifyMentions(escapeHtml(m.text))}</div>` : ""}
      ${imagesToHtml(chatImages(m))}
    </div>`;
  }).join("");

  applyMessages(messagesEl, html, msgs);

  // Проявление истории при открытии чата.
  if (first && msgs.length) revealHistory(messagesEl);

  // Мотаем вниз только если человек и так был внизу. Иначе при чтении старой
  // переписки каждое чужое сообщение дёргало бы страницу вниз из-под пальцев.
  if (wasAtBottom) window.scrollTo({ top: document.body.scrollHeight });

  wireMentions(messagesEl);

  // Имена в сообщениях бота открывают карточку человека.
  messagesEl.querySelectorAll("[data-person]").forEach(el => {
    if (el.dataset.wired) return;
    el.dataset.wired = "1";
    el.addEventListener("click", async () => {
      const { openUserProfile } = await import("./people.js");
      openUserProfile(el.dataset.person);
    });
  });

  // Раскручиваем колёса, которые только что попали на экран, и заводим
  // перерисовку на момент остановки — чтобы на их месте появился текст.
  //
  // Перерисовку ставим одну на все колёса: раньше каждая отрисовка заводила
  // свою, и их накапливалось несколько — отсюда лишние обновления в первые
  // мгновения после отправки.
  const wheels = messagesEl.querySelectorAll("[data-spin]:empty");
  if (wheels.length) {
    import("./roulette-wheel.js").then(({ mountWheel }) => {
      // Ключ — сам идентификатор сообщения: по нему колесо узнаёт себя
      // после перерисовки и продолжает с того же места.
      wheels.forEach(el => {
        const id = el.closest(".chat-msg")?.dataset.id || null;
        mountWheel(el, Number(el.dataset.spin), id);
      });
    }).catch(() => {});

    // Отсчёт ведём от времени сообщения, а не от момента отрисовки:
    // иначе каждая перерисовка отодвигала бы конец показа.
    const oldest = Math.min(...[...wheels].map(el => {
      const id = el.closest(".chat-msg")?.dataset.id;
      const msg = msgs.find(m => m.id === id);
      return msg?.createdAt?.toMillis?.() || Date.now();
    }));

    clearTimeout(spinRepaint);
    spinRepaint = setTimeout(
      () => renderChat(lastMessages, { keepScroll: true }),
      Math.max(120, spinTotal - (Date.now() - oldest))
    );
  }
  wireCarousels(messagesEl);
  wireImageZoom(messagesEl);
  // «мяу» можно услышать в любой момент, а не только когда мяукнули при тебе
  renderChatTracks(messagesEl, msgs);
  renderChatArtworks(messagesEl, msgs);

  messagesEl.querySelectorAll(".meow-again").forEach(el => {
    el.addEventListener("click", () => playMeow());
  });

  messagesEl.querySelectorAll("[data-channel]").forEach(el => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const { openChannelPreview } = await import("./person-preview.js");
      openChannelPreview(el.dataset.channel);
    });
  });

  messagesEl.querySelectorAll("[data-person]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openPersonPreview(el.dataset.person);
    });
    // Долгое нажатие подставляет упоминание в поле ввода — так человека
    // из чата можно позвать, не переписывая его имя вручную.
    let hold = null;
    el.addEventListener("pointerdown", () => {
      hold = setTimeout(async () => {
        hold = null;
        const user = await getUserDoc(el.dataset.person).catch(() => null);
        if (!user?.username) return;
        const input = document.getElementById("chatInput");
        input.value = `${input.value}@${user.username} `.trimStart();
        input.focus();
        showToast("Упоминание добавлено");
      }, 550);
    });
    const cancel = () => { if (hold) { clearTimeout(hold); hold = null; } };
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointerleave", cancel);
  });
  messagesEl.querySelectorAll(".chat-msg").forEach(row => {
    const msgId = row.dataset.id;
    const msg = msgs.find(m => m.id === msgId);
    wireKebab(row, {
      replyMsg: () => startReply(msg),
      copyLink: () => {
        const url = `${location.origin}${location.pathname}?msg=${msg.publicUid}`;
        copyText(url, "Ссылка скопирована");
      },
      copyNuid: () => copyText(msg.publicUid, "Идентификатор скопирован"),
      editMsg: () => editMessage(msgId, row),
      deleteMsg: () => deleteMessage(msgId)
    });
  });

  // клик по цитате — прыжок к оригиналу с подсветкой
  messagesEl.querySelectorAll("[data-jump]").forEach(q => {
    q.addEventListener("click", () => {
      const target = messagesEl.querySelector(`.chat-msg[data-id="${q.dataset.jump}"]`);
      if (!target) { showToast("Сообщение не найдено — возможно, удалено"); return; }
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.remove("is-reply-target");
      void target.offsetWidth;  // рестарт анимации
      target.classList.add("is-reply-target");
    });
  });
}

function startReply(msg) {
  if (!msg) return;
  replyingTo = { id: msg.id, nickname: msg.nickname, text: msg.text || "(фото)" };
  renderReplyBar();
  document.getElementById("chatInput").focus();
}

function renderReplyBar() {
  const host = document.getElementById("replyComposeHost");
  if (!host) return;
  if (!replyingTo) { host.innerHTML = ""; return; }
  host.innerHTML = `
    <div class="reply-compose-bar">
      <span class="nf">${ICON.reply}</span>
      <span>ответ <b>${escapeHtml(replyingTo.nickname)}</b>: ${escapeHtml(replyingTo.text.slice(0, 40))}${replyingTo.text.length > 40 ? "…" : ""}</span>
      <button class="cancelReply nf" title="отменить">${ICON.close}</button>
    </div>`;
  host.querySelector(".cancelReply").addEventListener("click", () => {
    replyingTo = null;
    renderReplyBar();
  });
}

async function editMessage(msgId, row) {
  const currentText = row.querySelector(".txt")?.textContent || "";
  const next = await askText("Изменить сообщение", { value: currentText, maxlength: 500 });
  if (next === null || !next.trim() || next.trim() === currentText) return;
  try {
    await updateDoc(doc(db, "chatMessages", msgId), { text: next.trim(), editedAt: serverTimestamp() });
    showToast("Изменено ♡");
  } catch (e) {
    console.error(e);
    showToast("Не удалось изменить: " + e.message);
  }
}

async function deleteMessage(msgId) {
  if (!await askConfirm("Удалить сообщение?", { hint: "Отменить не получится.", okLabel: "Удалить", danger: true })) return;
  try {
    await deleteDoc(doc(db, "chatMessages", msgId));
    showToast("Удалено");
  } catch (e) {
    console.error(e);
    // Частый случай у гостей: анонимная сессия сменилась (её удалила
    // автоочистка в Firebase или человек почистил данные браузера), и запись
    // о владении указывает на идентификатор, которого больше нет.
    const lost = /permission|insufficient/i.test(e.message);
    showToast(lost
      ? "Не выходит: сообщение отправлено с другой гостевой сессии"
      : "Не удалилось: " + e.message);
  }
}

// Переход по ссылке вида ?msg=U2XXXXXX: находим сообщение и, если его ещё нет
// на экране, догружаем историю порциями, пока не встретим. Ограничение по
// числу попыток нужно, чтобы ссылка на удалённое сообщение не крутила
// подгрузку бесконечно.
async function openLinkedMessage() {
  const nuid = new URLSearchParams(location.search).get("msg");
  if (!nuid) return;

  const hit = await resolveNuid(nuid).catch(() => null);
  if (!hit || hit.type !== "message") { showToast("Сообщение не найдено"); return; }

  for (let attempt = 0; attempt < 12; attempt++) {
    const el = messagesEl.querySelector(`.chat-msg[data-id="${hit.uid}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.remove("is-reply-target");
      void el.offsetWidth;
      el.classList.add("is-reply-target");
      return;
    }
    if (!oldestDoc) break;              // дошли до начала переписки
    const older = await loadOlderMessages().catch(() => []);
    if (!older.length) break;
    olderMessages = [...older, ...olderMessages];
    lastMessages = [...older, ...lastMessages];
    renderChat(lastMessages, { keepScroll: true });
  }
  showToast("Сообщение слишком далеко или удалено");
}

export function initChatForm() {
  grabElements();
  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatInput");
  const imageInput = document.getElementById("chatImageInput");
  const preview = document.getElementById("chatImagePreview");
  const changeNickBtn = document.getElementById("changeChatNickBtn");
  const emojiBtn = document.getElementById("chatEmojiBtn");

  imageInput.addEventListener("change", () => {
    const picked = Array.from(imageInput.files || []);
    imageInput.value = "";
    if (!picked.length) return;

    const room = MAX_CHAT_IMAGES - pendingChatImages.length;
    if (picked.length > room) showToast(`Максимум ${MAX_CHAT_IMAGES} фото — добавила ${Math.max(0, room)}`);
    pendingChatImages.push(...picked.slice(0, Math.max(0, room)));
    renderChatPreview();
  });

  function renderChatPreview() {
    if (!pendingChatImages.length) {
      preview.classList.add("hidden");
      preview.innerHTML = "";
      return;
    }
    preview.classList.remove("hidden");
    // Миниатюры идут в один ряд и прокручиваются вбок: в столбик они
    // закрывали собой всю переписку.
    preview.innerHTML = pendingChatImages.map((f, i) => `
      <div class="thumb">
        <img src="${URL.createObjectURL(f)}" alt="">
        <button class="removeThumb" data-remove="${i}" title="убрать">
          <span class="nf">${ICON.close}</span>
        </button>
      </div>`).join("");
    preview.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", () => {
        pendingChatImages.splice(Number(btn.dataset.remove), 1);
        renderChatPreview();
      });
    });
  }

  if (emojiBtn) emojiBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEmojiPicker(form, (emoji) => { input.value += emoji; input.focus(); });
  });

  // Чекбокс появляется только у вошедших и только если это разрешено настройкой.
  // Режим «только от аккаунта» прячет анонимный ник, «только аноним» — чекбокс.
  const accountRow = document.getElementById("accountToggleRow");
  const asAccount = document.getElementById("asAccountToggle");
  const nickRow = document.querySelector(".chat-nick-row");

  // Каналы, от имени которых можно писать: свои и те, где ты управляющий.
  let myChannels = [];
  let speakAs = "self";     // self | channel:<id>

  async function loadSpeakOptions() {
    if (!currentUser) return;
    try {
      // Функция отдаёт два списка — созданные и те, где ты управляющий.
      // Для чата разницы нет: писать можно от любого.
      const { fetchManagedChannels } = await import("./channels.js");
      const { created, admin } = await fetchManagedChannels();
      const seen = new Set();
      myChannels = [...created, ...admin].filter(c => {
        if (!c || seen.has(c.id)) return false;   // создатель бывает и в админах
        seen.add(c.id);
        return true;
      });
    } catch { myChannels = []; }

    const host = document.getElementById("channelPickHost");
    if (!host || !myChannels.length) return;

    const { customSelect, wireSelects } = await import("./select.js");
    const options = { self: "от себя" };
    myChannels.forEach(c => { options["channel:" + c.id] = c.name; });

    host.innerHTML = customSelect("speakAs", options, speakAs);
    wireSelects(host, (_, value) => {
      speakAs = value;
      // писать от канала можно только от аккаунта, анонимность тут ни при чём
      if (value !== "self") asAccount.checked = true;
    });
  }

  authReady.then(() => {
    const mode = getSettings().chatIdentity || "both";
    const canAccount = !!currentUser && mode !== "anon";
    accountRow.classList.toggle("hidden", !canAccount);
    if (canAccount) loadSpeakOptions();
    if (canAccount && mode === "account") {
      asAccount.checked = true;
      asAccount.disabled = true;
      nickRow.classList.add("hidden");
    }
  });

  document.getElementById("botHelpBtn")?.addEventListener("click", async () => {
    // Список собирает сам движок — тот же, что отвечает на «.команды».
    // Раньше здесь была своя сборка, и после смены формата она выдавала
    // строку из одних запятых.
    const { commandsHelp } = await import("./bot.js");
    askConfirm("Команды бота", {
      hint: commandsHelp(),
      okLabel: "Понятно"
    });
  });

  changeNickBtn.addEventListener("click", async () => {
    const current = getGuestIdentity().nickname;
    const next = await askText("Новый ник для чата", { value: current, maxlength: 32 });
    if (next && next.trim()) {
      const identity = setGuestNickname(next.trim());
      nickLabel.textContent = identity.nickname;
      showToast("Ник обновлён ♡");
    }
  });

  let sending = false;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !pendingChatImages.length) return;
    if (sending) return;                      // защита от повторного нажатия

    // Поле очищается сразу, а отправка идёт следом. Раньше при фотографиях
    // между нажатием и появлением сообщения проходили секунды, за которые
    // легко нажать ещё несколько раз — и в чат уходило пять одинаковых реплик.
    const images = pendingChatImages.slice();
    input.value = "";
    pendingChatImages = [];
    renderChatPreview();
    const replySnapshot = replyingTo;
    replyingTo = null;
    renderReplyBar();

    sending = true;
    if (images.length) showToast("Отправляю…");

    try {
      const identity = getGuestIdentity();

      // Команды бота: разбираем до отправки. Если сработала — уходит готовая
      // фраза с пометкой бота вместо исходного текста.
      const speakerName = (asAccount?.checked && currentUserDoc)
        ? currentUserDoc.nickname
        : identity.nickname;
      // «+бот …» и «-бот …» — управление своими командами. Разбираем до
      // обычных команд: это не сообщение в чат, а настройка.
      const custom = await handleCustomCommand(text);
      if (custom) {
        // Поле очищаем только если получилось: при ошибке текст должен
        // остаться — иначе длинную команду приходится набирать заново.
        if (custom.ok) input.value = "";
        showToast(custom.message);
        return;
      }

      let parsed = parseCommand(text, speakerName, replySnapshot?.nickname || null);

      // Команды с кошельком требуют обращения к базе — доводим их здесь,
      // чтобы сам разбор остался быстрым и работал без сети.
      if (parsed?.async) {
        const { runAsyncCommand } = await import("./bot.js");
        parsed = await runAsyncCommand(parsed.async, {
          rest: parsed.rest,
          author: speakerName,
          target: replySnapshot?.nickname || null,
          targetUid: replySnapshot?.authorUid || null,
          // Пишешь под анонимным ником — значит и баланс показывать
          // в общем чате нельзя: по нему видно, кто ты.
          anonymous: !(asAccount?.checked && currentUserDoc)
        });

        // То, что предназначено только тебе: остаток, история.
        if (parsed?.quiet) {
          showToast(parsed.quiet);
          if (!parsed.text) { input.value = ""; return; }
        }

        // Колесо крутится до объявления результата: число уже известно,
        // но показать его сразу — значит убрать из игры саму игру.
        //
        // Крутится на месте будущего сообщения, а не поверх экрана: так его
        // видят все, кто в чате, а не только тот, кто играл. И не мешает
        // читать остальное.
        // Число кладём в само сообщение. Тогда колесо показывает каждый,
        // кто видит его свежим, — и оно переживает перерисовку списка:
        // раньше колесо жило в разметке и стиралось первым же обновлением
        // чата, успевая мелькнуть на долю секунды.
        if (parsed?.wheel !== undefined) {
          parsed.spinNumber = parsed.wheel;
          delete parsed.wheel;
        }

        // Выбывшему из русской рулетки — минута молчания, и конфетти тому,
        // кому повезло (если не выключено в настройках).
        if (parsed?.effect === "dead") muteSelf(60);
        if (parsed?.effect === "alive" && getSettings().rouletteConfetti !== "off") {
          import("./confetti.js").then(({ burstConfetti }) =>
            burstConfetti(window.innerWidth / 2, window.innerHeight * 0.4)
          ).catch(() => {});
        }
      }

      if (parsed?.error) { showToast(parsed.error); return; }

      const imageUrls = images.length ? await uploadImages(images) : [];
      if (imageUrls.some(u => !u)) throw new Error("Одна из картинок не загрузилась");
      // Личность сообщения: аккаунт или анонимный ник. Данные автора копируются
      // в само сообщение, чтобы список не требовал запроса профиля на каждую
      // строку — так же, как это сделано у записей ленты.
      const useAccount = !parsed && asAccount?.checked && currentUser && currentUserDoc;
      const channel = (!parsed && speakAs.startsWith("channel:"))
        ? myChannels.find(c => c.id === speakAs.slice(8))
        : null;

      const payload = {
        guestId: identity.id,
        authorUid: useAccount ? currentUser.uid : null,
        // Сообщение от канала: подписано каналом, но право писать проверяется
        // по человеку — правила пускают только команду канала.
        channelId: channel ? channel.id : null,
        channelName: channel ? channel.name : null,
        channelAvatar: channel ? (channel.avatarUrl || null) : null,
        channelShape: channel ? (channel.avatarShape || "circle") : null,
        channelAccessory: channel ? (channel.accessory || "none") : null,
        channelBorder: channel ? (channel.avatarBorder || "teal") : null,
        authorAvatar: useAccount ? (currentUserDoc.avatarUrl || "") : null,
        authorShape: useAccount ? (currentUserDoc.avatarShape || "circle") : null,
        nickColor: useAccount ? (currentUserDoc.nickColor || "") : null,
        nickname: parsed ? "бот"
                : channel ? channel.name
                : useAccount ? currentUserDoc.nickname
                : identity.nickname,
        isBot: !!parsed,
        // Кто вызвал команду. Само сообщение подписано ботом, но убрать его
        // должен уметь тот, кто его вызвал — даже после перезахода в аккаунт.
        // Раньше право держалось только на отметке в браузере, а она к
        // аккаунту не привязана: вышел и зашёл — и своё же не удалить.
        invokedByUid: parsed ? (currentUser?.uid || null) : null,
        // Выпавшее число: по нему чат показывает колесо, пока сообщение
        // свежее. Хранится в сообщении, а не в памяти вкладки, — иначе
        // его видел бы только тот, кто играл.
        spinNumber: parsed?.spinNumber ?? null,
        text: parsed ? parsed.text : text,
        imageUrls,
        createdAt: serverTimestamp()
      };
      // цитату сохраняем прямо в сообщении: так она переживёт удаление оригинала
      // и не требует лишнего чтения при рендере
      if (replySnapshot) {
        payload.replyToId = replySnapshot.id;
        payload.replyToNickname = replySnapshot.nickname;
        payload.replyToText = replySnapshot.text.slice(0, 120);
      }
      const ref = await addDoc(collection(db, "chatMessages"), payload);
      await setDoc(doc(db, "chatMessageSecrets", ref.id), { ownerUid: auth.currentUser.uid });
      markOwned("chatMessage", ref.id);

      // Идентификатор сообщения: по нему можно дать ссылку или упомянуть
      // сообщение в другом месте. Записывается отдельно, потому что нужен
      // id уже созданного документа.
      // Поле и режим ответа сбрасываем сразу после отправки — раньше при команде
      // бота текст оставался в поле, и его легко было отправить повторно.
      registerMessageNuid(ref.id)
        .then(nuid => updateDoc(doc(db, "chatMessages", ref.id), { publicUid: nuid }))
        .catch(e => console.warn("Идентификатор сообщения не записался:", e.message));
      input.value = "";
      pendingChatImages = [];
      renderChatPreview();
      replyingTo = null;
      renderReplyBar();
    } catch (err) {
      console.error(err);
      // Возвращаем написанное обратно в поле: иначе при сбое текст просто
      // исчезал бы, и набирать пришлось бы заново.
      input.value = text;
      pendingChatImages = images;
      renderChatPreview();
      showToast("Не отправилось: " + err.message);
    } finally {
      sending = false;
    }
  });
}

// см. unsubscribeFeed: то же самое для общего чата
export function unsubscribeChat() {
  if (chatUnsub) { chatUnsub(); chatUnsub = null; }
  lastMessages = [];
  olderMessages = [];
  oldestDoc = null;
  chatStarted = false;
}
