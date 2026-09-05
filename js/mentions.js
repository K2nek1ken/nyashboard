import { resolveHandle } from "./data.js";
import { currentUser } from "./auth.js";
import { showToast } from "./ui.js";
import { openPersonPreview, openChannelPreview } from "./person-preview.js";
import { resolveNuid } from "./nuid.js";

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
      // Клик по #U1666777 — показываем карточку, а не уводим со страницы:
      // чаще всего человек просто хочет посмотреть, кто это.
      if (el.dataset.nuid) {
        const hit = await resolveNuid(el.dataset.nuid);
        if (!hit) { showToast("Не нашла " + el.dataset.nuid); return; }
        hit.type === "channel" ? openChannelPreview(hit.uid) : openPersonPreview(hit.uid);
        return;
      }
      const handle = el.dataset.mention;
      try {
        const resolved = await resolveHandle(handle);
        if (!resolved) { showToast("Не нашла @" + handle); return; }
        // тоже карточка: перейти на страницу можно кнопкой внутри неё
        if (resolved.type === "channel") openChannelPreview(resolved.ownerId);
        else openPersonPreview(resolved.ownerId);
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
