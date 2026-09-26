import { paletteColor } from "./palette.js";
import { TIMING } from "./modules/animation.js";

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
// Длительности живут в modules/animation.js — там их можно поменять,
// не заглядывая сюда.
const APPEAR_MS = 420;
const SPIN_MS = TIMING.wheel.spin;
const HOLD_MS = TIMING.wheel.hold;
const SHRINK_MS = TIMING.wheel.shrink;

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

  const wheel = slot.querySelector("[data-sectors]");
  const ball = slot.querySelector("[data-ball]");

  // Каждое вращение — своё.
  //
  // Раньше колесо всегда делало ровно восемь оборотов и вставало точно
  // по центру сектора: отличалась только доля последнего оборота, и на
  // глаз это выглядело одной записанной анимацией.
  //
  // Обороты, точка остановки и ход шарика — общим расчётом (spinAngles):
  // так все три места, где показывается колесо, крутят его одинаково
  // живо, и правка одного не расходится с остальными.
  const angles = spinAngles(number, key || "");
  const target = angles.wheel;
  const left = Math.max(120, SPIN_MS - elapsed);

  // Если колесо уже крутилось, начинаем не с нуля, а с той точки, до которой
  // оно должно было дойти. Так перерисовка не сбрасывает вращение —
  // оно просто продолжается.
  const progress = Math.min(1, elapsed / SPIN_MS);
  const from = target * easeOut(progress);

  wheel.style.transform = `rotate(${from}deg)`;
  ball.style.transform = `rotate(${angles.ball * easeOut(progress)}deg)`;

  requestAnimationFrame(() => {
    slot.classList.remove("appearing");

    wheel.style.transition = `transform ${left}ms ${TIMING.wheel.spinEasing}`;
    wheel.style.transform = `rotate(${target}deg)`;

    ball.style.transition = `transform ${Math.max(100, left - 300)}ms cubic-bezier(.1,.7,.2,1)`;
    ball.style.transform = `rotate(${angles.ball}deg)`;
  });

  setTimeout(() => slot.classList.add("done"), (SPIN_MS + HOLD_MS) - elapsed);

  // Когда колесо растворилось, сообщение плавно принимает свой обычный
  // размер, и только потом проступает текст. Без этого высота менялась
  // рывком, а буквы возникали из ниоткуда.
  setTimeout(() => morphToText(slot), (SPIN_MS + HOLD_MS + SHRINK_MS) - elapsed);
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
    const wheel = row.querySelector("[data-sectors]");
    const ball = row.querySelector("[data-ball]");
    const angles = spinAngles(number, msgId || "");

    // Появление и раскрутка идут одновременно: колесо будто уже крутилось,
    // когда его показали. Если сначала показать неподвижное, а потом
    // тронуть — виден рывок.
    requestAnimationFrame(() => {
      box.classList.remove("appearing");

      wheel.style.transition = `transform ${SPIN_MS}ms ${TIMING.wheel.spinEasing}`;
      wheel.style.transform = `rotate(${angles.wheel}deg)`;

      // Шарик крутится в другую сторону и останавливается чуть раньше
      // колеса — как будто докатывается по нему.
      ball.style.transition = `transform ${SPIN_MS - 300}ms cubic-bezier(.1,.7,.2,1)`;
      ball.style.transform = `rotate(${angles.ball}deg)`;
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

    const wheel = box.querySelector("[data-sectors]");
    const ball = box.querySelector("[data-ball]");

    // Куда и сколько крутить — общим расчётом: обороты и точка остановки
    // каждый раз свои. Здесь бросок разовый, поэтому признак берём от
    // текущего времени.
    const angles = spinAngles(number, String(Date.now()));
    const target = angles.wheel;

    requestAnimationFrame(() => {
      wheel.style.transition = `transform ${SPIN_MS}ms ${TIMING.wheel.spinEasing}`;
      wheel.style.transform = `rotate(${target}deg)`;

      // Шарик крутится в другую сторону: так видно, что он катится по колесу,
      // а не приклеен к нему.
      ball.style.transition = `transform ${SPIN_MS - 300}ms cubic-bezier(.1,.7,.2,1)`;
      ball.style.transform = `rotate(${angles.ball}deg)`;
    });

    setTimeout(() => {
      box.classList.add("done");     // сжимается в точку
      setTimeout(() => { box.remove(); resolve(); }, SHRINK_MS);
    }, SPIN_MS + HOLD_MS);           // пауза на «вот оно»
  });
}

