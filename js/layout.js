import { ICON } from "./icons.js";
import { getSettings } from "./settings.js";
import { defaultAvatar } from "./default-avatar.js";

// Единая навигация для всех страниц. Раньше шапка была скопирована в каждый из
// 10 HTML-файлов — любая правка означала 10 одинаковых редактирований и риск,
// что где-то забудешь. Теперь разметка живёт тут, а страницы содержат только
// <div id="navHost"></div>.
//
// Разметка ОДНА и та же для телефона и ПК — различается только CSS: на узком
// экране это горизонтальная полоса сверху, на широком — вертикальная колонка
// слева (см. медиа-запрос в style.css). Так не нужно ни дублировать DOM, ни
// перерисовывать его при ресайзе окна.
const NAV_ITEMS = {
  feed:    { href: "index.html",   label: "Лента",   icon: ICON.home },
  chat:    { href: "chat.html",    label: "Чат",     icon: ICON.comment },
  friends: { href: "friends.html", label: "Друзья",  icon: ICON.users },
  content: { href: "content.html", label: "Контент", icon: ICON.hash },
  people:  { href: "people.html",  label: "Люди",    icon: ICON.user }
};

// какие страницы подсвечивают какой пункт (подстраницы наследуют родителя)
const ACTIVE_ALIASES = {
  "post.html": "index.html",
  "channel.html": "content.html",
  "my-channels.html": "content.html",
  "user.html": "people.html",
  "tag.html": "index.html",
  "dm.html": "friends.html",
  "profile.html": "",
  "settings.html": ""
};

export function initLayout() {
  const host = document.getElementById("navHost");
  if (!host) return;

  const page = location.pathname.split("/").pop() || "index.html";
  const activeHref = ACTIVE_ALIASES[page] !== undefined ? ACTIVE_ALIASES[page] : page;

  const settings = getSettings();
  // порядок задаётся в настройках; неизвестные ключи игнорируем, забытые
  // дописываем в конец — так добавление новой вкладки не сломает сохранённый
  // у человека порядок
  const order = [
    ...settings.tabOrder.filter(k => NAV_ITEMS[k]),
    ...Object.keys(NAV_ITEMS).filter(k => !settings.tabOrder.includes(k))
  ].filter(k => k !== "friends" || settings.showFriends === "on");

  host.innerHTML = `
    <a class="brand" href="index.html">
      <span class="brand-mark">♡</span>
      <span class="brand-text">Nyash<span>Board</span></span>
    </a>
    <nav id="navTabs">
      ${order.map(key => {
        const item = NAV_ITEMS[key];
        return `
        <a class="navBtn ${item.href === activeHref ? "active" : ""}" href="${item.href}">
          <span class="nf">${item.icon}</span><span class="navBtn-label">${item.label}</span>
        </a>`;
      }).join("")}
    </nav>
    <div id="profileIcon" class="profile-icon" title="профиль">
      <img id="profilePic" src="${defaultAvatar()}" data-default-avatar="neko" alt="профиль">
    </div>`;
}

// ================== Падающие звёздочки на фоне ==================
// Лёгкий canvas: несколько десятков полупрозрачных звёздочек, медленно плывущих
// по диагонали и крутящихся вокруг своей оси. Рисуем в фоновый слой под всем
// контентом; при prefers-reduced-motion не запускаем вообще.
export function initStarfield() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (document.documentElement.dataset.particles === "off") return;

  const canvas = document.createElement("canvas");
  canvas.id = "starfield";
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");

  let stars = [];
  let raf = null;
  // берём акцент из текущей темы, а не хардкодим — иначе при смене темы
  // звёзды остались бы сиреневыми на любом фоне
  const starColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--accent").trim() || "#e88fd0";
  // stars | flowers | leaves — выбирается в настройках
  const particleKind = document.documentElement.dataset.particles || "stars";

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // на узких экранах звёзд меньше — и чтобы не сорить, и чтобы не грузить батарею
    const count = window.innerWidth < 900 ? 18 : 42;
    stars = Array.from({ length: count }, () => spawn(true));
  }

  function spawn(anywhere) {
    return {
      x: Math.random() * window.innerWidth,
      y: anywhere ? Math.random() * window.innerHeight : -20,
      size: 4 + Math.random() * 7,
      speed: 0.12 + Math.random() * 0.28,
      drift: 0.06 + Math.random() * 0.18,   // горизонтальный снос — движение по диагонали
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.012,  // вращение вокруг своей оси
      alpha: 0.10 + Math.random() * 0.22
    };
  }

  // три вида частиц; какой рисовать — берётся из настроек
  const PAINTERS = {
    stars(s) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? s.size : s.size * 0.45;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const px = Math.cos(a) * r, py = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    },
    flowers(s) {
      // пять лепестков вокруг серединки — силуэт ✿
      const petal = s.size * 0.55;
      for (let i = 0; i < 5; i++) {
        const a = (Math.PI * 2 / 5) * i;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * petal, Math.sin(a) * petal,
                    s.size * 0.42, s.size * 0.62, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = Math.min(1, s.alpha * 2.2);
      ctx.beginPath();
      ctx.arc(0, 0, s.size * 0.26, 0, Math.PI * 2);
      ctx.fill();
    },
    leaves(s) {
      // лист: два дуговых края + прожилка
      ctx.beginPath();
      ctx.moveTo(0, -s.size);
      ctx.quadraticCurveTo(s.size * 0.85, 0, 0, s.size);
      ctx.quadraticCurveTo(-s.size * 0.85, 0, 0, -s.size);
      ctx.fill();
      ctx.globalAlpha = Math.min(1, s.alpha * 2);
      ctx.strokeStyle = starColor;
      ctx.lineWidth = Math.max(0.6, s.size * 0.09);
      ctx.beginPath();
      ctx.moveTo(0, -s.size * 0.85);
      ctx.lineTo(0, s.size * 0.85);
      ctx.stroke();
    }
  };

  function drawStar(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = starColor;
    (PAINTERS[particleKind] || PAINTERS.stars)(s);
    ctx.restore();
  }

  function tick() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.y += s.speed;
      s.x += s.drift;
      s.angle += s.spin;
      if (s.y - s.size > window.innerHeight || s.x - s.size > window.innerWidth) {
        stars[i] = spawn(false);
      }
      drawStar(s);
    }
    raf = requestAnimationFrame(tick);
  }

  resize();
  window.addEventListener("resize", resize);
  // не жжём батарею, когда вкладка не видна
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = null; }
    else if (!raf) tick();
  });
  tick();
}
