// Небольшой набор эмодзи без внешних библиотек — их тут пара сотен, для
// подписи к сообщению и статуса в профиле этого с головой.
export const EMOJI = [
  "♡","💗","💖","💜","💙","💚","💛","🧡","❤️","🖤","🤍","✨","⭐","🌟","💫","🔥",
  "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩",
  "😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤗","🤭","🤫","🤔","🤐","😐",
  "😑","😶","😏","😒","🙄","😬","😮","😯","😲","🥱","😴","🤤","😪","😵","🤯","🥴",
  "😢","😭","😤","😠","😡","🤬","😰","😨","😱","🥺","😳","🤗","🫠","🫡","🫥","😎",
  "🤓","🧐","🥳","😈","👿","💀","☠️","👻","👽","🤖","🎃","😺","😸","😹","😻","😼",
  "😽","🙀","😿","😾","🐱","🐈","🐈‍⬛","🦊","🐺","🐶","🐰","🐹","🐭","🐻","🐼","🐨",
  "🦁","🐯","🐮","🐷","🐸","🐵","🙈","🙉","🙊","🐔","🐧","🐦","🦆","🦉","🦇","🐢",
  "🌸","🌺","🌷","🌹","🌻","🌼","💐","🍀","🌿","🍃","🌱","🌳","🌙","☀️","⛅","🌈",
  "❄️","⚡","💧","🌊","🍎","🍓","🍒","🍑","🍊","🍋","🍌","🍉","🍇","🥝","🍰","🧁",
  "🍪","🍫","🍬","🍭","🍩","🍿","🍜","🍣","🍙","🍚","🍵","☕","🧋","🍺","🥤","🧃",
  "🎮","🕹️","🎧","🎵","🎶","🎨","🖌️","📚","📖","✏️","💻","⌨️","🖥️","📱","💾","🖱️",
  "🎀","🎁","🎉","🎊","🏆","🥇","💎","👑","🔮","🧸","🪄","🗝️","💤","💭","👀","🫶"
];

// Показывает пикер рядом с кнопкой. onPick получает выбранный символ.
// anchor должен быть position:relative-контейнером (или иметь его в предках).
export function openEmojiPicker(anchor, onPick, button = null) {
  // Нажатие по той же кнопке закрывает окно — как и ожидаешь от кнопки,
  // которая его открыла. Раньше приходилось тыкать куда-то мимо.
  const open = document.getElementById("emojiPicker");
  if (open && open.dataset.owner === ownerKey(button || anchor)) {
    closeEmojiPicker();
    return;
  }

  closeEmojiPicker();

  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.id = "emojiPicker";
  picker.dataset.owner = ownerKey(button || anchor);
  picker.innerHTML = EMOJI.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join("");
  anchor.appendChild(picker);

  // Ставим окно под кнопкой, а не посреди экрана: так видно, откуда оно
  // взялось, и не нужно искать глазами.
  if (button) placeNear(picker, button);

  picker.querySelectorAll("[data-emoji]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick(btn.dataset.emoji);
      closeEmojiPicker();
    });
  });

  // закрытие по клику вне — вешаем на следующем тике, иначе тот же клик,
  // которым пикер открыли, тут же его и закроет
  setTimeout(() => {
    document.addEventListener("click", onDocClick, { once: true });
  }, 0);
}

function onDocClick(e) {
  if (e.target.closest("#emojiPicker")) return;
  closeEmojiPicker();
}

export function closeEmojiPicker() {
  document.getElementById("emojiPicker")?.remove();
}


// Чем отличаем «то же самое окно» от «другого»: у каждой кнопки свой признак.
function ownerKey(el) {
  if (!el) return "anon";
  if (!el.dataset.pickerKey) {
    el.dataset.pickerKey = "p" + Math.random().toString(36).slice(2, 8);
  }
  return el.dataset.pickerKey;
}

// Ставит окно рядом с кнопкой, не давая ему уехать за край экрана.
function placeNear(picker, button) {
  // Считаем от экрана, а не от родителя.
  //
  // Раньше отсчёт шёл от того, внутри чего лежит окно. На компьютере это
  // работало, а на телефоне поле ввода прижато к низу и само по себе
  // сдвинуто — окно уезжало неизвестно куда. От экрана считать надёжнее:
  // он один и тот же везде.
  const b = button.getBoundingClientRect();

  picker.style.position = "fixed";
  picker.style.bottom = `${window.innerHeight - b.top + 8}px`;
  picker.style.top = "auto";

  // Ширину узнаём после того, как окно оказалось на странице.
  const width = picker.offsetWidth || 280;

  // Прижимаем правым краем к кнопке, но не выпускаем за края экрана.
  let left = b.right - width;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));

  picker.style.left = `${Math.round(left)}px`;
  picker.style.right = "auto";
}
