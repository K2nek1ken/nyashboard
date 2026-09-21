import {
  db, auth, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDocs,
  query, orderBy, limit, startAfter, onSnapshot, serverTimestamp, Timestamp
} from "./firebase.js";
import { getGuestIdentity, setGuestNickname, syncChatNickname } from "./identity.js";
import { TIMING } from "./modules/animation.js";
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

    // Резервируем пустое место над перепиской и потом заполняем его
    // сообщениями — по одному, снизу вверх. Высота страницы при этом
    // не меняется ни на пиксель: сколько добавили сообщение, столько же
    // убавили пустоты. Дёргаться нечему.
    const reserve = openReserve(messagesEl);

    // Держим видимое на месте всю подгрузку и ещё немного после:
    // досборка и дочитывание шрифтов идут следом.
    const release = holdViewport(messagesEl, 60000);

    try {
      const older = await loadOlderMessages();

      if (older.length) {
        olderMessages = [...older, ...olderMessages];
        lastMessages = [...older, ...lastMessages];

        await fillReserve(reserve, older, lastMessages);

        // Досборка: обработчики, метки, прикреплённое. Сами сообщения
        // уже на месте и пересоздаваться не будут.
        renderChat(lastMessages, { keepScroll: true });
      }
    } catch (e) {
      console.warn("История не догрузилась:", e.message);
    } finally {
      closeReserve(reserve);
      // Отпускаем не сразу: метки, шрифты и досборка ещё доезжают.
      setTimeout(release, 1500);
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
  if (snap.empty) { oldestDoc = null; reachedStart = true; return []; }   // дошли до начала переписки
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
    if (lastMessages.length) {
      renderChat(lastMessages);
      initChatNav(messagesEl);
      applyMute();
      return;
    }

    // Подписка есть, а сообщений нет: она осталась от прошлого захода
    // и первую порцию уже отдала. Начинаем заново, иначе чат висит
    // пустым до перезагрузки.
    chatUnsub();
    chatUnsub = null;
  }
  // Живая подписка только на последние сообщения: грузить всю переписку разом
  // и долго, и дорого по обращениям к базе. Остальное подтягивается порциями
  // при прокрутке вверх.
  // После перезагрузки памяти нет — поднимаем переписку из хранилища вкладки.
  restoreFromSession();

  // Вернулись во вкладку, а переписка ещё в памяти — рисуем её сразу
  // и встаём на прежнее место. База догонит следом и добавит новое.
  if (lastMessages.length) {
    renderChat(lastMessages, { keepScroll: true });
    if (savedSpot) restoreChatSpot();
  }

  const q = query(collection(db, "chatMessages"), orderBy("createdAt", "desc"), limit(PAGE_SIZE));
  chatUnsub = onSnapshot(q, (snap) => {
    const fresh = sortByTime(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    // Курсор подгрузки не откатываем, если история уже подгружена глубже:
    // иначе после возврата во вкладку следующая подгрузка тянула бы
    // заново то, что уже на экране.
    if (!olderMessages.length) oldestDoc = snap.docs[snap.docs.length - 1] || oldestDoc;
    // История не должна перекрывать живую порцию. Всё, что новее самого
    // старого из пришедшего, база прислала бы сама, — если его нет в
    // порции, значит его удалили (например, пока страница перезагружалась).
    // Сохранённая копия такого сообщения висела бы привидением.
    const freshOldest = Math.min(...fresh.map(m => m.createdAt?.toMillis?.() ?? Infinity));
    if (Number.isFinite(freshOldest)) {
      olderMessages = olderMessages.filter(m => (m.createdAt?.toMillis?.() ?? 0) < freshOldest);
    }

    // склеиваем с ранее подгруженной историей, без повторов
    const seenIds = new Set(fresh.map(m => m.id));
    lastMessages = [...olderMessages.filter(m => !seenIds.has(m.id)), ...fresh];
    // Рисуем сразу, не дожидаясь ничего постороннего. Раньше отрисовка
    // шла после загрузки меток, и если та подвисала — чат навсегда
    // оставался с надписью «загружаю».
    // Вернулись во вкладку — встаём туда же, где остановились, а не вниз.
    if (savedSpot) {
      renderChat(lastMessages, { keepScroll: true });
      restoreChatSpot();
    } else {
      renderChat(lastMessages);
    }

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

  // Когда подъехал список своих сообщений, перерисовываем: у тех, что
  // оказались своими, появятся кнопки «изменить» и «удалить». Обработчик
  // вешаем один раз на всю жизнь страницы.
  if (!window.__nyashOwnedChatHook) {
    window.__nyashOwnedChatHook = true;
    window.addEventListener("nyash:owned", () => {
      if (lastMessages.length && messagesEl?.isConnected) {
        renderChat(lastMessages, { keepScroll: true });
      }
    });
  }
  import("./ownership.js").then(o => o.loadOwnedRemote()).catch(() => {});

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

// Насколько свежим должно быть мяуканье, чтобы на него отзываться.
// Полминуты: сообщение идёт до нас секунду-другую, но всё, что старше,
// уже точно не «прямо сейчас».
const MEOW_WINDOW = 30 * 1000;

// Кто-то написал «мяукнуть» — отзываемся звуком и подсказкой. Отключается
// в настройках.
//
// Отзываемся только на то, что написано только что. Раньше проверялось
// лишь «видели ли мы это сообщение», и при перезагрузке вся история
// считалась новой — страница мяукала за вчерашние сообщения.
function reactToMeow(msgs) {
  if (!chatStarted) { msgs.forEach(m => meowSeen.add(m.id)); chatStarted = true; return; }
  if (getSettings().meowReaction === "off") return;

  const now = Date.now();
  const fresh = msgs.filter(m => !meowSeen.has(m.id));
  fresh.forEach(m => meowSeen.add(m.id));

  const meowed = fresh.some(m => {
    if (!m.isBot || !/мяукнул/i.test(m.text || "")) return false;

    // Время ставит сервер; у только что отправленного его ещё нет —
    // значит оно и есть самое свежее.
    const at = m.createdAt?.toMillis?.();
    return at === undefined || now - at < MEOW_WINDOW;
  });
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
      row.innerHTML = linkifyMentions(escapeHtml(visibleText(m)));
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

    // Эту же высоту знают и кнопки прокрутки: они стоят над панелью.
    // Раньше их место было вписано числом, и когда панель подросла
    // (многострочное поле, строка «команды»), кнопка «вниз» уехала
    // под неё — виднелся только её край.
    document.documentElement.style.setProperty("--chat-bar-h", bar.offsetHeight + "px");
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
    const { getArtwork, artMediaHtml, artImages } = await import("./art.js");
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
          ${artMediaHtml(a)}
          <div class="art-attached-body">
            <div class="art-attached-title">${escapeHtml(a.title)}</div>
            ${a.description ? `<div class="art-desc">${escapeHtml(a.description)}</div>` : ""}
          </div>
        </div>`).join("");
      row.after(host);

      host.querySelectorAll("img").forEach((img, i) => {
        img.addEventListener("click", () => openLightbox(img.src, artImages(works), i));
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

// Имена в тексте бота: цветом владельца и ссылкой на профиль.
//
// Кто есть кто, берём из самого сообщения — там сохранено, кто вызвал
// команду и на кого, по учётным записям. Раньше имена искались по
// совпадению ника среди всех сообщений чата, и команда на тёзку
// выглядела так, будто ты применил её к самому себе.
//
// Ссылку даём только тем, кто писал от аккаунта. Аноним профиля не имеет,
// а человек с профилем, написавший анонимно, не должен раскрываться.
function decorateBotNames(m) {
  const text = m.text || "";
  if (getSettings().botNameLinks === "off") return escapeHtml(text);

  // Старые сообщения бота участников не хранят — угадывать по имени
  // больше не будем: лучше без ссылок, чем со ссылкой не на того.
  const people = [m.botActor, m.botTarget].filter(p => p?.name);
  if (!people.length) return escapeHtml(text);

  // Проходим текст по порядку: сначала ищем автора, потом цель — после
  // него. Так «неко обнял неко» разберётся верно: первое имя — автор,
  // второе — тот, на кого ответили.
  let out = "";
  let rest = text;

  for (const p of people) {
    const at = rest.indexOf(p.name);
    if (at < 0) continue;

    out += escapeHtml(rest.slice(0, at));
    const color = p.color ? ` style="color:${paletteColor(p.color)}"` : "";
    out += p.uid
      ? `<span class="bot-name" data-person="${p.uid}"${color}>${escapeHtml(p.name)}</span>`
      : `<span class="bot-name bot-name-anon"${color}>${escapeHtml(p.name)}</span>`;
    rest = rest.slice(at + p.name.length);
  }

  return out + escapeHtml(rest);
}

// ============================================================
//  Восстановлено: всё, что лежит между подсветкой имён и мяуканьем.
//  (Однажды этот блок был снесён заменой «отсюда до туда» — поэтому
//  здесь каждая функция отдельная, а правки делаются точечно.)
// ============================================================

// ---------- колесо рулетки на месте сообщения ----------

// Длительность показа берём у самого колеса (WHEEL_TOTAL_MS), чтобы два
// числа не расходились и колесо не заводилось по второму разу.
let spinTotal = 4500;    // запасное значение, пока модуль не подгрузился
let spinRepaint = null;  // перерисовка по окончании показа — одна на все колёса
import("./roulette-wheel.js")
  .then(({ WHEEL_TOTAL_MS }) => { spinTotal = WHEEL_TOTAL_MS; })
  .catch(() => {});

// Крутится ли колесо у этого сообщения прямо сейчас. Решается по времени
// самого сообщения: так колесо видят все и оно переживает перерисовку.
function spinningNow(m) {
  if (m.spinNumber === null || m.spinNumber === undefined) return false;
  const at = m.createdAt?.toMillis?.() || Date.now();
  return Date.now() - at < spinTotal;
}

// ---------- возврат набранного ----------

// Возвращает набранное в поле — когда отправка не состоялась.
function restoreInput(text) {
  const input = document.getElementById("chatInput");
  if (!input || input.value) return;   // человек уже набирает новое — не мешаем
  input.value = text;
  input.dispatchEvent(new Event("input"));   // пусть поле подрастёт под текст
  input.focus();
}

// ---------- умное обновление списка ----------

// Кладёт сообщения на страницу, не пересоздавая те, что уже там: что было —
// остаётся на месте, новое добавляется, исчезнувшее убирается. Иначе
// анимации сбрасывались, колесо дёргалось, прикреплённое грузилось заново.
function applyMessages(host, html, msgs) {
  const next = document.createElement("div");
  next.innerHTML = html;

  // Пустое место под подгружаемую историю — не сообщение, его не трогаем.
  const have = new Map(
    [...host.children]
      .filter(el => !el.classList.contains("history-reserve"))
      .map(el => [el.dataset.id, el])
  );

  // Где стоит каждое сообщение сейчас — чтобы проиграть сдвиг соседей.
  const before = new Map();
  for (const [id, el] of have) before.set(id, el.getBoundingClientRect().top);

  const wanted = [...next.children];
  const keep = new Set(wanted.map(el => el.dataset.id));

  for (const [id, el] of have) {
    if (!keep.has(id)) el.remove();
  }

  let prev = null;
  for (const fresh of wanted) {
    const id = fresh.dataset.id;
    const old = have.get(id);

    if (!old) {
      // Новое: класс появления ставим отдельным кадром после вставки,
      // иначе браузер может не проиграть анимацию.
      const shouldAppear = fresh.classList.contains("just-came");
      fresh.classList.remove("just-came");

      if (prev) prev.after(fresh);
      else {
        const reserve = host.querySelector(".history-reserve");
        reserve ? reserve.after(fresh) : host.prepend(fresh);
      }

      if (shouldAppear) {
        requestAnimationFrame(() => fresh.classList.add("just-came"));
        setTimeout(() => fresh.classList.remove("just-came"), TIMING.message.appear + 60);
      }

      prev = fresh;
      continue;
    }

    patchMessage(old, fresh);
    prev = old;
  }

  playShift(host, before);
}

// Части сообщения, которые сравниваются и меняются по отдельности.
const PARTS = [".txt", ".chat-msg-head", ".chat-reply-quote", ".chat-images"];

// Обновляет сообщение по частям — чтобы не терять живое внутри:
// проигрыватель, открытую картинку, крутящееся колесо.
function patchMessage(oldEl, freshEl) {
  // Колесо крутится — не трогаем сообщение, пока не остановится.
  if (oldEl.querySelector("[data-spin]")) return;

  for (const part of PARTS) {
    const a = oldEl.querySelector(part);
    const b = freshEl.querySelector(part);

    if (!a && b) { oldEl.appendChild(b.cloneNode(true)); continue; }
    if (a && !b) { a.remove(); continue; }
    if (!a || !b) continue;

    if (a.innerHTML !== b.innerHTML) {
      a.innerHTML = b.innerHTML;
      // В шапке живёт меню — после замены кнопка новая, перевешиваем.
      if (part === ".chat-msg-head") delete oldEl.dataset.wired;
    }
    if (a.className !== b.className) a.className = b.className;
  }

  const keepAppear = oldEl.classList.contains("just-came")
                  || oldEl.classList.contains("history-in");
  if (!keepAppear && oldEl.className !== freshEl.className) {
    oldEl.className = freshEl.className;
  }
}

// Доигрывает сдвиг соседей после вставки нового сообщения:
// ставим туда, где стояли, и отпускаем — доедут сами.
function playShift(host, before) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  for (const el of host.children) {
    const was = before.get(el.dataset.id);
    if (was === undefined) continue;

    const shift = was - el.getBoundingClientRect().top;
    if (Math.abs(shift) < 2) continue;

    el.style.transition = "none";
    el.style.transform = `translateY(${shift}px)`;

    requestAnimationFrame(() => {
      el.style.transition = `transform ${TIMING.message.shift}ms ${TIMING.message.shiftEasing}`;
      el.style.transform = "";
    });

    setTimeout(() => {
      el.style.transition = "";
      el.style.transform = "";
    }, TIMING.message.shift + 20);
  }
}

// Проявление истории при открытии чата — снизу вверх, с нарастающей
// задержкой, упирающейся в потолок.
function revealHistory(host) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const rows = [...host.querySelectorAll(".chat-msg")].reverse();
  rows.forEach((el, i) => {
    el.style.animationDelay =
      `${Math.min(i * TIMING.message.historyStep, TIMING.message.historyMax)}ms`;
    el.classList.add("history-in");
  });

  setTimeout(() => {
    rows.forEach(el => {
      el.classList.remove("history-in");
      el.style.animationDelay = "";
    });
  }, TIMING.message.history + TIMING.message.historyMax + 200);
}

// ---------- подгрузка истории без рывков ----------

// Держит на месте сообщение, на которое человек смотрит: при любом
// изменении размеров выше возвращает его туда же. Прокрутку самого
// человека не трогает — при ней просто запоминает новое положение.
function holdViewport(host, ms = 2500) {
  const headH = document.getElementById("navHost")?.getBoundingClientRect().bottom || 0;
  const anchor = [...host.querySelectorAll(".chat-msg")]
    .find(el => el.getBoundingClientRect().bottom > headH + 4);
  if (!anchor || !("ResizeObserver" in window)) return () => {};

  let top = anchor.getBoundingClientRect().top;

  const keepIt = () => {
    if (!anchor.isConnected) return;
    const delta = anchor.getBoundingClientRect().top - top;
    if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
  };
  const remember = () => { if (anchor.isConnected) top = anchor.getBoundingClientRect().top; };

  // Браузер и сам пытается держать прокрутку — на это время выключаем,
  // иначе поправки сложатся вдвое.
  const root = document.documentElement;
  const prevAnchor = root.style.overflowAnchor;
  root.style.overflowAnchor = "none";

  const watch = new ResizeObserver(keepIt);
  watch.observe(host);
  window.addEventListener("scroll", remember, { passive: true });

  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    watch.disconnect();
    window.removeEventListener("scroll", remember);
    root.style.overflowAnchor = prevAnchor;
  };
  setTimeout(stop, ms);
  return stop;
}

// Открывает пустое место над перепиской и сдвигает прокрутку ровно на него.
function openReserve(host) {
  const reserve = document.createElement("div");
  reserve.className = "history-reserve";
  const height = Math.round(window.innerHeight * 0.8);
  reserve.style.height = height + "px";

  host.prepend(reserve);
  window.scrollBy(0, height);
  return reserve;
}

// Собирает сообщение целиком — со всем прикреплённым — до того, как оно
// попадёт на страницу: тогда оно встаёт сразу своего размера.
async function prepareMessage(m, allMsgs) {
  const tmp = document.createElement("div");
  tmp.innerHTML = messageHtml(m, allMsgs);
  const el = tmp.firstElementChild;
  if (!el) return null;

  await Promise.all([
    renderChatTracks(tmp, [m]),
    renderChatArtworks(tmp, [m])
  ]).catch(() => {});

  const images = [...el.querySelectorAll("img")];
  await Promise.race([
    Promise.all(images.map(img => img.decode().catch(() => {}))),
    new Promise(r => setTimeout(r, 4000))
  ]);

  return el;
}

// Заполняет пустоту сообщениями — по одному, снизу вверх. На каждое
// пустота убавляется ровно на его высоту, и страница не меняется.
async function fillReserve(reserve, older, allMsgs) {
  const pause = (ms) => new Promise(r => setTimeout(r, ms));

  older.forEach(m => shownAt.set(m.id, 0));   // старые — не «появившиеся»

  const ready = await Promise.all(older.map(m => prepareMessage(m, allMsgs)));

  for (let i = older.length - 1; i >= 0; i--) {
    if (!reserve.isConnected) return;
    const el = ready[i];
    if (!el) continue;

    const host = reserve.parentElement;
    const before = host.offsetHeight;

    reserve.after(el);
    el.classList.add("history-in");

    const grew = host.offsetHeight - before;
    const left = (parseFloat(reserve.style.height) || 0) - grew;

    if (left >= 0) {
      reserve.style.height = left + "px";
    } else {
      reserve.style.height = "0px";
      window.scrollBy(0, -left);
    }

    setTimeout(() => el.classList.remove("history-in"), 500);
    await pause(older.length > 20 ? 14 : 32);
  }
}

// Убирает остаток пустоты, поправив прокрутку на его высоту.
function closeReserve(reserve) {
  if (!reserve?.isConnected) return;
  const left = parseFloat(reserve.style.height) || 0;
  reserve.remove();
  if (left > 0) window.scrollBy(0, -left);
}

// ---------- место в чате при переходах между вкладками ----------
//
// Переписка живёт в памяти, пока открыт сайт, — вместе с подгруженной
// историей. Но при возврате во вкладку чат рисовался заново и прыгал
// вниз: листать вверх приходилось сначала.
//
// Теперь при уходе запоминаем, какое сообщение было наверху и где
// именно, а при возврате ставим его туда же.
let savedSpot = null;

export function rememberChatSpot() {
  if (!messagesEl?.isConnected) return;

  const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160;
  if (atBottom) { savedSpot = null; persistChat(); return; }   // был внизу — вниз и вернёмся

  const headH = document.getElementById("navHost")?.getBoundingClientRect().bottom || 0;
  const anchor = [...messagesEl.querySelectorAll(".chat-msg")]
    .find(el => el.getBoundingClientRect().bottom > headH + 4);
  if (!anchor) return;

  savedSpot = { id: anchor.dataset.id, top: anchor.getBoundingClientRect().top };
  persistChat();
}

function restoreChatSpot() {
  const spot = savedSpot;
  savedSpot = null;
  if (!spot || !messagesEl) return;

  const el = messagesEl.querySelector(`.chat-msg[data-id="${spot.id}"]`);
  if (!el) return;   // сообщение успели удалить — останемся где есть

  window.scrollBy(0, el.getBoundingClientRect().top - spot.top);

  // Картинки и вложения ещё дочитываются и меняют высоту выше — держим
  // найденное место, пока всё не устаканится.
  holdViewport(messagesEl, 2500);
}

// ---------- переписка переживает перезагрузку ----------
//
// Между вкладками сайта переписка живёт в памяти. Но перезагрузка
// страницы память обнуляет — и подгруженная история, и место пропадали.
//
// Поэтому храним их ещё и в хранилище вкладки браузера: оно переживает
// перезагрузку, но не закрытие вкладки — лишнего не копится.
//
// Две сложности. Время сообщений — особые объекты базы, в текст они
// не превращаются: переводим в число и обратно. А курсор подгрузки —
// ссылка на документ, её не сохранить вовсе: вместо неё храним время
// самого старого сообщения, и подгрузка продолжается от него.

const CHAT_STORE = "nyash_chat_state";
const STORE_MAX = 400;               // сколько сообщений хранить
const STORE_FRESH = 2 * 60 * 60 * 1000;   // старше двух часов — не восстанавливаем
let reachedStart = false;           // дошли ли до начала переписки
let restoredOnce = false;

// Время из базы → число; всё остальное — как есть, вглубь.
function packValue(v) {
  if (v && typeof v.toMillis === "function") return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(packValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = packValue(v[k]);
    return out;
  }
  return v;
}

// Число → объект времени, который понимает весь остальной код.
function unpackValue(v) {
  if (v && typeof v === "object" && "__ts" in v && Object.keys(v).length === 1) {
    const ms = v.__ts;
    return { toMillis: () => ms, toDate: () => new Date(ms) };
  }
  if (Array.isArray(v)) return v.map(unpackValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = unpackValue(v[k]);
    return out;
  }
  return v;
}

function oldestLoadedAt() {
  let min = Infinity;
  for (const m of lastMessages) {
    const t = m.createdAt?.toMillis?.();
    if (t && t < min) min = t;
  }
  return Number.isFinite(min) ? min : null;
}

function persistChat() {
  if (!lastMessages.length) return;

  const state = {
    savedAt: Date.now(),
    spot: savedSpot,
    oldestAt: oldestLoadedAt(),
    reachedStart: reachedStart || (!oldestDoc && olderMessages.length > 0),
    msgs: lastMessages.slice(-STORE_MAX).map(packValue)
  };

  // Не влезло — пробуем вдвое меньше: лучше часть истории, чем ничего.
  for (let n = state.msgs.length; n > 20; n = Math.floor(n / 2)) {
    try {
      sessionStorage.setItem(CHAT_STORE, JSON.stringify({ ...state, msgs: state.msgs.slice(-n) }));
      return;
    } catch { /* мало места — урезаем */ }
  }
}

function restoreFromSession() {
  if (restoredOnce || lastMessages.length) return;
  restoredOnce = true;

  let state;
  try { state = JSON.parse(sessionStorage.getItem(CHAT_STORE) || "null"); } catch { return; }
  if (!state?.msgs?.length) return;
  if (Date.now() - (state.savedAt || 0) > STORE_FRESH) return;

  // Всё восстановленное считаем историей: живая подписка добавит свежее
  // и уберёт повторы при первой же порции.
  olderMessages = state.msgs.map(unpackValue);
  lastMessages = olderMessages.slice();
  savedSpot = state.spot || null;
  reachedStart = !!state.reachedStart;

  // Курсор подгрузки — от самого старого сохранённого сообщения.
  oldestDoc = reachedStart || !state.oldestAt ? null : Timestamp.fromMillis(state.oldestAt);
}

// Сохраняем, когда страница уходит: перезагрузка, закрытие, сворачивание.
// На телефоне сворачивание — зачастую последнее, что успевает сработать.
if (typeof window !== "undefined" && !window.__nyashChatPersistHook) {
  window.__nyashChatPersistHook = true;
  const save = () => {
    if (!messagesEl?.isConnected) return;   // чат не открыт — сохранено при уходе
    rememberChatSpot();
    persistChat();
  };
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") save();
  });
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
const APPEAR_MS = TIMING.message.appear;   // столько сообщение считается появляющимся

// Текст сообщения в том виде, в каком он показывается.
//
// Номер трека, уже показанного карточкой, из текста убирается — он
// написан на самой карточке. Раньше это делала только дорисовка треков,
// а каждое обновление сообщения собирало текст заново, с номером, —
// и номер то пропадал, то появлялся, сдвигая строки.
//
// Теперь убираем его здесь же, если трек уже загружен: тогда обновление
// даёт ровно тот же текст, и трогать сообщение незачем.
function visibleText(m) {
  const text = m.text || "";
  const ids = (text.match(/#U3\d{6}/gi) || []).map(t => t.slice(1).toUpperCase());
  const shown = ids.some(id => chatAttachCache.get(id));
  return shown ? text.replace(/\s*#U3\d{6}/gi, "").trim() : text;
}

// Разметка одного сообщения. Вынесена отдельно, чтобы подгружаемую
// историю можно было вставлять по одному сообщению, а не пачкой.
function messageHtml(m, msgs, fresh = new Set()) {
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
    <div class="chat-msg ${m.isBot ? "is-bot" : ""} ${isMine ? "is-mine" : ""} ${fresh.has(m.id) ? "just-came" : ""}" data-id="${m.id}">
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
                        + `<span class="wheel-text">${decorateBotNames(m)}</span>`
                      : m.isBot
                        ? decorateBotNames(m)
                        : linkifyMentions(escapeHtml(visibleText(m)))}</div>` : ""}
      ${imagesToHtml(chatImages(m))}
    </div>`;
}

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
  const html = msgs.map(m => messageHtml(m, msgs, fresh)).join("");

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
    if (el.dataset.wired) return;
    el.dataset.wired = "1";
    el.addEventListener("click", () => playMeow());
  });

  messagesEl.querySelectorAll("[data-channel]").forEach(el => {
    if (el.dataset.wired) return;
    el.dataset.wired = "1";
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

    // Сообщения теперь не пересоздаются при обновлении — значит и вешать
    // обработчики на них нужно один раз. Иначе их набиралось по нескольку,
    // и меню открывалось и тут же закрывалось само.
    if (row.dataset.wired) return;
    row.dataset.wired = "1";

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
  replyingTo = {
    id: msg.id, nickname: msg.nickname, text: msg.text || "(фото)",
    // Кто автор — по его учётной записи, а не по имени: имена бывают
    // одинаковые. У анонимного сообщения записи нет — и не должно быть.
    authorUid: msg.authorUid || null,
    nickColor: msg.authorNickColor || null
  };
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
    openEmojiPicker(form, (emoji) => { input.value += emoji; input.focus(); }, emojiBtn);
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

  // Enter в чате: на телефоне переносит строку (отправка — кнопкой),
  // на компьютере отправляет, а Shift+Enter переносит.
  //
  // Поле стало многострочным, и без этого Enter отправлял сообщение
  // даже там, где человек просто хотел перейти на новую строку.
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    // Enter переносит строку, отправляют сочетания: Shift+Enter
    // или Ctrl+Enter. Одинаково на телефоне и на компьютере — так
    // не приходится помнить, где ты сейчас.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit"));
    }
  });

  // Поле растёт под текст, но не выше трети экрана.
  const growInput = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.3) + "px";
  };
  input.addEventListener("input", growInput);

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
        // Поле к этому моменту уже очищено (см. выше). Не вышло — возвращаем
        // набранное, чтобы длинную команду не набирать заново.
        if (!custom.ok) restoreInput(text);
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

      // Подсказка («через ё») или ошибка команды: сообщение не уходит,
      // а набранное возвращается в поле — поправить одну букву проще,
      // чем набирать всё заново.
      if (parsed?.hint)  { restoreInput(text); showToast(parsed.hint);  return; }
      if (parsed?.error) { restoreInput(text); showToast(parsed.error); return; }

      const imageUrls = images.length ? await uploadImages(images) : [];
      if (imageUrls.some(u => !u)) throw new Error("Одна из картинок не загрузилась");
      // Личность сообщения: аккаунт или анонимный ник. Данные автора копируются
      // в само сообщение, чтобы список не требовал запроса профиля на каждую
      // строку — так же, как это сделано у записей ленты.
      // Пишет ли человек от своего аккаунта — важно и для команд бота:
      // от этого зависит, можно ли показать ссылку на его профиль.
      const speakerIsAccount = !!(asAccount?.checked && currentUser && currentUserDoc);
      const useAccount = !parsed && speakerIsAccount;
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
        // Кто вызвал команду — только если писал от аккаунта. Если писал
        // под анонимным ником, учётную запись сюда не кладём вовсе: база
        // открыта на чтение, и по этому полю было бы видно, кто скрывается
        // за анонимом.
        invokedByUid: (parsed && speakerIsAccount) ? currentUser.uid : null,

        // Участники команды — по учётным записям, а не по именам. Раньше
        // ссылки на имена в ответе бота искались по совпадению ника, и
        // команда на тёзку выглядела так, будто ты применил её к себе.
        botActor: parsed ? {
          name: speakerName,
          uid: speakerIsAccount ? currentUser.uid : null,
          color: speakerIsAccount ? (currentUserDoc.nickColor || null) : null
        } : null,
        botTarget: (parsed && replySnapshot) ? {
          name: replySnapshot.nickname,
          uid: replySnapshot.authorUid || null,
          color: replySnapshot.nickColor || null
        } : null,
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
      input.style.height = "";
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

  // Историю НЕ очищаем — ни загруженные сообщения, ни курсор подгрузки.
  // Раньше здесь всё обнулялось, и при возврате во вкладку чат начинал
  // с нуля: подгруженная история пропадала, и вернуть место было некуда.
  // Закрываем только живую подписку — она держала старую разметку.

  // При возврате не отзываемся мяуканьем на то, что уже видели.
  chatStarted = false;
}
