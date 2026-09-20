import { formatDuration } from "./music.js";
import { ICON } from "./icons.js";
import { escapeHtml, showToast, closeOverlay } from "./ui.js";
import { defaultCover } from "./default-avatar.js";

// ============================================================
//  Плеер
//
//  Одна полоса под шапкой, общая на весь сайт. Она не перекрывает содержимое,
//  а отодвигает его вниз — иначе в чате под ней пряталось бы первое сообщение,
//  а в ленте первая запись.
//
//  Сам звук живёт в одном элементе на всё приложение: переход между вкладками
//  сайта его не прерывает, пока страница не перезагружена.
// ============================================================

// ============================================================
//  Проигрывание между страницами
//
//  Переход на другую вкладку сайта — это перезагрузка страницы, и звук
//  обрывается. Поэтому при уходе запоминаем трек и место в нём, а при
//  запуске сразу продолжаем с того же места.
//
//  Пауза после перехода — неизбежная плата за раздельные страницы: браузер
//  всё равно останавливает звук. Но человек возвращается ровно туда, где был.
// ============================================================
const RESUME_KEY = "nyash_player";

let audio = null;
let bar = null;
let current = null;
let queue = [];          // очередь: что играет дальше
let queueIndex = -1;
let repeatMode = "off"; // off | one | all
let shuffled = false;   // перемешивание — режим, а не одноразовое действие
let orderedQueue = [];  // исходный порядок, чтобы было куда вернуться

function saveState() {
  if (!current || !audio) return;
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({
      track: current,
      position: audio.currentTime || 0,
      playing: !audio.paused,
      queue, queueIndex, repeatMode, shuffled, orderedQueue,
      expanded: !!document.getElementById("nowPlaying"),
      savedAt: Date.now()
    }));
  } catch {}
}

function clearState() {
  try { localStorage.removeItem(RESUME_KEY); } catch {}
}

// Вызывается при запуске каждой страницы: если что-то играло — продолжаем.
// Вход мог произойти после запуска плеера — тогда состояние сердечка
// нужно запросить заново.
if (typeof window !== "undefined") {
  import("./auth.js").then(({ onAuthChange }) => {
    onAuthChange(() => { if (current) refreshFavState(current); });
  }).catch(() => {});
}

