import { formatDuration } from "./music.js";
import { ICON } from "./icons.js";
import { escapeHtml, showToast } from "./ui.js";

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

function saveState() {
  if (!current || !audio) return;
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({
      track: current,
      position: audio.currentTime || 0,
      playing: !audio.paused,
      queue, queueIndex, repeatMode,
      savedAt: Date.now()
    }));
  } catch {}
}

function clearState() {
  try { localStorage.removeItem(RESUME_KEY); } catch {}
}

// Вызывается при запуске каждой страницы: если что-то играло — продолжаем.
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

  ensureAudio();
  ensureBar();
  current = saved.track;
  audio.src = saved.track.url;
  audio.currentTime = saved.position || 0;
  paintBar(saved.track);

  if (saved.playing) {
    // Браузер может не дать заиграть без действия человека — тогда просто
    // покажем плеер на паузе, и звук пойдёт с первого нажатия.
    audio.play().catch(() => paintPlayState(false));
  } else {
    paintPlayState(false);
  }
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "metadata";
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
  audio.addEventListener("pause", () => { paintPlayState(false); saveState(); });
  return audio;
}

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement("div");
  bar.id = "playerBar";
  bar.className = "player-bar hidden";
  bar.innerHTML = `
    <img class="player-cover" data-cover alt="">
    <button class="player-btn" data-toggle><span class="nf">${ICON.play || "▶"}</span></button>
    <div class="player-info">
      <div class="player-title" data-title></div>
      <div class="player-progress" data-progress>
        <div class="player-progress-fill" data-fill></div>
      </div>
    </div>
    <div class="player-time" data-time>0:00</div>
    <div class="player-menu-wrap">
      <button class="player-btn" data-menu title="ещё"><span class="nf">${ICON.kebab}</span></button>
      <div class="player-menu hidden" data-menu-list>
        <button data-act="shuffle"><span class="nf">${ICON.refresh}</span> Перемешать</button>
        <button data-act="queue"><span class="nf">${ICON.list}</span> Очередь</button>
        <button data-act="repeat"><span class="nf">${ICON.refresh}</span> Повтор</button>
        <button data-act="stop"><span class="nf">${ICON.close}</span> Стоп</button>
      </div>
    </div>`;
  document.body.appendChild(bar);

  bar.querySelector("[data-toggle]").addEventListener("click", togglePlay);
  bar.querySelector("[data-cover]").addEventListener("click", openNowPlaying);

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
      if (btn.dataset.act === "shuffle") { shuffleQueue(); showQueue(); }
      if (btn.dataset.act === "queue") showQueue();
      if (btn.dataset.act === "repeat") {
        const mode = cycleRepeat();
        showToast({ off: "Повтор выключен", all: "Повтор списка", one: "Повтор трека" }[mode]);
      }
    });
  });

  // перемотка нажатием по полосе
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

  current = track;
  audio.src = track.url;
  audio.play().catch(() => {});

  paintBar(track);
  saveState();
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

function paintBar(track) {
  updateMediaSession(track);
  bar.classList.remove("hidden");
  document.body.classList.add("player-open");   // содержимое отъезжает вниз
  bar.querySelector("[data-title]").innerHTML =
    `${escapeHtml(track.title)}${track.artist ? ` <span class="muted">— ${escapeHtml(track.artist)}</span>` : ""}`;

  const cover = bar.querySelector("[data-cover]");
  cover.style.display = track.coverUrl ? "" : "none";
  if (track.coverUrl) cover.src = track.coverUrl;
}

// ---------- очередь ----------

export function setQueue(tracks, startIndex = 0) {
  queue = tracks.map(t => ({ id: t.id, title: t.title, artist: t.artist, url: t.url, coverUrl: t.coverUrl }));
  queueIndex = startIndex;
  if (queue[queueIndex]) playTrack(queue[queueIndex]);
}

// Поставить трек сразу после текущего, не сбивая остальную очередь.
export function queueNext(track) {
  const item = { id: track.id, title: track.title, artist: track.artist,
                 url: track.url, coverUrl: track.coverUrl };
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
  document.querySelectorAll("[data-np-repeat]").forEach(btn => {
    btn.classList.toggle("active", repeatMode !== "off");
    btn.title = label;
    const glyph = btn.querySelector(".nf");
    if (glyph) glyph.textContent = repeatMode === "one" ? ICON.repeatOne : ICON.refresh;
  });
}

export function shuffleQueue() {
  if (queue.length < 2) return;
  const currentTrack = queue[queueIndex];
  const rest = queue.filter((_, i) => i !== queueIndex);
  // перемешивание с конца: каждый элемент честно может оказаться где угодно
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  queue = currentTrack ? [currentTrack, ...rest] : rest;
  queueIndex = 0;
  saveState();
}

export function stop() {
  audio?.pause();
  current = null;
  clearState();
  bar?.classList.add("hidden");
  document.body.classList.remove("player-open");
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
  box.innerHTML = `
    <button class="np-close" data-close><span class="nf">${ICON.close}</span></button>
    <div class="np-cover">
      ${current.coverUrl
        ? `<img src="${current.coverUrl}" alt="">`
        : `<div class="np-cover-empty"><span class="nf">${ICON.music}</span></div>`}
    </div>
    <div class="np-title">${escapeHtml(current.title)}</div>
    <div class="np-artist">${escapeHtml(current.artist || "")}</div>
    <div class="np-progress" data-np-progress><div class="np-fill" data-np-fill></div></div>
    <div class="np-times"><span data-np-now>0:00</span><span data-np-total>—</span></div>
    <div class="np-controls">
      <button class="np-btn" data-np-shuffle title="перемешать"><span class="nf">${ICON.shuffle}</span></button>
      <button class="np-btn" data-np-prev title="назад"><span class="nf">${ICON.left}</span></button>
      <button class="np-btn np-play" data-np-toggle><span class="nf">${ICON.pause}</span></button>
      <button class="np-btn" data-np-next title="дальше"><span class="nf">${ICON.right}</span></button>
      <button class="np-btn" data-np-repeat title="повтор"><span class="nf">${ICON.refresh}</span></button>
    </div>`;
  document.body.appendChild(box);
  document.body.classList.add("np-open");   // полоса уезжает под шапку

  const close = () => {
    box.classList.add("closing");
    document.body.classList.remove("np-open");
    setTimeout(() => box.remove(), 180);
  };
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
    shuffleQueue();
    showToast("Перемешала ♡");
  });
  box.querySelector("[data-np-progress]").addEventListener("click", (e) => {
    if (!audio?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });

  paintProgress();
  paintRepeat();
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
          <button class="queue-item ${i === queueIndex ? "current" : ""}" data-jump="${i}">
            <span class="nf">${i === queueIndex ? ICON.play : ""}</span>
            <span class="queue-title">${escapeHtml(t.title)}</span>
          </button>`).join("")}
      </div>
    </div>`;
  document.body.appendChild(box);

  const close = () => box.remove();
  box.querySelector("[data-close]").addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  box.querySelectorAll("[data-jump]").forEach(btn => {
    btn.addEventListener("click", () => {
      queueIndex = Number(btn.dataset.jump);
      playTrack(queue[queueIndex]);
      close();
    });
  });
}

export function currentTrackId() {
  return current?.id || null;
}

function paintProgress() {
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
