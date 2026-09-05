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

// Ставит панель рядом с её кнопкой. Раньше положение задавалось в CSS жёсткими
// координатами, и на разных макетах панель оказывалась то под интерфейсом, то
// в противоположном углу. Считать от самой кнопки надёжнее: где кнопка — там и
// панель, независимо от того, вверху она в строке или внизу боковой колонки.
export function positionNear(el, anchorEl, { gap = 8, prefer = "bottom", align = "right" } = {}) {
  if (!el || !anchorEl) return;
  el.style.transform = "";
  el.style.top = el.style.bottom = el.style.left = el.style.right = "auto";

  const a = anchorEl.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  const margin = 10;

  // по вертикали: под кнопкой, а если не влезает — над ней
  let top = prefer === "bottom" ? a.bottom + gap : a.top - h - gap;
  if (top + h > window.innerHeight - margin) top = a.top - h - gap;
  if (top < margin) top = Math.min(a.bottom + gap, window.innerHeight - h - margin);

  // по горизонтали: либо правые края совпадают, либо левые — смотря что удобнее
  // для конкретного места. В боковой колонке кнопка узкая, и выравнивание по
  // правому краю уводило панель далеко влево, за пределы самой колонки.
  let left = align === "left" ? a.left : a.right - w;
  if (left + w > window.innerWidth - margin) left = window.innerWidth - margin - w;
  if (left < margin) left = margin;

  el.style.position = "fixed";
  el.style.top = `${Math.round(Math.max(margin, top))}px`;
  el.style.left = `${Math.round(left)}px`;
}