export function restorePlayback() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(RESUME_KEY)); } catch { return; }
  if (!saved?.track?.url) return;

  // Слишком старую запись не восстанавливаем: человек давно ушёл, и внезапно
  // заигравшая музыка была бы неожиданностью.
  if (Date.now() - (saved.savedAt || 0) > 6 * 60 * 60 * 1000) { clearState(); return; }

  queue = saved.queue || [];
  queueIndex = saved.queueIndex ?? -1;
  repeatMode = saved.repeatMode || "off";
  shuffled = !!saved.shuffled;
  orderedQueue = saved.orderedQueue || [];
  setTimeout(() => { paintRepeat(); paintShuffle(); }, 0);   // кнопки появляются позже состояния

  ensureAudio();
  ensureBar();
  current = saved.track;
  audio.src = saved.track.url;
  audio.currentTime = saved.position || 0;
  paintBar(saved.track);

  // Развёрнутый вид восстанавливаем следом: он не мешает и не сворачивается
  // сам, значит и после перезагрузки должен остаться открытым.
  // На телефоне развёрнутый вид занимает весь экран: открывать его сразу
  // после загрузки — значит закрыть человеку страницу, на которую он шёл.
  // Поэтому восстанавливаем только там, где он стоит карточкой сбоку.
  if (saved.expanded && window.matchMedia("(min-width: 900px)").matches) {
    setTimeout(() => { if (current) openNowPlaying(); }, 0);
  }

  if (saved.playing) {
    // Браузер не даёт заиграть, пока человек не сделал хоть что-то на странице.
    // Поэтому пробуем сразу, а если откажут — ждём первого касания или нажатия
    // и продолжаем с того же места. Для человека это выглядит так, будто
    // музыка просто не прерывалась.
    audio.play().catch(() => {
      paintPlayState(false);

      const resume = () => {
        audio.play().then(() => cleanup()).catch(() => {});
      };
      const cleanup = () => {
        document.removeEventListener("pointerdown", resume);
        document.removeEventListener("keydown", resume);
        document.removeEventListener("touchstart", resume);
      };
      document.addEventListener("pointerdown", resume, { once: false });
      document.addEventListener("keydown", resume, { once: false });
      document.addEventListener("touchstart", resume, { once: false });
    });
  } else {
    paintPlayState(false);
  }
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();

  // Загружаем сам файл, а не только его описание. С «metadata» браузер
  // держал в памяти лишь длительность, и любая перемотка — даже в начало,
  // где уже всё проиграно, — уходила за новой порцией. На слабой связи это
  // давало заметную паузу на ровном месте.
  audio.preload = "auto";
  audio.addEventListener("timeupdate", () => {
    paintProgress();
    updateMediaPosition();
    // раз в несколько секунд запоминаем место — чаще незачем
    if (Math.floor(audio.currentTime) % 4 === 0) saveState();
  });
  audio.addEventListener("ended", () => {
    paintPlayState(false);
    playNextInQueue();
  });
  audio.addEventListener("play", () => { paintPlayState(true); saveState(); });
  audio.addEventListener("seeked", () => {
    document.querySelectorAll(".player-progress, .np-progress")
      .forEach(el => el.classList.remove("loading"));
  });
  audio.addEventListener("pause", () => { paintPlayState(false); saveState(); });
  return audio;
}

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement("div");
  bar.id = "playerBar";
  bar.className = "player-bar hidden";
  // Кнопка воспроизведения — прямо на обложке: так понятнее, чем отдельная
  // кнопка рядом, и освобождается место под остальное.
  bar.innerHTML = `
    <div class="player-cover-wrap" data-cover-wrap>
      <img class="player-cover" data-cover alt="">
      <button class="player-cover-btn" data-toggle><span class="nf">${ICON.play}</span></button>
    </div>
    <div class="player-time" data-time>0:00</div>
    <button class="player-btn" data-repeat title="повтор"><span class="nf">${ICON.refresh}</span></button>
    <button class="player-btn" data-shuffle title="перемешать"><span class="nf">${ICON.shuffle}</span></button>
    <div class="player-menu-wrap">
      <button class="player-btn" data-menu title="данго (⋮) — ещё"><span class="nf">${ICON.more}</span></button>
      <div class="player-menu hidden" data-menu-list>
        <button data-act="queue"><span class="nf">${ICON.list}</span> Очередь</button>
        <button data-act="stop"><span class="nf">${ICON.close}</span> Стоп</button>
      </div>
    </div>
    <button class="player-fav" data-fav title="в любимое"><span class="nf">${ICON.heart}</span></button>
    <button class="player-expand" data-expand title="развернуть">
      <span class="nf" data-expand-icon>${ICON.down}</span>
    </button>
    <div class="player-info">
      <div class="player-title" data-title></div>
    </div>
    <div class="player-progress" data-progress>
      <div class="player-progress-fill" data-fill></div>
    </div>`;
  document.body.appendChild(bar);

  bar.querySelector("[data-toggle]").addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
  });
  // На компьютере плеер разворачивается вверх, на телефоне — вниз.
  // Стрелка должна показывать туда же, куда он откроется.
  const expandIcon = bar.querySelector("[data-expand-icon]");
  const pointExpand = () => {
    const up = window.matchMedia("(min-width: 900px)").matches;
    expandIcon.textContent = up ? ICON.up : ICON.down;
  };
  pointExpand();
  window.addEventListener("resize", pointExpand);

  bar.querySelector("[data-expand]").addEventListener("click", openNowPlaying);

  // Добавить играющий трек в любимое, не уходя со страницы.
  bar.querySelector("[data-fav]").addEventListener("click", async () => {
    if (!current) return;
    try {
      const { toggleFavorite } = await import("./music.js");
      const added = await toggleFavorite(current);
      paintFavState(added);
      showToast(added ? "В любимом ♡" : "Убрано из любимого");
    } catch (e) {
      showToast(e.message || "Войди, чтобы добавлять в любимое");
    }
  });
  bar.querySelector("[data-shuffle]").addEventListener("click", () => {
    showToast(toggleShuffle() ? "Перемешала ♡" : "Обычный порядок");
  });
  bar.querySelector("[data-repeat]").addEventListener("click", () => {
    const mode = cycleRepeat();
    showToast({ off: "Повтор выключен", all: "Повтор списка", one: "Повтор трека" }[mode]);
  });

  // Обе кнопки-режима должны сразу показывать своё состояние: иначе
  // перемешивание всегда выглядит включённым, хотя на деле выключено.
  paintRepeat();
  paintShuffle();

  const menuBtn = bar.querySelector("[data-menu]");
  const menuList = bar.querySelector("[data-menu-list]");
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuList.classList.toggle("hidden");
  });
  document.addEventListener("click", () => menuList.classList.add("hidden"));

  menuList.querySelectorAll("[data-act]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      menuList.classList.add("hidden");
      if (btn.dataset.act === "stop") stop();

      if (btn.dataset.act === "queue") showQueue();

    });
  });

  // перемотка нажатием по полосе
  wireScrub(
    bar.querySelector("[data-progress]"),
    bar.querySelector("[data-fill]"),
    (sec) => { const t = bar.querySelector("[data-time]"); if (t) t.textContent = formatDuration(sec); }
  );

  bar.querySelector("[data-progress]").addEventListener("click", (e) => {
    if (!audio?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  return bar;
}

export function playTrack(track) {
  ensureAudio();
  ensureBar();

  if (current?.id === track.id) { togglePlay(); return; }

  // Трек, которого нет в очереди, заменяет её собой: продолжать прежнюю
  // после него было бы неожиданно — человек выбрал другое.
  const inQueue = queue.findIndex(t => t.id === track.id);
  if (inQueue >= 0) {
    queueIndex = inQueue;
  } else {
    queue = [{
      id: track.id, title: track.title || "Без названия",
      artist: track.artist || "", url: track.url, coverUrl: track.coverUrl || null
    }];
    queueIndex = 0;
  }

  current = { ...track, title: track.title || "Без названия", artist: track.artist || "" };
  audio.src = track.url;
  audio.play().catch(() => {});

  paintBar(track);
  saveState();
  refreshFavState(track);
  paintNowPlaying();          // если развёрнутый вид открыт — обновляем и его
}

// ============================================================
//  Управление из системы
//
//  Браузер умеет отдавать сведения о треке операционной системе: на телефоне
//  появляется уведомление с обложкой и кнопками, на компьютере — плитка в
//  системных медиаклавишах. Тем же путём работают кнопки на наушниках и
//  гарнитуре.
//
//  Без этого пауза с наушников либо не работает вовсе, либо ставит на паузу
//  что-то другое.
// ============================================================
function updateMediaSession(track) {
  if (!("mediaSession" in navigator)) return;

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || "Без названия",
      artist: track.artist || "NyashBoard",
      album: "NyashBoard",
      artwork: track.coverUrl
        ? [{ src: track.coverUrl, sizes: "512x512", type: "image/jpeg" }]
        : [{ src: "assets/favicon.svg", sizes: "any", type: "image/svg+xml" }]
    });

    const handlers = {
      play: () => audio?.play().catch(() => {}),
      pause: () => audio?.pause(),
      previoustrack: () => playPrevInQueue(),
      nexttrack: () => playNextInQueue(),
      stop: () => stop(),
      seekto: (e) => { if (audio && e.seekTime != null) audio.currentTime = e.seekTime; },
      seekbackward: (e) => { if (audio) audio.currentTime = Math.max(0, audio.currentTime - (e.seekOffset || 10)); },
      seekforward: (e) => { if (audio) audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (e.seekOffset || 10)); }
    };

    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); }
      catch { /* часть действий поддерживается не везде — это нормально */ }
    }
  } catch (e) {
    console.warn("Системное управление недоступно:", e.message);
  }
}

