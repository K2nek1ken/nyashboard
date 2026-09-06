import { ICON } from "./icons.js";

// ============================================================
//  Кнопки навигации по чату
//
//  Две штуки, и они подстраиваются друг под друга: если обе нужны, кнопка
//  упоминаний встаёт над кнопкой «вниз», если одна — занимает её место.
//
//    ↓          — появляется, когда ты не внизу переписки
//    ответ (N)  — появляется, когда есть непросмотренные упоминания и ответы
//
//  Счётчик уменьшается по мере того, как ты доходишь до каждого из них,
//  а не сбрасывается разом: иначе легко пропустить второе упоминание.
// ============================================================

let pending = [];        // id сообщений, к которым ещё не перешли
let container = null;
let downBtn = null;
let mentionBtn = null;

export function initChatNav(messagesEl) {
  if (container) return;

  container = document.createElement("div");
  container.className = "chat-nav";
  container.innerHTML = `
    <button class="chat-nav-btn mentions hidden" data-mentions>
      <span class="nf">${ICON.reply}</span>
      <span class="chat-nav-count" data-count>0</span>
    </button>
    <button class="chat-nav-btn down hidden" data-down>
      <span class="nf">${ICON.down}</span>
    </button>`;
  document.body.appendChild(container);

  downBtn = container.querySelector("[data-down]");
  mentionBtn = container.querySelector("[data-mentions]");

  downBtn.addEventListener("click", () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  });

  mentionBtn.addEventListener("click", () => {
    const id = pending[0];
    if (!id) return;
    const el = messagesEl.querySelector(`.chat-msg[data-id="${id}"]`);
    if (!el) { pending.shift(); syncMentions(); return; }

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // подсветка на мгновение — чтобы взгляд сразу нашёл нужное сообщение
    el.classList.remove("is-reply-target");
    void el.offsetWidth;
    el.classList.add("is-reply-target");

    pending.shift();
    syncMentions();
  });

  window.addEventListener("scroll", syncDown, { passive: true });
  syncDown();
}

function syncDown() {
  if (!downBtn) return;
  const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
  downBtn.classList.toggle("hidden", atBottom);
  container.classList.toggle("has-down", !atBottom);
}

function syncMentions() {
  if (!mentionBtn) return;
  const count = pending.length;
  mentionBtn.classList.toggle("hidden", count === 0);
  const badge = mentionBtn.querySelector("[data-count]");
  badge.textContent = count;
  // кружок с числом нужен только когда упоминаний больше одного
  badge.classList.toggle("hidden", count < 2);
}

// Отмечает сообщения, которые адресованы человеку: ответы на его сообщения
// и упоминания его юзернейма.
export function trackMentions(msgs, { myUsername, myMessageIds }) {
  if (!container) return;
  const ids = msgs
    .filter(m => {
      if (m.replyToId && myMessageIds.has(m.replyToId)) return true;
      if (myUsername && new RegExp(`@${myUsername}\\b`, "i").test(m.text || "")) return true;
      return false;
    })
    .map(m => m.id);

  // добавляем только новые и только те, что ещё не на экране
  ids.forEach(id => {
    if (pending.includes(id)) return;
    const el = document.querySelector(`.chat-msg[data-id="${id}"]`);
    if (el && isOnScreen(el)) return;
    pending.push(id);
  });
  syncMentions();
}

function isOnScreen(el) {
  const r = el.getBoundingClientRect();
  return r.top >= 0 && r.bottom <= window.innerHeight;
}
