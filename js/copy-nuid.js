import { showToast } from "./ui.js";

// ============================================================
//  Копирование идентификаторов нажатием
//
//  Номер вида U1666777 показывается в профиле, на карточках треков и работ.
//  Чаще всего с ним делают ровно одно — отправляют кому-то, поэтому нажатие
//  сразу кладёт его в буфер.
//
//  Обработчик один на весь документ: элементы появляются и исчезают при
//  переходах между вкладками, и вешать его на каждый заново значило бы
//  терять при первой же перерисовке.
// ============================================================

// U0 — записи, U1 — люди, U2 — сообщения, U3 — треки, U4 — каналы, U5 — работы.
// Раньше здесь начиналось с единицы, и номера записей не копировались.
const NUID_PATTERN = /^U[0-5]\d{6}$/i;

export async function copyNuid(value, label = "NUID") {
  const text = (value || "").trim();
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} скопирован ♡`);
  } catch {
    // Современный способ доступен не везде — оставляем запасной, иначе
    // на части устройств нажатие молча ничего не делало бы.
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;opacity:0;";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    showToast(ok ? `${label} скопирован ♡` : text);
  }
}

let wired = false;

export function initNuidCopy() {
  if (wired) return;
  wired = true;

  document.addEventListener("click", (e) => {
    // Ищем помеченный элемент или просто текст, похожий на номер.
    const marked = e.target.closest("[data-copy-nuid], .track-nuid, .uid-display");
    if (!marked) return;

    const value = marked.dataset.copyNuid || marked.textContent || "";
    const clean = value.replace(/^#/, "").trim();
    if (!NUID_PATTERN.test(clean)) return;

    e.preventDefault();
    e.stopPropagation();
    copyNuid(clean);
  });

  // Подсказка при наведении — чтобы было понятно, что элемент нажимается
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.(".track-nuid, .uid-display, [data-copy-nuid]");
    if (el && !el.title) el.title = "нажми, чтобы скопировать";
  });
}