// Положение в треке для системной полосы перемотки
function updateMediaPosition() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!audio?.duration || !isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      playbackRate: audio.playbackRate || 1,
      position: Math.min(audio.currentTime, audio.duration)
    });
  } catch { /* значения могли разъехаться при смене трека */ }
}

// Показывает, лежит ли играющий трек в любимом.
function paintFavState(inFavorites) {
  const btn = bar?.querySelector("[data-fav] .nf");
  if (btn) btn.textContent = inFavorites ? ICON.heartFilled : ICON.heart;
  bar?.querySelector("[data-fav]")?.classList.toggle("active", !!inFavorites);
}

async function refreshFavState(track) {
  try {
    // Ждём подтверждения входа: при восстановлении плеера состояние
    // запрашивалось раньше него, список любимого приходил пустым — и
    // сердечко оставалось незакрашенным, хотя трек там был.
    const { authReady, currentUser } = await import("./auth.js");
    await authReady;
    if (!currentUser) { paintFavState(false); return; }

    const { loadFavorites } = await import("./music.js");
    const favs = await loadFavorites();
    paintFavState(favs.some(t => t.id === track.id));
  } catch { paintFavState(false); }
}

// Высота плеера меняется: на телефоне он в два ряда, на компьютере живёт
// в колонке. Отдаём её стилям, чтобы содержимое отодвигалось ровно на
// столько, сколько он занимает, а не на заранее вписанное число.
// Когда плеер появляется или уходит, меняется отступ страницы — и всё
// содержимое сдвигается. Если просто дать этому произойти, список поедет
// под рукой: ты читаешь запись, а она уезжает.
//
// Поэтому вместе с отступом сдвигаем и саму прокрутку на ту же величину.
// Для человека ничего не происходит: страница остаётся ровно там, где была,
// а плеер приезжает поверх.
function shiftScrollBy(delta) {
  if (!delta) return;
  // В самом верху ничего не двигаем: там сдвигать некуда, и попытка
  // «компенсировать» как раз и давала тот рывок вниз-вверх.
  if (window.scrollY <= 1) return;
  window.scrollBy({ top: delta, behavior: "instant" });
}

