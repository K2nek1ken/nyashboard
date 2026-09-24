import { escapeHtml } from "./ui.js";
import { ICON } from "./icons.js";

// ============================================================
//  Проигрыватель видео (в проверке)
//
//  Простой намеренно: полоса, время, звук, скорость, во весь экран.
//  Приближение щипком отдаёт браузеру — на весь экран он делает это лучше
//  и привычнее, чем самодельное.
//
//  Управление одинаково на телефоне и на компьютере: касание по картинке
//  ставит паузу, полоса перематывает. Ничего, что работало бы только мышью.
// ============================================================

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function videoHtml(video, { poster = "" } = {}) {
  return `
    <div class="video-card" data-video-card>
      <video class="video-el" playsinline preload="metadata"
             ${poster ? `poster="${poster}"` : ""} src="${escapeHtml(video)}"></video>

      <button class="video-big-play" data-big-play><span class="nf">${ICON.play}</span></button>

      <div class="video-controls">
        <button class="video-btn" data-toggle><span class="nf">${ICON.play}</span></button>
        <span class="video-time" data-time>0:00</span>
        <div class="video-progress" data-progress><div class="video-fill" data-fill></div></div>
        <span class="video-time" data-total>—</span>
        <button class="video-btn" data-speed title="скорость">1×</button>
        <button class="video-btn" data-loop title="повторять по кругу"><span class="nf">${ICON.refresh}</span></button>
        <button class="video-btn" data-mute title="звук"><span class="nf">${ICON.music}</span></button>
        <button class="video-btn" data-full title="во весь экран"><span class="nf">${ICON.open}</span></button>
      </div>
    </div>`;
}

export function wireVideo(container) {
  container.querySelectorAll("[data-video-card]").forEach(card => {
    if (card.dataset.wired) return;
    card.dataset.wired = "1";

    const video = card.querySelector(".video-el");
    const bigPlay = card.querySelector("[data-big-play]");
    const toggle = card.querySelector("[data-toggle]");
    const fill = card.querySelector("[data-fill]");
    const time = card.querySelector("[data-time]");
    const total = card.querySelector("[data-total]");
    const speedBtn = card.querySelector("[data-speed]");
    let speedIndex = SPEEDS.indexOf(1);

    const play = () => video.paused ? video.play().catch(() => {}) : video.pause();

    bigPlay.addEventListener("click", play);
    toggle.addEventListener("click", play);
    video.addEventListener("click", play);

    video.addEventListener("play", () => {
      card.classList.add("playing");
      toggle.querySelector(".nf").textContent = ICON.pause;
      // Одновременно играет только одно видео: иначе на странице с несколькими
      // записями звук накладывается.
      document.querySelectorAll(".video-el").forEach(other => {
        if (other !== video && !other.paused) other.pause();
      });
    });
    video.addEventListener("pause", () => {
      card.classList.remove("playing");
      toggle.querySelector(".nf").textContent = ICON.play;
    });

    video.addEventListener("loadedmetadata", () => {
      total.textContent = formatTime(video.duration);
    });
    video.addEventListener("timeupdate", () => {
      if (!video.duration) return;
      fill.style.width = `${(video.currentTime / video.duration) * 100}%`;
      time.textContent = formatTime(video.currentTime);
    });

    card.querySelector("[data-progress]").addEventListener("click", (e) => {
      if (!video.duration) return;
      const r = e.currentTarget.getBoundingClientRect();
      video.currentTime = ((e.clientX - r.left) / r.width) * video.duration;
    });

    speedBtn.addEventListener("click", () => {
      speedIndex = (speedIndex + 1) % SPEEDS.length;
      video.playbackRate = SPEEDS[speedIndex];
      speedBtn.textContent = `${SPEEDS[speedIndex]}×`;
    });

    // Повтор по кругу — без паузы между заходами: короткое видео так
    // смотрится как живая картинка, а не обрывается каждые пару секунд.
    //
    // Браузерный повтор иногда заметно спотыкается на стыке, поэтому
    // подстраховываемся: как только видео кончилось, отматываем в начало
    // и играем дальше сами.
    const loopBtn = card.querySelector("[data-loop]");
    loopBtn.addEventListener("click", () => {
      video.loop = !video.loop;
      loopBtn.classList.toggle("on", video.loop);
      loopBtn.title = video.loop ? "повтор включён" : "повторять по кругу";
    });

    video.addEventListener("ended", () => {
      if (!video.loop) return;
      video.currentTime = 0;
      video.play().catch(() => {});
    });

    card.querySelector("[data-mute]").addEventListener("click", (e) => {
      video.muted = !video.muted;
      e.currentTarget.classList.toggle("off", video.muted);
    });

    card.querySelector("[data-full]").addEventListener("click", () => {
      // На весь экран отдаём браузеру: там уже есть и приближение щипком,
      // и поворот, и жесты — делать своё было бы хуже.
      if (video.requestFullscreen) video.requestFullscreen().catch(() => {});
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();   // iOS
    });
  });
}

function formatTime(sec) {
  if (!isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
