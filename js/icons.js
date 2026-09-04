// Глифы из Monaspace Neon NF (патченный Nerd Font, набор Font Awesome в PUA).
// Коды стандартные для всех Nerd Fonts, так что если когда-нибудь сменишь шрифт
// на другой патченный — эти константы трогать не придётся.
export const ICON = {
  heart: "\uf08a",        // контур сердца — не лайкнуто
  heartFilled: "\uf004",  // закрашенное — лайкнуто
  comment: "\uf086",      // ответить / чат
  repost: "\uf079",       // репост
  close: "\uf00d",        // ✕
  plus: "\uf067",         // +
  search: "\uf002",       // поиск
  send: "\uf1d8",         // отправить
  attach: "\uf0c6",       // скрепка
  pencil: "\uf040",       // редактировать / сменить ник
  hash: "\uf292",         // канал / хештег
  check: "\uf00c",        // галочка (подписан)
  user: "\uf007",         // юзер
  users: "\uf0c0",        // люди
  gear: "\uf013",         // настройки
  more: "\uf142",         // кебаб-меню (три точки)
  home: "\uf015",         // лента
  back: "\uf060",         // назад
  left: "\uf053",         // карусель влево
  right: "\uf054",        // карусель вправо
  down: "\uf078",         // развернуть
  up: "\uf077",           // свернуть
  smile: "\uf118",        // эмодзи
  image: "\uf03e",        // картинка
  reply: "\uf112",        // ответ на сообщение
  open: "\uf08e",         // открыть пост
  crop: "\uf125"          // кадрировать
};

// Разбитого сердца нет ни в наборе Font Awesome этого патча, ни среди эмодзи
// Monaspace, поэтому рисуем сами. Заодно не зависит от настройки эмодзи и
// красится через currentColor.
export const SVG_ICON = {
  heartBroken: `<svg class="svg-ic" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12.7 5.6 11 8.9l2.6 1.9-2.3 4.3.7.6 2.6-4.6-2.6-1.9 1.9-3.4a5 5 0 0 1 6.6 7.4l-7.8 7.5a1 1 0 0 1-1.4 0l-7.8-7.5A5 5 0 0 1 10.6 4c.8.3 1.5.9 2.1 1.6z"/>
  </svg>`,
  heartBrokenOutline: `<svg class="svg-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M12 6.2a5 5 0 1 0-7 7.1l6.3 6.1a1 1 0 0 0 1.4 0l6.3-6.1a5 5 0 1 0-7-7.1"/>
    <path d="M12.6 5.9 10.9 9.2l2.6 1.9-2.2 4.2" stroke-linejoin="round"/>
  </svg>`
};
