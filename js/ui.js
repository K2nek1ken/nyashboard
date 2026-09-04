let toastTimer = null;
export function showToast(text) {
  const el = document.getElementById("toast");
  el.textContent = text;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
}

export function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Часовой пояс: «auto» — как на устройстве, иначе фиксированное смещение
// от UTC. Форматируем вручную, потому что toLocaleString умеет только
// именованные зоны, а тут нужен именно сдвиг.
function formatWithTz(ms) {
  const tz = document.documentElement.dataset.tz || "auto";
  if (tz === "auto") {
    const d = new Date(ms);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit",
      ...(sameYear ? {} : { year: "numeric" }),
      hour: "2-digit", minute: "2-digit"
    });
  }
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
  if (!m) return new Date(ms).toLocaleString("ru-RU");
  const offsetMin = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const shifted = new Date(ms + offsetMin * 60000);
  const p = (n) => String(n).padStart(2, "0");
  const sameYear = shifted.getUTCFullYear() === new Date(Date.now() + offsetMin * 60000).getUTCFullYear();
  const date = `${p(shifted.getUTCDate())}.${p(shifted.getUTCMonth() + 1)}` +
               (sameYear ? "" : `.${shifted.getUTCFullYear()}`);
  return `${date}, ${p(shifted.getUTCHours())}:${p(shifted.getUTCMinutes())}`;
}

export function timeAgo(ts) {
  if (!ts) return "";
  const t = ts.toMillis ? ts.toMillis() : ts;

  // Точный формат — по настройке. Кому-то принципиально видеть реальное время,
  // а не «пару часов назад», поэтому это переключатель, а не жёсткий выбор.
  if (document.documentElement.dataset.time === "exact") return formatWithTz(t);

  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return `${d} дн назад`;
}

// Полная дата — для подсказки при наведении, независимо от настройки
export function exactTime(ts) {
  if (!ts) return "";
  return formatWithTz(ts.toMillis ? ts.toMillis() : ts);
}

// ============================================================
//  Родовые формы
//
//  Раньше по всему интерфейсу было захардкожено женское «пиши первой»,
//  «репостнула» — это работало ровно для одного человека. Теперь форма
//  берётся из настройки: мужская, женская или нейтральная со скобками.
// ============================================================
let genderGetter = () => "x";

// вызывается один раз при старте: подставляет источник (профиль или настройки)
export function setGenderSource(fn) { genderGetter = fn; }

// gendered("первым", "первой", "первым(ой)")
export function gendered(male, female, neutral) {
  const g = genderGetter();
  if (g === "m") return male;
  if (g === "f") return female;
  return neutral ?? `${male}(${female.slice(male.length - 1) || female})`;
}