function reportPlayerHeight() {
  if (!bar) return;

  // Ставим сразу примерное значение, не дожидаясь замера: иначе между
  // появлением плеера и первым кадром содержимое успевает мелькнуть
  // у него под низом.
  const root = document.documentElement.style;
  if (!root.getPropertyValue("--player-height")) {
    root.setProperty("--player-height", "116px");
  }

  const apply = () => {
    // Берём нижнюю границу плеера, а не его высоту: он стоит не у самого
    // верха, а под шапкой. По одной высоте отступ выходил меньше нужного
    // ровно на это смещение, и плеер накрывал верх страницы.
    const rect = bar.getBoundingClientRect();
    const bottom = Math.round(rect.bottom);
    if (bottom <= 0) return;

    const prev = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--player-height")
    ) || 0;

    document.documentElement.style.setProperty("--player-height", bottom + "px");

    // Отступ страницы задаём напрямую. Через переменную он уже задан
    // в стилях, но там его легко перебивает какое-нибудь более позднее
    // правило — а так видно точно, и спорить не с чем.
    // Отступ вешаем на сам контейнер страницы, а не на всю страницу.
    //
    // У страницы задана высота во весь экран, и отступ сверху там ведёт
    // себя не так, как ожидаешь: содержимое не сдвигается, а плеер
    // продолжает накрывать первую запись. У контейнера таких причуд нет.
    const app = document.getElementById("app");
    if (!app) return;

    if (window.matchMedia("(min-width: 900px)").matches) {
      // На компьютере плеер в колонке слева — сдвигать нечего.
      app.style.paddingTop = "";
      document.body.style.paddingTop = "";
    } else {
      app.style.paddingTop = (bottom + 10 - 56) + "px";   // 56 — место шапки
      document.body.style.paddingTop = "";
    }

    // Компенсируем прокрутку, только если плеер уже был и просто изменил
    // высоту — например, стал в два ряда. При появлении компенсировать
    // нельзя: содержимое как раз и должно отъехать вниз, а иначе
    // отступ есть, но страница следом прокручивается, и записи снова
    // оказываются под плеером.
    if (prev && Math.abs(bottom - prev) < 60) shiftScrollBy(bottom - prev);
  };
  // Первое измерение — на следующем кадре: сразу после вставки браузер
  // ещё не разложил элемент, и размеры вышли бы нулевыми.
  requestAnimationFrame(apply);

  if (bar.dataset.measured) return;
  bar.dataset.measured = "1";
  if ("ResizeObserver" in window) new ResizeObserver(apply).observe(bar);
  else window.addEventListener("resize", apply);
}

function paintBar(track) {
  reportPlayerHeight();
  // Состояние сердечка узнаём после отрисовки полосы: до неё кнопки ещё нет,
  // и отметка просто некуда было ставить.
  setTimeout(() => refreshFavState(track), 0);
  updateMediaSession(track);
  bar.classList.remove("hidden");
  // Появляется плавно, а не возникает рывком: класс снимается на следующем
  // кадре, иначе браузер не заметит смены состояния и анимации не будет.
  bar.classList.add("entering");
  document.body.classList.add("player-open");   // содержимое отъезжает вниз
  requestAnimationFrame(() => bar?.classList.remove("entering"));
  // Пустые значения не должны превращаться в «undefined» на экране:
  // у восстановленного из памяти трека часть полей может отсутствовать.
  const title = track.title || "Без названия";
  const artist = track.artist || "";
  bar.querySelector("[data-title]").innerHTML =
    `${escapeHtml(title)}${artist ? ` <span class="muted">— ${escapeHtml(artist)}</span>` : ""}`;

  // Обложка есть всегда: у треков без своей рисуется цветная с нотой,
  // иначе нажимать было бы не на что.
  bar.querySelector("[data-cover]").src = track.coverUrl || defaultCover(track.id || track.title);
}

// ---------- очередь ----------

