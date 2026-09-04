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

export function timeAgo(ts) {
  if (!ts) return "";
  const t = ts.toMillis ? ts.toMillis() : ts;

  // Точный формат — по настройке. Кому-то принципиально видеть реальное время,
  // а не «пару часов назад», поэтому это переключатель, а не жёсткий выбор.
  if (document.documentElement.dataset.time === "exact") {
    const d = new Date(t);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit",
      ...(sameYear ? {} : { year: "numeric" }),
      hour: "2-digit", minute: "2-digit"
    });
  }

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
  const t = ts.toMillis ? ts.toMillis() : ts;
  return new Date(t).toLocaleString("ru-RU");
}
