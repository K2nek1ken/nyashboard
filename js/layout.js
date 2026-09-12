import { ICON } from "./icons.js";
import { tintImage, createAnimatedTint, isAnimated } from "./tint.js";
import { goTo } from "./router.js";
import { getSettings } from "./settings.js";
import { defaultAvatar } from "./default-avatar.js";
import { brandIconUri } from "./favicon.js";
import { showToast } from "./ui.js";
import { playLogoSound } from "./logo-sound.js";

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
  people:  { href: "people.html",  label: "Люди",    icon: ICON.user },
  about:   { href: "about.html",   label: "Возможности", icon: ICON.smile }
};

// какие страницы подсвечивают какой пункт (подстраницы наследуют родителя)
const ACTIVE_ALIASES = {
  "post.html": "index.html",
  "channel.html": "content.html",
  "my-channels.html": "content.html",
  "user.html": "people.html",
  "about.html": "about.html",
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
  ].filter(k => (k !== "friends" || settings.showFriends === "on")
             && (k !== "about"   || settings.showAbout   === "on"));

  host.innerHTML = `
    <button class="brand" id="brandBtn" type="button" title="нажми ♡">
      <img class="brand-icon" src="${brandIconUri()}" alt="" data-brand-icon>
      <span class="brand-text">Nyash<span>Board</span></span>
    </button>
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
      <span class="avatar-wrap" style="width:34px;height:34px;">
        <img id="profilePic" src="${defaultAvatar()}" data-default-avatar="neko" alt="профиль">
      </span>
    </div>`;

  // Логотип теперь кнопка: короткое нажатие мяукает, долгое (или средний клик)
  // уводит на ленту — чтобы не отнимать привычный способ вернуться на главную.
  // Нажатие по вкладке, на которой уже находишься, перезагружало страницу —
  // теперь просто прокручиваем наверх, это заметно приятнее.
  // Нажатие по вкладке, на которой уже находишься, прокручивает наверх.
  // Переходы на другие вкладки перехватывает роутер — здесь ничего делать
  // не нужно, ссылки остаются обычными ссылками.
  host.querySelectorAll(".navBtn.active").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  const brand = host.querySelector("#brandBtn");
  let held = null;
  brand.addEventListener("click", () => {
    showToast(getSettings().logoMessage || "мяу!");
    playLogoSound();   // если человек выбрал свой звук
  });
  brand.addEventListener("dblclick", () => { goTo("index.html"); });
  brand.addEventListener("pointerdown", () => {
    held = setTimeout(() => { held = null; goTo("index.html"); }, 550);
  });
  const cancelHold = () => { if (held) { clearTimeout(held); held = null; } };
  brand.addEventListener("pointerup", cancelHold);
  brand.addEventListener("pointerleave", cancelHold);
}

// ================== Падающие звёздочки на фоне ==================
// Лёгкий canvas: несколько десятков полупрозрачных звёздочек, медленно плывущих
// по диагонали и крутящихся вокруг своей оси. Рисуем в фоновый слой под всем
// контентом; при prefers-reduced-motion не запускаем вообще.

let runningTint = null;