export function setQueue(tracks, startIndex = 0) {
  // Очередь задаётся целиком: playTrack ниже увидит трек в ней и не станет
  // заменять её одним элементом.
  // Пустые поля заменяем сразу: иначе после восстановления из памяти
  // на экране появлялось «undefined».
  queue = tracks.map(t => ({
    id: t.id, title: t.title || "Без названия", artist: t.artist || "",
    url: t.url, coverUrl: t.coverUrl || null
  }));
  queueIndex = startIndex;
  orderedQueue = queue.slice();

  // Если перемешивание включено, новый список тоже перемешиваем: режим
  // остаётся режимом, а не сбрасывается при смене подборки.
  //
  // Здесь важно не трогать сам флаг: раньше он сбрасывался в «выключено»
  // перед вызовом переключателя, и при каждой новой подборке режим начинался
  // заново. Со стороны выглядело так, будто перемешивание только включается
  // и никогда не выключается.
  if (shuffled) reshuffleKeepingMode();
  if (queue[queueIndex]) playTrack(queue[queueIndex]);
}

// Поставить трек сразу после текущего, не сбивая остальную очередь.
export function queueNext(track) {
  const item = { id: track.id, title: track.title || "Без названия",
                 artist: track.artist || "", url: track.url,
                 coverUrl: track.coverUrl || null };
  if (!queue.length) { setQueue([track], 0); return; }
  // если этот трек уже стоит в очереди — просто передвигаем его вперёд
  const existing = queue.findIndex(t => t.id === track.id);
  if (existing >= 0) queue.splice(existing, 1);
  queue.splice(queueIndex + 1, 0, item);
  saveState();
}

export function getQueue() {
  return { tracks: queue, index: queueIndex };
}

export function playNextInQueue() {
  if (queueIndex < 0 || !queue.length) return false;

  // Повтор одного: возвращаем то же место и играем заново.
  if (repeatMode === "one") {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return true;
  }

  if (queueIndex + 1 < queue.length) {
    queueIndex += 1;
  } else if (repeatMode === "all") {
    queueIndex = 0;              // круг замкнулся — начинаем сначала
  } else {
    return false;
  }
  playTrack(queue[queueIndex]);
  return true;
}

export function playPrevInQueue() {
  if (queueIndex < 0 || !queue.length) return false;

  // Первые пять секунд трека «назад» возвращает к предыдущему, дальше
  // перематывает текущий в начало. Пять, а не три: в наушниках нажимаешь
  // вслепую и часто не успеваешь попасть в короткое окно.
  if (audio && audio.currentTime > 5) {
    audio.currentTime = 0;
    return true;
  }
  if (queueIndex > 0) queueIndex -= 1;
  else if (repeatMode === "all") queueIndex = queue.length - 1;
  else { audio.currentTime = 0; return true; }

  playTrack(queue[queueIndex]);
  return true;
}

export function cycleRepeat() {
  repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
  saveState();
  paintRepeat();
  return repeatMode;
}

export function getRepeatMode() { return repeatMode; }

function paintRepeat() {
  const label = { off: "повтор выключен", all: "повтор списка", one: "повтор трека" }[repeatMode];

  // Кнопок две — на полосе и в развёрнутом виде. Обновляем обе разом:
  // раньше одна отрисовывалась, а вторая оставалась с прежним значком,
  // и они показывали разное.
  document.querySelectorAll("[data-np-repeat], [data-repeat]").forEach(btn => {
    btn.title = label;
    const glyph = btn.querySelector(".nf");
    if (glyph) glyph.textContent = repeatMode === "one" ? ICON.repeatOne : ICON.refresh;

    btn.classList.toggle("repeat-one", repeatMode === "one");
    btn.classList.toggle("repeat-off", repeatMode === "off");
    btn.classList.toggle("active", repeatMode !== "off");
  });
}

