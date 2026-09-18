// ============================================================
//  Раскладка ленты
//
//  Как записи расставляются по колонкам на широком экране и как появляются
//  при загрузке. Про сами записи ничего не знает: получает готовую разметку
//  и раскладывает её.
//
//  Колонки нужны, чтобы на широком экране лента не была узкой полосой
//  посередине. Высоты выравниваются по оценке: точно измерить до отрисовки
//  нельзя, а после — поздно, записи уже прыгнут.
// ============================================================

// Ширина, уже которой запись читается плохо. От неё считается число колонок.
const MIN_COLUMN = 330;

export function columnCount(container) {
  // Ширина берётся у самого списка, но в момент первой отрисовки он может быть
  // ещё нулевым — тогда опираемся на окно за вычетом колонки навигации.
  let width = container?.clientWidth || 0;
  if (!width) {
    const sidebar = window.innerWidth >= 900 ? 320 : 0;
    width = Math.max(0, window.innerWidth - sidebar - 80);
  }
  if (!width) return 1;
  return Math.max(1, Math.min(3, Math.floor(width / MIN_COLUMN)));
}
// Примерная высота записи. Точную до отрисовки знать нельзя, но для раскладки
// хватает оценки: важно лишь понимать, какая запись заметно выше остальных.
function estimateHeight(p) {
  let h = 110;                                  // шапка, кнопки, поле ответа
  const text = p.text || "";
  h += Math.min(320, Math.ceil(text.length / 48) * 21);   // строки текста
  if ((p.imageUrls?.length || p.imageUrl) ? 1 : 0) h += 250;  // карусель фиксированной высоты
  if (/#U3\d{6}/i.test(text)) h += 90;           // прикреплённый трек
  return h;
}
// Раскладка по колонкам. Записи идут по порядку, но каждая следующая ложится
// в самую короткую колонку — иначе две записи с фотографиями подряд попадали
// в одну и вытягивали её вдвое, оставляя рядом пустоту.
//
// Порядок чтения при этом сохраняется: первые записи всё равно занимают начала
// колонок слева направо, потому что пустая колонка всегда самая короткая.
export function layoutPosts(container, posts, buildHtml) {
  const cols = columnCount(container);
  if (cols === 1) {
    container.innerHTML = posts.map(buildHtml).join("");
    container.classList.remove("has-columns");
    return;
  }

  const buckets = Array.from({ length: cols }, () => []);
  const heights = new Array(cols).fill(0);

  posts.forEach(p => {
    // из равных по высоте выбираем самую левую — так первые записи
    // раскладываются слева направо, как и читаются
    let target = 0;
    for (let i = 1; i < cols; i++) {
      if (heights[i] < heights[target] - 1) target = i;
    }
    buckets[target].push(buildHtml(p));
    heights[target] += estimateHeight(p);
  });

  container.innerHTML = buckets
    .map(items => `<div class="feed-column">${items.join("")}</div>`)
    .join("");
  // Помечаем классом, а не полагаемся на проверку вложенности в стилях:
  // так поведение одинаково во всех браузерах.
  container.classList.add("has-columns");
}
// Оценка высоты приблизительная, поэтому после отрисовки смотрим, что вышло
// на самом деле, и если одна колонка сильно длиннее — переносим в короткую
// нижние записи. Двигаем только с конца: верх ленты трогать нельзя, там
// самое важное, и записи не должны прыгать под уже читающим человеком.
export function balanceColumns(container) {
  const columns = [...container.querySelectorAll(".feed-column")];
  if (columns.length < 2) return;

  for (let pass = 0; pass < 4; pass++) {
    const heights = columns.map(c => c.offsetHeight);
    const tallest = heights.indexOf(Math.max(...heights));
    const shortest = heights.indexOf(Math.min(...heights));
    const gap = heights[tallest] - heights[shortest];

    // перекос меньше высоты средней записи выравнивать незачем
    if (gap < 260) return;

    const last = columns[tallest].lastElementChild;
    if (!last) return;
    // перенос не должен сделать короткую колонку длиннее длинной
    if (last.offsetHeight > gap) return;

    columns[shortest].appendChild(last);
  }
}
// Записи появляются по очереди сверху вниз, а не все разом: так список
// выглядит живым и глазу проще зацепиться за первую карточку, пока
// подтягиваются остальные. Задержка небольшая и с потолком — иначе на длинной
// ленте нижние карточки ждали бы неприлично долго.
export function revealSequentially(container) {
  const cards = container.querySelectorAll(".post-card");
  cards.forEach((card, i) => {
    card.classList.add("appearing");
    setTimeout(() => card.classList.remove("appearing"), Math.min(i * 45, 600));
  });
}
