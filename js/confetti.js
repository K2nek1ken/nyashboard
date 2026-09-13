// ============================================================
//  Конфетти
//
//  Квадратики падают по-настоящему: у каждого своя скорость, вращение
//  и сопротивление воздуха. Без этого они выглядели бы как летящие
//  стикеры, а не как брошенная горсть бумажек.
//
//  Рисуются на отдельном холсте поверх страницы, который убирается сам,
//  когда всё упало: держать его постоянно незачем.
// ============================================================

const COLORS = [
  "#e88fd0", "#a98bf0", "#7fc8f0", "#8fe0b0",
  "#f0c674", "#f5a45c", "#e78fa4", "#c986c9"
];

const GRAVITY = 0.35;        // притяжение
const DRAG = 0.987;          // сопротивление воздуха
const FLUTTER = 0.12;        // покачивание при падении

let canvas = null;
let ctx = null;
let pieces = [];
let raf = null;

export function burstConfetti(x, y, count = 34) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  ensureCanvas();

  for (let i = 0; i < count; i++) {
    // Разлёт вверх и в стороны: как если бы горсть подбросили, а не уронили.
    const angle = (-Math.PI / 2) + (Math.random() - 0.5) * 1.9;
    const speed = 6 + Math.random() * 7;

    pieces.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      angle: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.35,
      // фаза покачивания — чтобы бумажки не падали синхронно
      phase: Math.random() * Math.PI * 2,
      life: 1
    });
  }

  if (!raf) raf = requestAnimationFrame(tick);
}

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "confetti-layer";
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
}

function resize() {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function tick() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  pieces = pieces.filter(p => {
    p.vy += GRAVITY;
    p.vx *= DRAG;
    p.vy *= DRAG;

    // покачивание: бумажка ловит воздух то одной стороной, то другой
    p.phase += FLUTTER;
    p.x += p.vx + Math.sin(p.phase) * 0.7;
    p.y += p.vy;
    p.angle += p.spin;

    // начинает таять, только когда ушла за нижний край
    if (p.y > window.innerHeight + 40) p.life -= 0.08;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;

    // Сплющиваем по вертикали в зависимости от поворота: так плоский
    // квадратик читается как бумажка, а не как кубик.
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * Math.abs(Math.cos(p.angle * 0.7)));
    ctx.restore();

    return p.life > 0;
  });

  if (pieces.length) {
    raf = requestAnimationFrame(tick);
  } else {
    // всё упало — убираем холст, чтобы он не висел поверх страницы
    raf = null;
    canvas?.remove();
    window.removeEventListener("resize", resize);
    canvas = null;
    ctx = null;
  }
}