// Замедление к концу — то же, что в самой анимации. Нужно, чтобы вычислить,
// где колесо должно быть сейчас, если оно уже какое-то время крутится.
// Превращает ключ в число: из него берём обороты и точку остановки.
// Один и тот же ключ даёт то же вращение — поэтому перерисовка не сбивает
// колесо на полпути.
// Куда и сколько крутить. Один расчёт на все три места, где показывается
// колесо: в сообщении, на месте команды и во весь экран.
//
// Число оборотов и остановка внутри сектора каждый раз свои — иначе
// колесо крутится одинаково, и это видно: движение перестаёт читаться
// как бросок и выглядит заставкой.
//
// Разброс привязан к самому броску (по его признаку), а не случаен при
// каждой отрисовке: иначе перерисовка меняла бы угол на лету, и колесо
// дёргалось бы посреди вращения.
function spinAngles(number, seed = "") {
  const index = Math.max(0, WHEEL.indexOf(number));
  const step = 360 / WHEEL.length;
  const base = `${number}|${seed}`;

  const spins = 7 + (hashOf(base + "|s") % 5);        // колесо: 7–11 оборотов
  const ballSpins = 9 + (hashOf(base + "|b") % 5);    // шарик — своим счётом

  // Остановка не ровно по центру сектора, а чуть в стороне — как будто
  // шарик улёгся куда пришлось. В пределах сектора: число не меняется.
  const offset = (hashOf(base + "|o") % 100) / 100 * step * 0.7 - step * 0.35;

  // Наверх должен встать ЦЕНТР сектора, поэтому к повороту добавляется
  // половина сектора: без неё указатель приходился на стык двух чисел.
  return {
    wheel: 360 * spins + (360 - index * step) - step / 2 + offset,
    ball: -360 * ballSpins
  };
}

function hashOf(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

function wheelSvg() {
  const step = 360 / WHEEL.length;

  // Сектора остаются красно-чёрными: рулетка узнаётся именно по ним,
  // и перекрасить их под тему — значит сделать её неузнаваемой.
  // Под тему идёт только оправа, сердцевина и шарик.
  const sectors = WHEEL.map((n, i) => {
    const color = n === 0 ? "#2e8b57" : (RED.has(n) ? "#c0392b" : "#1c1a20");
    const a1 = (i * step - 90) * Math.PI / 180;
    const a2 = ((i + 1) * step - 90) * Math.PI / 180;
    const x1 = 50 + 48 * Math.cos(a1), y1 = 50 + 48 * Math.sin(a1);
    const x2 = 50 + 48 * Math.cos(a2), y2 = 50 + 48 * Math.sin(a2);
    return `<path d="M50 50 L${x1.toFixed(2)} ${y1.toFixed(2)} A48 48 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}"/>`;
  }).join("");

  // Цвет берём из темы, а не вписываем: при «Абсолютном ничего» или
  // другом выбранном оттенке розовая сердцевина смотрелась чужеродно.
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue("--accent").trim() || paletteColor("pink");
  const deep = style.getPropertyValue("--bg").trim() || "#0d0b11";

  return `
    <svg viewBox="0 0 100 100" class="roulette-svg">
      <circle cx="50" cy="50" r="49" fill="${deep}"/>
      <!-- Крутится именно эта группа, а не весь рисунок.
           Раньше поворот применялся ко всему <svg> — вместе с шариком.
           Шарик вращался вместе с колесом и всегда оставался над тем же
           сектором, над которым нарисован, то есть над зеро. Поэтому
           колесо, куда бы ни «остановилось», показывало зеро. -->
      <g data-sectors style="transform-origin:50px 50px;">
        ${sectors}
      </g>
      <circle cx="50" cy="50" r="30" fill="${deep}" stroke="${accent}" stroke-width="1"/>
      <circle cx="50" cy="50" r="8" fill="${accent}"/>
      <!-- тонкая оправа по краю: связывает колесо с остальным оформлением -->
      <circle cx="50" cy="50" r="48.4" fill="none" stroke="${accent}"
              stroke-width="1.2" opacity=".65"/>

      <!-- шарик: крутится вокруг центра, поэтому вынесен в свою группу -->
      <g data-ball style="transform-origin:50px 50px;">
        <!-- Шарик светлый по цвету текста: на светлой теме белый на белом
             был бы не виден. -->
        <circle cx="50" cy="12" r="3.4" fill="${style.getPropertyValue("--text").trim() || "#fff"}"/>
      </g>

    </svg>`;
}


// Плавно заменяет колесо текстом сообщения.
//
// Высота у элемента с текстом не анимируется сама: браузер не умеет
// переходить от одной «автоматической» высоты к другой. Поэтому сначала
// закрепляем нынешнюю, потом ставим конечную — и только тогда переход
// виден как переход, а не как скачок.
function morphToText(slot) {
  const box = slot.parentElement;      // .txt
  if (!box) return;

  const from = box.offsetHeight;
  slot.remove();

  // Текст всё это время был в сообщении, просто спрятан — показываем.
  box.querySelector(".wheel-text")?.classList.add("shown");

  const to = box.offsetHeight;         // сколько займёт текст
  if (Math.abs(to - from) < 2) { box.classList.add("text-in"); return; }

  // Ширину пузыря тоже ведём: с колесом он узкий, с текстом шире.
  const bubble = box.closest(".chat-msg");
  const wFrom = bubble?.offsetWidth;

  box.style.height = from + "px";
  box.classList.add("morphing");
  if (bubble && wFrom) {
    bubble.style.maxWidth = wFrom + "px";
    bubble.classList.add("morph-box");
  }

  requestAnimationFrame(() => {
    box.style.height = to + "px";
    box.classList.add("text-in");
    if (bubble) bubble.style.maxWidth = "";   // вернётся к своему размеру плавно
  });

  // Высоту снимаем после перехода: оставленная жёсткой, она сломала бы
  // сообщение, если текст потом изменится.
  setTimeout(() => {
    box.style.height = "";
    box.classList.remove("morphing", "text-in");
    bubble?.classList.remove("morph-box");
  }, TIMING.wheel.morph + 40);
}