// Перемешивание — состояние, а не разовое действие: включил и выключил.
// При выключении очередь возвращается к тому порядку, в каком была задана,
// иначе исходную последовательность было бы уже не восстановить.
// Перетасовать очередь, оставив режим включённым. Нужно, когда меняется
// подборка: список новый, а «играть вперемешку» человек уже выбрал.
function reshuffleKeepingMode() {
  if (queue.length < 2) return;
  const playing = queue[queueIndex];
  const rest = queue.filter((_, i) => i !== queueIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  queue = playing ? [playing, ...rest] : rest;
  queueIndex = 0;
  saveState();
}

export function toggleShuffle() {
  if (queue.length < 2) { shuffled = !shuffled; paintShuffle(); return shuffled; }

  const playing = queue[queueIndex];

  if (!shuffled) {
    orderedQueue = queue.slice();          // запоминаем, к чему возвращаться

    const rest = queue.filter((_, i) => i !== queueIndex);
    // перемешивание с конца: каждый элемент честно может оказаться где угодно
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    // Играющий трек оставляем первым: прерывать его ради перемешивания
    // никто не просил.
    queue = playing ? [playing, ...rest] : rest;
    queueIndex = 0;
  } else {
    if (orderedQueue.length) queue = orderedQueue.slice();
    // указатель переносим на тот же трек, что и играл
    queueIndex = Math.max(0, queue.findIndex(t => t.id === playing?.id));
  }

  shuffled = !shuffled;
  saveState();
  paintShuffle();
  return shuffled;
}

// Совместимость со старыми вызовами: включить перемешивание.
export function shuffleQueue() {
  if (!shuffled) toggleShuffle();
}

export function isShuffled() { return shuffled; }

function paintShuffle() {
  document.querySelectorAll("[data-shuffle], [data-np-shuffle]").forEach(btn => {
    btn.classList.toggle("repeat-off", !shuffled);   // тот же приглушённый вид
    btn.classList.toggle("active", shuffled);
    btn.title = shuffled ? "перемешано" : "перемешивание выключено";
  });
}

export function stop() {
  // Плеер уезжает под шапку, а не пропадает рывком. Отступ содержимого
  // при этом уменьшается вместе с ним: страница подтягивается плавно,
  // а не прыгает в конце.
  if (bar) {
    const height = bar.getBoundingClientRect().bottom || 0;
    bar.classList.add("leaving");
    document.documentElement.style.setProperty("--player-height", "0px");
    shiftScrollBy(-height);   // страница остаётся на месте, уезжает только плеер
    setTimeout(() => {
      bar?.remove();
      bar = null;
      document.body.classList.remove("player-open");
      document.documentElement.style.removeProperty("--player-height");
      document.body.style.paddingTop = "";
      const appEl = document.getElementById("app");
      if (appEl) appEl.style.paddingTop = "";
    }, 260);
  }

  audio?.pause();
  current = null;
  clearState();

  document.querySelectorAll("[data-track-play].playing")
    .forEach(b => b.classList.remove("playing"));
}

function togglePlay() {
  if (!audio) return;
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}

// Уход со страницы — последний момент запомнить место в треке
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", saveState);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveState(); });
}

// Раскрытый вид: обложка крупно, полоса плеера уезжает под шапку и
// возвращается при закрытии. Нужен, чтобы разглядеть обложку и управлять
// не целясь в узкую строку.
function openNowPlaying() {
  if (!current) return;
  document.getElementById("nowPlaying")?.remove();

  const box = document.createElement("div");
  box.className = "now-playing";
  box.id = "nowPlaying";
  // Содержимое обёрнуто в карточку: крестик крепится к ней, а не к углу
  // экрана — иначе непонятно, что именно он закрывает.
  box.innerHTML = `
    <div class="np-card">
      <button class="np-close" data-close><span class="nf">${ICON.close}</span></button>
      <div class="np-cover">
      <img src="${current.coverUrl || defaultCover(current.id || current.title)}" alt="">
    </div>
    <div class="np-title">${escapeHtml(current.title || "Без названия")}</div>
    <div class="np-artist">${escapeHtml(current.artist || "")}</div>
    <div class="np-progress" data-np-progress><div class="np-fill" data-np-fill></div></div>
    <div class="np-times"><span data-np-now>0:00</span><span data-np-total>—</span></div>
      <div class="np-controls">
        <button class="np-btn" data-np-shuffle title="перемешать"><span class="nf">${ICON.shuffle}</span></button>
        <button class="np-btn" data-np-prev title="назад"><span class="nf">${ICON.left}</span></button>
        <button class="np-btn np-play" data-np-toggle><span class="nf">${ICON.pause}</span></button>
        <button class="np-btn" data-np-next title="дальше"><span class="nf">${ICON.right}</span></button>
        <button class="np-btn" data-np-repeat title="повтор"><span class="nf">${ICON.refresh}</span></button>
      </div>
    </div>`;
  document.body.appendChild(box);
  document.body.classList.add("np-open");   // полоса уезжает под шапку

  // Развёрнутый вид живёт поверх вкладок и переживает переходы: музыка
  // не прерывается, значит и окно с ней закрывать незачем. Закроет его
  // только сам человек.
  box.dataset.persistent = "1";
  saveState();      // запоминаем, что вид открыт

  const close = () => closeOverlay(box, saveState);
  box.querySelector("[data-close]").addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });

  box.querySelector("[data-np-toggle]").addEventListener("click", togglePlay);
  box.querySelector("[data-np-next]").addEventListener("click", () => {
    if (!playNextInQueue()) showToast("Это последний трек");
  });
  box.querySelector("[data-np-prev]").addEventListener("click", () => playPrevInQueue());
  box.querySelector("[data-np-repeat]").addEventListener("click", () => {
    const mode = cycleRepeat();
    showToast({ off: "Повтор выключен", all: "Повтор списка", one: "Повтор трека" }[mode]);
  });
  box.querySelector("[data-np-shuffle]").addEventListener("click", () => {
    showToast(toggleShuffle() ? "Перемешала ♡" : "Обычный порядок");
  });
  wireScrub(
    box.querySelector("[data-np-progress]"),
    box.querySelector("[data-np-fill]"),
    (sec) => { const t = box.querySelector("[data-np-now]"); if (t) t.textContent = formatDuration(sec); }
  );

  box.querySelector("[data-np-progress]").addEventListener("click", (e) => {
    if (!audio?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });

  paintProgress();
  paintRepeat();
  paintShuffle();
}

