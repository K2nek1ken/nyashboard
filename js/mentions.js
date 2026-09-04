import { resolveHandle } from "./data.js";
import { currentUser } from "./auth.js";
import { showToast } from "./ui.js";

// Вызывать ПОСЛЕ escapeHtml — работает с уже безопасным текстом, просто оборачивает
// @хэндлы и #хештеги в кликабельные span'ы.
//
// Про NUID: он выглядит как U1234567, а хештег — как #что-то, так что синтаксически
// они не пересекаются. Но человек вполне может написать "#U1666777" (например, чтобы
// пометить чей-то профиль) — такой случай ловим отдельно и делаем ссылкой на аккаунт,
// а не хештегом.
export function linkifyMentions(escapedText) {
  return escapedText
    .replace(
      /@(ch_[a-zA-Z0-9_]{2,17}|[a-zA-Z0-9_]{3,20})\b/g,
      (m, handle) => `<span class="mention" data-mention="${handle}">@${handle}</span>`
    )
    .replace(
      /#([A-Za-zА-Яа-яЁё0-9_]{2,30})/g,
      (m, tag) => /^U[14]\d{6}$/i.test(tag)
        ? `<span class="mention" data-nuid="${tag.toUpperCase()}">#${tag}</span>`
        : `<span class="hashtag" data-hashtag="${tag}">#${tag}</span>`
    );
}

export function wireMentions(container) {
  container.querySelectorAll(".mention").forEach(el => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      // клик по #U1666777 — это ссылка на аккаунт по NUID
      if (el.dataset.nuid) {
        location.href = `people.html?q=${encodeURIComponent(el.dataset.nuid)}`;
        return;
      }
      const handle = el.dataset.mention;
      try {
        const resolved = await resolveHandle(handle);
        if (!resolved) { showToast("Не нашла @" + handle); return; }
        if (resolved.type === "channel") {
          location.href = `channel.html?id=${resolved.ownerId}`;
        } else {
          const isSelf = currentUser && resolved.ownerId === currentUser.uid;
          location.href = isSelf ? "profile.html" : `user.html?uid=${resolved.ownerId}`;
        }
      } catch (err) {
        console.error(err);
        showToast("Ошибка поиска: " + err.message);
      }
    });
  });

  // Клик по хештегу — на страницу тега со всеми постами, где он встречается
  // (ищется запросом array-contains по полю hashtags, без вычитывания всей ленты).
  container.querySelectorAll(".hashtag").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      location.href = `tag.html?tag=${encodeURIComponent(el.dataset.hashtag)}`;
    });
  });
}
