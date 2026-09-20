// ============================================================
//  Длительности и характер движения
//
//  Здесь только числа. Логики нет — её выполняют chat.js, feed.js
//  и roulette-wheel.js. Значит править можно смело.
//
//  ---- как это работает ----
//
//  Все значения в миллисекундах: 1000 — это секунда.
//  Поставишь 0 — движение пропадёт, останется мгновенная смена.
//
//  «easing» — характер движения. Несколько готовых наборов внизу файла;
//  можно подставить любой из них или написать свой в том же виде.
//
//  ---- что где видно ----
//
//  message.appear   — новое сообщение приезжает снизу
//  message.history  — переписка проявляется при открытии чата
//  message.shift    — соседи расступаются, когда приходит новое
//  post.appear      — записи проявляются в ленте
//  wheel.*          — рулетка: раскрутка, пауза, уход
//
//  Если система просит «уменьшить движение», всё это не проигрывается
//  вовсе — независимо от того, что здесь написано.
// ============================================================

// Характер движения. Первое число — насколько медленно начинается,
// последнее — насколько мягко заканчивается.
export const EASING = {
  // мягкий вылет: быстро трогается, плавно тормозит
  soft:    "cubic-bezier(.2,.8,.3,1)",
  // ровное движение без ускорений
  linear:  "linear",
  // сначала медленно, потом быстро — годится для исчезновения
  away:    "cubic-bezier(.45,0,.7,.2)",
  // долгий выбег — для рулетки: видно, как она замедляется
  wheel:   "cubic-bezier(.12,.72,.15,1)"
};

export const TIMING = {
  message: {
    appear: 1000,      // новое сообщение поднимается снизу
    rise: 22,          // на сколько пикселей — больше число, заметнее движение
    easing: EASING.soft,

    history: 300,      // проявление переписки при открытии
    historyStep: 22,   // задержка между соседними сообщениями
    historyMax: 320,   // но не дольше этого у самого верхнего

    shift: 240,        // соседи расступаются
    shiftEasing: EASING.soft
  },

  post: {
    appear: 420,       // запись проявляется в ленте
    step: 40,          // задержка между соседними
    max: 320,          // потолок задержки
    easing: EASING.soft
  },

  wheel: {
    spin: 3200,        // колесо крутится
    hold: 700,         // стоит на выпавшем числе
    shrink: 560,       // уходит
    morph: 340,        // сообщение принимает свой размер
    spinEasing: EASING.wheel,
    awayEasing: EASING.away
  }
};

// Сколько длится показ рулетки целиком — считается само.
export const WHEEL_TOTAL = TIMING.wheel.spin + TIMING.wheel.hold + TIMING.wheel.shrink;

// Применяет значения к стилям: дальше ими пользуется CSS.
// Вызывается один раз при запуске — см. shell.js.
export function applyTiming() {
  const root = document.documentElement.style;
  const t = TIMING;

  root.setProperty("--msg-appear", t.message.appear + "ms");
  root.setProperty("--msg-rise", t.message.rise + "px");
  root.setProperty("--msg-easing", t.message.easing);
  root.setProperty("--msg-history", t.message.history + "ms");
  root.setProperty("--msg-shift", t.message.shift + "ms");
  root.setProperty("--post-appear", t.post.appear + "ms");
  root.setProperty("--post-easing", t.post.easing);
  root.setProperty("--wheel-shrink", t.wheel.shrink + "ms");
  root.setProperty("--wheel-morph", t.wheel.morph + "ms");
  root.setProperty("--wheel-away", t.wheel.awayEasing);
}
