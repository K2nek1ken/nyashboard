// Панель, привязанная к кнопке, не должна вылезать за край окна. Центрировать
// её по экрану — неправильно: теряется связь с точкой, откуда её вызвали.
// Поэтому оставляем на месте и лишь сдвигаем внутрь, если не помещается.
export function keepInViewport(el, margin = 10) {
  if (!el) return;
  // сбрасываем прошлую поправку, иначе они накапливаются при повторных открытиях
  el.style.transform = "";
  const r = el.getBoundingClientRect();
  let dx = 0, dy = 0;

  if (r.right > window.innerWidth - margin) dx = window.innerWidth - margin - r.right;
  if (r.left + dx < margin) dx = margin - r.left;
  if (r.bottom > window.innerHeight - margin) dy = window.innerHeight - margin - r.bottom;
  if (r.top + dy < margin) dy = margin - r.top;

  if (dx || dy) el.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
}
