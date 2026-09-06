import { formatDuration } from "./music.js";
import { ICON } from "./icons.js";
import { escapeHtml } from "./ui.js";

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

let audio = null;
let bar = null;
let current = null;

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = "metadata";
  audio.addEventListener("timeupdate", paintProgress);
  audio.addEventListener("ended", () => { paintPlayState(false); });
  audio.addEventListener("play", () => paintPlayState(true));
  audio.addEventListener("pause", () => paintPlayState(false));
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
    <button class="player-btn" data-close><span class="nf">${ICON.close}</span></button>`;
  document.body.appendChild(bar);

  bar.querySelector("[data-toggle]").addEventListener("click", togglePlay);
  bar.querySelector("[data-close]").addEventListener("click", stop);

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

  bar.classList.remove("hidden");
  document.body.classList.add("player-open");   // содержимое отъезжает вниз
  bar.querySelector("[data-title]").innerHTML =
    `${escapeHtml(track.title)}${track.artist ? ` <span class="muted">— ${escapeHtml(track.artist)}</span>` : ""}`;

  const cover = bar.querySelector("[data-cover]");
  cover.style.display = track.coverUrl ? "" : "none";
  if (track.coverUrl) cover.src = track.coverUrl;
}

export function stop() {
  audio?.pause();
  current = null;
  bar?.classList.add("hidden");
  document.body.classList.remove("player-open");
  document.querySelectorAll("[data-track-play].playing")
    .forEach(b => b.classList.remove("playing"));
}

function togglePlay() {
  if (!audio) return;
  audio.paused ? audio.play().catch(() => {}) : audio.pause();
}

export function currentTrackId() {
  return current?.id || null;
}

function paintProgress() {
  if (!bar || !audio?.duration) return;
  const ratio = audio.currentTime / audio.duration;
  bar.querySelector("[data-fill]").style.width = `${ratio * 100}%`;
  bar.querySelector("[data-time]").textContent = formatDuration(audio.currentTime);

  // прогресс дублируется на карточке трека, если она на экране
  const card = document.querySelector(`[data-track="${current?.id}"] .track-progress-fill`);
  if (card) card.style.width = `${ratio * 100}%`;
}

function paintPlayState(playing) {
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
