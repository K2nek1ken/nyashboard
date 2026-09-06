import { currentUser } from "./auth.js";
import { isFriend, isMutualFriend } from "./friends.js";
import { paletteColor } from "./palette.js";
import { shapeClass } from "./avatar.js";
import { defaultAvatar } from "./default-avatar.js";
import { escapeHtml } from "./ui.js";
import { getAlias } from "./aliases.js";

// ============================================================
//  Единое представление человека
//
//  Один модуль на всё: имя с его цветом, миниатюра аватарки, метка отношения.
//  Раньше это собиралось отдельно в списке людей, в чате, под записями — и при
//  любой правке приходилось помнить про все места сразу.
//
//  Метки:
//    админ         — владелец сайта, задаётся ниже списком
//    друг          — вы добавили друг друга
//    отслеживаемый — вы добавили человека, он вас пока нет
// ============================================================

// Кого показывать как администратора. Список, а не поле в базе: так его нельзя
// себе присвоить, отредактировав свой же профиль.
const ADMIN_NUIDS = ["U1510847", "U4019695"];       // владелец и канал проекта
const ADMIN_USERNAMES = ["i_kuroneko", "k2nek1ken"]; // юзернеймы владельца

export function isAdmin(user) {
  if (!user) return false;
  return ADMIN_USERNAMES.includes((user.username || "").toLowerCase())
      || ADMIN_NUIDS.includes(user.publicUid || "");
}

// Метка отношения. Требует загруженного списка друзей (loadFriends).
export async function relationBadge(uid, user) {
  if (isAdmin(user)) return { kind: "admin", label: "админ" };
  if (!currentUser || !uid || uid === currentUser.uid) return null;
  if (!isFriend(uid)) return null;
  return (await isMutualFriend(uid))
    ? { kind: "friend", label: "друг" }
    : { kind: "following", label: "отслеживаемый" };
}

export function badgeHtml(badge) {
  if (!badge) return "";
  return `<span class="person-badge badge-${badge.kind}">${badge.label}</span>`;
}

// Имя с цветом, выбранным владельцем профиля. Цвет один для всех, кто смотрит:
// он часть образа человека, а не настройка смотрящего.
export function nameHtml(user, { clickable = true } = {}) {
  const color = user?.nickColor ? `style="color:${paletteColor(user.nickColor)}"` : "";
  const cls = clickable ? "person-name clickable" : "person-name";
  // Если человек переименован для себя, показываем своё имя — как в записанных
  // контактах. Цвет при этом остаётся тот, что выбрал сам человек.
  const alias = getAlias(user?.uid);
  const shown = alias || user?.nickname || "???";
  const mark = alias ? ' title="переименован тобой"' : "";
  return `<span class="${cls}" ${color}${mark}>${escapeHtml(shown)}</span>`;
}

// Миниатюра рядом с именем: примерно в три буквы высотой, как и просил Неко.
export function miniAvatarHtml(user, size = 20) {
  const custom = user?.avatarUrl && user.avatarUrl !== "assets/anon.svg";
  const src = custom ? user.avatarUrl : defaultAvatar("neko");
  return `<img class="mini-avatar avatar-shaped ${shapeClass(user?.avatarShape)}"
               src="${src}" style="width:${size}px;height:${size}px;"
               ${custom ? "" : 'data-default-avatar="neko"'}>`;
}

// Готовая строка «аватарка + имя + метка» для списков и сообщений.
export function personChipHtml(user, badge, { size = 20, clickable = true } = {}) {
  return `<span class="person-chip" ${user?.uid ? `data-person="${user.uid}"` : ""}>
    ${miniAvatarHtml(user, size)}${nameHtml(user, { clickable })}${badgeHtml(badge)}
  </span>`;
}