// Обновляет развёрнутый вид, если он открыт. Раньше он рисовался один раз
// при открытии, и после переключения трека там оставались прежние обложка
// и название.
function paintNowPlaying() {
  const box = document.getElementById("nowPlaying");
  if (!box || !current) return;

  const cover = box.querySelector(".np-cover");
  if (cover) {
    cover.innerHTML = `<img src="${current.coverUrl || defaultCover(current.id || current.title)}" alt="">`;
  }
  const title = box.querySelector(".np-title");
  if (title) title.textContent = current.title || "Без названия";
  const artist = box.querySelector(".np-artist");
  if (artist) artist.textContent = current.artist || "";
}

// Показывает, что играет дальше. Текущий трек выделен — иначе в длинной
// очереди непонятно, где ты сейчас.
function showQueue() {
  document.getElementById("queueModal")?.remove();
  if (!queue.length) { showToast("Очередь пуста"); return; }

  const box = document.createElement("div");
  box.className = "modal";
  box.id = "queueModal";
  box.innerHTML = `
    <div class="modal-content" style="max-width:360px;">
      <button class="closeBtn modalClose" data-close><span class="nf">${ICON.close}</span></button>
      <h2 style="margin-top:0;font-size:17px;">Очередь</h2>
      <div class="queue-list">
        ${queue.map((t, i) => `
          <div class="queue-row ${i === queueIndex ? "current" : ""}" data-sort-id="${t.id}">
            <span class="drag-handle nf" title="перетащи, чтобы переставить">&#xf0c9;</span>
            <button class="queue-item" data-jump="${i}">
              <span class="nf">${i === queueIndex ? ICON.play : ""}</span>
              <span class="queue-title">${escapeHtml(t.title || "Без названия")}</span>
            </button>
            <button class="queue-act" data-up="${i}" title="выше" ${i === 0 ? "disabled" : ""}>
              <span class="nf">${ICON.up}</span>
            </button>
            <button class="queue-act" data-down="${i}" title="ниже" ${i === queue.length - 1 ? "disabled" : ""}>
              <span class="nf">${ICON.down}</span>
            </button>
            <button class="queue-act" data-remove="${i}" title="убрать"><span class="nf">${ICON.close}</span></button>
          </div>`).join("")}
      </div>
    </div>`;
  document.body.appendChild(box);

  const close = () => closeOverlay(box);
  box.querySelector("[data-close]").addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  // Перетаскивание за ручку: порядок в очереди меняется одним движением.
  import("./drag-sort.js").then(({ makeSortable }) => {
    makeSortable(box.querySelector(".queue-list"), {
      handle: ".drag-handle",
      onReorder: (ids) => {
        const playingId = queue[queueIndex]?.id;
        queue = ids.map(id => queue.find(t => t.id === id)).filter(Boolean);
        queueIndex = Math.max(0, queue.findIndex(t => t.id === playingId));
        saveState();
      }
    });
  }).catch(() => {});

  box.querySelectorAll("[data-jump]").forEach(btn => {
    btn.addEventListener("click", () => {
      queueIndex = Number(btn.dataset.jump);
      playTrack(queue[queueIndex]);
      close();
    });
  });

  // Перестановка и удаление прямо в списке: без них очередь только
  // показывала, но не позволяла ничего с собой сделать.
  box.querySelectorAll("[data-up]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.up);
      if (i === 0) return;
      [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]];
      // текущий трек не должен «потеряться» при перестановке
      if (queueIndex === i) queueIndex = i - 1;
      else if (queueIndex === i - 1) queueIndex = i;
      saveState();
      close(); showQueue();
    });
  });

  box.querySelectorAll("[data-down]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.down);
      if (i >= queue.length - 1) return;
      [queue[i], queue[i + 1]] = [queue[i + 1], queue[i]];
      // следим за тем, чтобы играющий трек не потерялся при перестановке
      if (queueIndex === i) queueIndex = i + 1;
      else if (queueIndex === i + 1) queueIndex = i;
      saveState();
      close(); showQueue();
    });
  });

  box.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.remove);
      if (i === queueIndex) { showToast("Нельзя убрать то, что играет"); return; }
      queue.splice(i, 1);
      if (i < queueIndex) queueIndex -= 1;
      saveState();
      close(); showQueue();
    });
  });
}

