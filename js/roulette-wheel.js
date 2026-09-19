import { paletteColor } from "./palette.js";

// ============================================================
//  Колесо рулетки
//
//  Крутится перед тем, как бот объявит результат: без этого выпавшее число
//  появляется мгновенно, и игры не чувствуется — просто строка текста.
//
//  Колесо ничего не решает: число уже известно, оно приходит снаружи.
//  Здесь только показ — шарик останавливается ровно на нужном секторе,
//  а не «выбирает» его на самом деле. Иначе картинка и результат могли бы
//  разойтись.
// ============================================================

// Порядок номеров на европейском колесе — он не по возрастанию.
const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];
const RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

const SPIN_MS = 2600;      // столько крутится
const SHRINK_MS = 320;     // столько исчезает

export function spinWheel(number) {
  return new Promise((resolve) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      resolve();   // без движения — сразу к результату
      return;
    }

    const box = document.createElement("div");
    box.className = "roulette-overlay";
    box.innerHTML = `<div class="roulette-wheel">${wheelSvg()}</div>`;
    document.body.appendChild(box);

    const wheel = box.querySelector(".roulette-wheel");
    const ball = box.querySelector("[data-ball]");

    // Куда встать: сектор нужного номера должен оказаться наверху.
    const index = Math.max(0, WHEEL.indexOf(number));
    const step = 360 / WHEEL.length;
    // Несколько полных оборотов сверху — чтобы вращение читалось как вращение,
    // а не как поворот на четверть.
    const target = 360 * 5 + (360 - index * step);

    requestAnimationFrame(() => {
      wheel.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.17,.67,.2,1)`;
      wheel.style.transform = `rotate(${target}deg)`;

      // Шарик крутится в другую сторону: так видно, что он катится по колесу,
      // а не приклеен к нему.
      ball.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.2,.6,.25,1)`;
      ball.style.transform = `rotate(${-360 * 7}deg)`;
    });

    setTimeout(() => {
      box.classList.add("done");     // сжимается в точку
      setTimeout(() => { box.remove(); resolve(); }, SHRINK_MS);
    }, SPIN_MS + 350);               // короткая пауза на «вот оно»
  });
}

function wheelSvg() {
  const step = 360 / WHEEL.length;
  const sectors = WHEEL.map((n, i) => {
    const color = n === 0 ? "#2e8b57" : (RED.has(n) ? "#c0392b" : "#1a1a1a");
    const a1 = (i * step - 90) * Math.PI / 180;
    const a2 = ((i + 1) * step - 90) * Math.PI / 180;
    const x1 = 50 + 48 * Math.cos(a1), y1 = 50 + 48 * Math.sin(a1);
    const x2 = 50 + 48 * Math.cos(a2), y2 = 50 + 48 * Math.sin(a2);
    return `<path d="M50 50 L${x1.toFixed(2)} ${y1.toFixed(2)} A48 48 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}"/>`;
  }).join("");

  const accent = paletteColor("pink");

  return `
    <svg viewBox="0 0 100 100" class="roulette-svg">
      <circle cx="50" cy="50" r="49" fill="#0d0b11"/>
      ${sectors}
      <circle cx="50" cy="50" r="30" fill="#0d0b11" stroke="${accent}" stroke-width="1"/>
      <circle cx="50" cy="50" r="8" fill="${accent}"/>

      <!-- шарик: крутится вокруг центра, поэтому вынесен в свою группу -->
      <g data-ball style="transform-origin:50px 50px;">
        <circle cx="50" cy="12" r="3.4" fill="#fff"/>
      </g>

      <!-- указатель сверху: показывает, какой сектор считается выпавшим -->
      <polygon points="50,2 46,10 54,10" fill="${accent}"/>
    </svg>`;
}
