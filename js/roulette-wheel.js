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

// Сколько что длится. Вращение намеренно небыстрое: рулетка должна
// ощущаться как рулетка, а не как мигнувшая картинка. Замедление
// к концу делает «остановку» заметной — на ней и держится ожидание.
const APPEAR_MS = 420;     // колесо проявляется и раскручивается
const SPIN_MS = 3200;      // крутится
const HOLD_MS = 700;       // стоит на выпавшем числе — чтобы успеть увидеть
const SHRINK_MS = 560;     // уходит

// Сколько длится показ целиком. Отсюда его берут все, кому нужно знать,
// когда колесо закончит: раньше чат держал своё число, оно расходилось
// с настоящим на десятые доли — и колесо успевало запуститься второй раз.
//
// Меняешь длительности выше — всё остальное подстраивается само.
export const WHEEL_TOTAL_MS = SPIN_MS + HOLD_MS + SHRINK_MS;

// Ставит колесо в подготовленное место и раскручивает его.
//
// Место создаёт сам чат при отрисовке, а не эта функция: разметка там
// пересоздаётся при каждом обновлении, и колесо, вставленное со стороны,
// стиралось первым же новым сообщением — успевало мелькнуть и пропасть.
// Когда какое колесо начало крутиться. Разметка чата пересоздаётся
// по нескольку раз подряд, и без этой памяти колесо заводилось заново
// при каждой перерисовке — дёргалось и начинало сначала.
const startedAt = new Map();

export function mountWheel(slot, number, key = null) {
  if (!slot || slot.dataset.mounted) return;
  slot.dataset.mounted = "1";

  // Сколько это колесо уже крутится. Для нового — ноль.
  const id = key || slot.dataset.spin;
  if (!startedAt.has(id)) startedAt.set(id, Date.now());
  const elapsed = Date.now() - startedAt.get(id);

  // Докрутилось ещё до того, как дошли руки его показать.
  if (elapsed >= SPIN_MS + HOLD_MS) { slot.remove(); return; }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    slot.remove();
    return;
  }

  slot.innerHTML = wheelSvg();
  slot.classList.add("appearing");

  const wheel = slot.querySelector(".roulette-svg");
  const ball = slot.querySelector("[data-ball]");
  const index = Math.max(0, WHEEL.indexOf(number));
  const step = 360 / WHEEL.length;

  // Сколько осталось крутиться: сообщение могло прийти с задержкой,
  // и досматривать полное вращение с опозданием было бы странно.
  const target = 360 * 8 + (360 - index * step);
  const left = Math.max(120, SPIN_MS - elapsed);

  // Если колесо уже крутилось, начинаем не с нуля, а с той точки, до которой
  // оно должно было дойти. Так перерисовка не сбрасывает вращение —
  // оно просто продолжается.
  const progress = Math.min(1, elapsed / SPIN_MS);
  const from = target * easeOut(progress);

  wheel.style.transform = `rotate(${from}deg)`;
  ball.style.transform = `rotate(${-360 * 11 * easeOut(progress)}deg)`;

  requestAnimationFrame(() => {
    slot.classList.remove("appearing");

    wheel.style.transition = `transform ${left}ms cubic-bezier(.12,.72,.15,1)`;
    wheel.style.transform = `rotate(${target}deg)`;

    ball.style.transition = `transform ${Math.max(100, left - 300)}ms cubic-bezier(.1,.7,.2,1)`;
    ball.style.transform = `rotate(${-360 * 11}deg)`;
  });

  setTimeout(() => slot.classList.add("done"), (SPIN_MS + HOLD_MS) - elapsed);
}

// Крутит колесо на месте сообщения: текст пока скрыт, вместо него колесо.
// Так его видят все в чате, а не только тот, кто играл.
export function spinInPlace(container, msgId, number) {
  const find = () => container?.querySelector(`.chat-msg[data-id="${msgId}"] .txt`);

  // Сообщение появляется не мгновенно — ждём, пока подписка его принесёт.
  let tries = 0;
  const attach = () => {
    const row = find();
    if (!row) {
      if (++tries < 40) return setTimeout(attach, 100);
      return;   // не дождались — просто покажем текст
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const text = row.innerHTML;
    row.innerHTML = `<div class="wheel-inline appearing">${wheelSvg()}</div>`;

    const box = row.querySelector(".wheel-inline");
    const wheel = row.querySelector(".roulette-svg");
    const ball = row.querySelector("[data-ball]");
    const index = Math.max(0, WHEEL.indexOf(number));
    const step = 360 / WHEEL.length;

    // Появление и раскрутка идут одновременно: колесо будто уже крутилось,
    // когда его показали. Если сначала показать неподвижное, а потом
    // тронуть — виден рывок.
    requestAnimationFrame(() => {
      box.classList.remove("appearing");

      wheel.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.12,.72,.15,1)`;
      wheel.style.transform = `rotate(${360 * 8 + (360 - index * step)}deg)`;

      // Шарик крутится в другую сторону и останавливается чуть раньше
      // колеса — как будто докатывается по нему.
      ball.style.transition = `transform ${SPIN_MS - 300}ms cubic-bezier(.1,.7,.2,1)`;
      ball.style.transform = `rotate(${-360 * 11}deg)`;
    });

    setTimeout(() => {
      box.classList.add("done");
      setTimeout(() => { row.innerHTML = text; }, SHRINK_MS);
    }, SPIN_MS + HOLD_MS);
  };

  attach();
}

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
    const target = 360 * 8 + (360 - index * step);

    requestAnimationFrame(() => {
      wheel.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.12,.72,.15,1)`;
      wheel.style.transform = `rotate(${target}deg)`;

      // Шарик крутится в другую сторону: так видно, что он катится по колесу,
      // а не приклеен к нему.
      ball.style.transition = `transform ${SPIN_MS - 300}ms cubic-bezier(.1,.7,.2,1)`;
      ball.style.transform = `rotate(${-360 * 11}deg)`;
    });

    setTimeout(() => {
      box.classList.add("done");     // сжимается в точку
      setTimeout(() => { box.remove(); resolve(); }, SHRINK_MS);
    }, SPIN_MS + HOLD_MS);           // пауза на «вот оно»
  });
}

// Замедление к концу — то же, что в самой анимации. Нужно, чтобы вычислить,
// где колесо должно быть сейчас, если оно уже какое-то время крутится.
function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
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

    </svg>`;
}