export function currentTrackId() {
  return current?.id || null;
}

// ============================================================
//  Перемотка перетаскиванием
//
//  Нажал и повёл — метка идёт за пальцем, а звук всё это время продолжает
//  играть как ни в чём не бывало. Перемотка применяется только когда
//  отпустил: иначе трек дёргался бы на каждое движение пальца, а по узкой
//  полосе попасть с первого раза почти невозможно.
//
//  Работает и мышью, и пальцем — события указателя одни на оба случая.
// ============================================================
let scrubbing = false;

function wireScrub(track, fill, onPaintTime) {
  if (!track || track.dataset.scrubWired) return;
  track.dataset.scrubWired = "1";

  // Полоса тонкая, поэтому попасть по ней пальцем трудно — расширяем
  // область захвата за её пределы стилями (см. .player-progress::before).
  const ratioAt = (clientX) => {
    const r = track.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const preview = (clientX) => {
    const ratio = ratioAt(clientX);
    if (fill) fill.style.width = `${ratio * 100}%`;
    if (audio?.duration) onPaintTime?.(ratio * audio.duration);
    return ratio;
  };

  track.addEventListener("pointerdown", (e) => {
    if (!audio?.duration) return;
    e.preventDefault();
    scrubbing = true;
    track.setPointerCapture?.(e.pointerId);
    track.classList.add("scrubbing");
    preview(e.clientX);
  });

  track.addEventListener("pointermove", (e) => {
    if (!scrubbing) return;
    e.preventDefault();
    preview(e.clientX);
  }, { passive: false });

  const finish = (e) => {
    if (!scrubbing) return;
    scrubbing = false;
    track.classList.remove("scrubbing");
    if (!audio?.duration) return;

    const target = ratioAt(e.clientX) * audio.duration;

    // Если это место уже загружено, перемотка мгновенная. Если нет —
    // показываем, что идёт подгрузка, иначе пауза выглядит как зависание.
    if (!isBuffered(target)) track.classList.add("loading");
    audio.currentTime = target;
  };

  track.addEventListener("pointerup", finish);
  track.addEventListener("pointercancel", () => {
    // отмена жеста — возвращаем метку туда, где звук на самом деле
    scrubbing = false;
    track.classList.remove("scrubbing");
    paintProgress();
  });
}

// Загружен ли этот участок: браузер хранит несколько отрезков, и перемотка
// внутри них происходит сразу, без обращения к сети.
function isBuffered(sec) {
  if (!audio?.buffered) return false;
  for (let i = 0; i < audio.buffered.length; i++) {
    if (sec >= audio.buffered.start(i) && sec <= audio.buffered.end(i)) return true;
  }
  return false;
}

function paintProgress() {
  // Пока ведёшь пальцем, метку не трогаем: она должна идти за рукой,
  // а не прыгать обратно к текущему месту звука.
  if (scrubbing) return;
  const np = document.getElementById("nowPlaying");
  if (np && audio?.duration) {
    const ratio = audio.currentTime / audio.duration;
    np.querySelector("[data-np-fill]").style.width = `${ratio * 100}%`;
    np.querySelector("[data-np-now]").textContent = formatDuration(audio.currentTime);
    np.querySelector("[data-np-total]").textContent = formatDuration(audio.duration);
  }
  if (!bar || !audio?.duration) return;
  const ratio = audio.currentTime / audio.duration;
  bar.querySelector("[data-fill]").style.width = `${ratio * 100}%`;
  bar.querySelector("[data-time]").textContent = formatDuration(audio.currentTime);

  // прогресс дублируется на карточке трека, если она на экране
  const card = document.querySelector(`[data-track="${current?.id}"] .track-progress-fill`);
  if (card) card.style.width = `${ratio * 100}%`;
}

function paintPlayState(playing) {
  if ("mediaSession" in navigator) {
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }
  const npBtn = document.querySelector("[data-np-toggle] .nf");
  if (npBtn) npBtn.textContent = playing ? ICON.pause : ICON.play;
  if (bar) {
    bar.querySelector("[data-toggle] .nf").textContent = playing ? (ICON.pause || "❚❚") : (ICON.play || "▶");
  }
  document.querySelectorAll("[data-track-play]").forEach(btn => {
    const isCurrent = btn.dataset.trackPlay === current?.id;
    btn.classList.toggle("playing", isCurrent && playing);
    const glyph = btn.querySelector(".nf");
    if (glyph) glyph.textContent = (isCurrent && playing) ? (ICON.pause || "❚❚") : (ICON.play || "▶");
  });
}