export function initStarfield() {
  // Прошлый холст убираем: настройки могут вызвать перерисовку, и без этого
  // частицы наслаивались бы друг на друга с каждым изменением.
  document.getElementById("starfield")?.remove();
  runningTint?.stop();       // и прошлую анимацию картинки тоже
  runningTint = null;

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

  let lastWidth = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Частицы пересоздаются ТОЛЬКО при смене ширины. На телефоне появление
    // экранной клавиатуры меняет высоту окна и раньше вызывало полное
    // пересоздание — частицы прыгали на новые места при каждом касании поля
    // ввода. Смена высоты сама по себе ничего не ломает: холст просто
    // растягивается, а частицы продолжают лететь.
    const widthChanged = Math.abs(window.innerWidth - lastWidth) > 1;
    lastWidth = window.innerWidth;
    if (!widthChanged && stars.length) return;

    // на узких экранах частиц меньше — и чтобы не сорить, и чтобы не грузить батарею
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

  // Частицы рисуются символами, а не векторными фигурами: так они совпадают
  // с тем, что человек выбрал в настройках, и не превращаются в снежинки из-за
  // моей интерпретации. Текстовые символы красятся акцентом, цветные эмодзи
  // остаются собственных цветов — для лепестков и листьев это как раз к месту.
  const GLYPHS = {
    stars:   null,        // звёзды рисуем векторно: символ ★ выглядит грубее
    petals:  null,        // лепестки — своя картинка, см. petalImage
    flowers: "\u2740",    // ❀ — крупнее и аккуратнее, чем ✿
    leaves:  "\uD83C\uDF41",  // 🍁
    sakura:  "\uD83C\uDF38"   // 🌸
  };

  // Лепесток сакуры по эскизу Неко: два эллипса, обрезанные масками, дают
  // характерную форму с выемкой. Рисуем через картинку, потому что повторять
  // это построение на холсте вручную было бы заметно многословнее.
  let petalImage = null;
  let animatedTint = null;

  // Готов ли источник к отрисовке. У картинки это «загружена», у холста —
  // ненулевой размер: признака загрузки у него нет вовсе.
  function isDrawable(src) {
    if (!src) return false;
    if (src instanceof HTMLCanvasElement) return src.width > 0 && src.height > 0;
    return src.complete && src.naturalWidth > 0;
  }

  // Своя картинка: подгружается из браузера и рисуется вместо готовых форм.
  // Прозрачный PNG и SVG подходят лучше всего — у них нет лишнего фона.
  if (particleKind === "custom") {
    import("./logo-sound.js").then(({ getParticleImage }) => getParticleImage()).then(rec => {
      if (!rec?.blob) return;
      const img = new Image();
      img.onload = () => {
        const mode = getSettings().particleTint || "silhouette";

        // У гифки нельзя взять один кадр и перекрасить его раз навсегда —
        // от анимации ничего не останется. Для таких заводим холст, который
        // сам обновляется, и рисуем частицы с него.
        // Анимированную ведём через обновляемый холст в любом режиме,
        // включая «как есть»: обычная картинка на холсте замирает на первом
        // кадре, каким бы ни было перекрашивание.
        if (isAnimated(rec.name || rec.blob?.type || "")) {
          animatedTint?.stop();
          animatedTint = createAnimatedTint(img, starColor, mode);
          runningTint = animatedTint;
          petalImage = animatedTint.canvas;
          return;
        }
        petalImage = tintImage(img, starColor, mode);
      };
      img.src = URL.createObjectURL(rec.blob);
    }).catch(() => {});
  }

  if (particleKind === "petals") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="120" height="120">
<defs>
<clipPath id="a"><rect x="225.21" y="538.97" width="629.59" height="629.56"/></clipPath>
<clipPath id="b"><rect x="-314.79" y="-314.78" width="629.59" height="629.56"/></clipPath>
</defs>
<g clip-path="url(#a)"><ellipse transform="matrix(1.8962038,0,0,1.8962038,540,463.61077)" rx="158.97" ry="125.17" fill="${starColor}"/></g>
<g transform="matrix(1,0,0,-1,540,226.25592)" clip-path="url(#b)"><ellipse transform="matrix(1.8962038,0,0,1.8962038,0,-390.13331)" rx="158.97" ry="125.17" fill="${starColor}"/></g>
</svg>`;
    petalImage = new Image();
    petalImage.src = "data:image/svg+xml," + encodeURIComponent(svg.replace(/\s+/g, " "));
  }

  function drawGlyph(s, glyph) {
    ctx.font = `${s.size * 2.4}px "Monaspace Neon NF", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, 0, 0);
  }

  function drawVectorStar(s) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? s.size : s.size * 0.45;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const px = Math.cos(a) * r, py = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawStar(s) {
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = starColor;
    const glyph = GLYPHS[particleKind];
    // Источником бывает и картинка, и холст (у гифок — он, потому что кадр
    // обновляется). У холста нет признака «загружено», и проверка на него
    // отбрасывала анимированные вовсе — вместо них рисовались звёздочки.
    const usesImage = particleKind === "petals" || particleKind === "custom";
    if (usesImage && isDrawable(petalImage)) {
      const sz = s.size * 3.4;
      ctx.drawImage(petalImage, -sz / 2, -sz / 2, sz, sz);
    }
    // Пока своя картинка ещё грузится, ничего не подставляем: звёздочки
    // вместо выбранной картинки выглядели как поломка.
    else if (usesImage) { ctx.restore(); return; }
    else if (glyph) drawGlyph(s, glyph);
    else drawVectorStar(s);
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
  // Возврат из фона: браузер мог сам остановить анимацию и очистить холст,
  // поэтому перезапускаем цикл и пересоздаём частицы, если холст обнулился.
  function resume() {
    if (document.hidden) return;
    if (!stars.length) resize();
    if (!raf) tick();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = null; }
    else resume();
  });
  window.addEventListener("pageshow", resume);
  window.addEventListener("focus", resume);
  tick();
}
