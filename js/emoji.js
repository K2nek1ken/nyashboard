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
export function openEmojiPicker(anchor, onPick) {
  closeEmojiPicker();

  const picker = document.createElement("div");
  picker.className = "emoji-picker";
  picker.id = "emojiPicker";
  picker.innerHTML = EMOJI.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join("");
  anchor.appendChild(picker);

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
