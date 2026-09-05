import { db, doc, getDoc } from "./firebase.js";
import { getUserDoc } from "./data.js";
import { currentUser } from "./auth.js";
import { loadFriends, isFriend, addFriend, removeFriend, isMutualFriend } from "./friends.js";
import { avatarHtml } from "./avatar.js";
import { relationBadge, badgeHtml, nameHtml, isAdmin } from "./person.js";
import { escapeHtml, showToast } from "./ui.js";
import { ICON } from "./icons.js";

// Карточка человека или канала поверх страницы. Открывается по клику на
// упоминание, идентификатор или имя в списке — вместо мгновенного перехода:
// чаще всего достаточно взглянуть, кто это, и вернуться к чтению.

export async function openPersonPreview(uid) {
  const box = createBox();
  const body = box.querySelector("[data-body]");

  const user = await getUserDoc(uid).catch(() => null);
  if (!user) { body.innerHTML = `<div class="stub-note">Профиль не найден</div>`; return; }

  await loadFriends().catch(() => {});
  const badge = await relationBadge(uid, user);
  const isSelf = currentUser && currentUser.uid === uid;

  body.innerHTML = `
    <div class="preview-head">
      ${avatarHtml(user, 64)}
      <div style="min-width:0;">
        <div class="preview-name">${nameHtml(user, { clickable: false })} ${badgeHtml(badge)}</div>
        <div class="muted">@${escapeHtml(user.username || "???")}</div>
      </div>
    </div>
    ${user.bio ? `<div class="profile-bio">${escapeHtml(user.bio)}</div>` : ""}
    <div class="preview-actions">
      ${isSelf ? "" : `<button class="secondaryBtn" data-friend style="width:auto;margin:0;"></button>`}
      <a class="primaryBtn" style="width:auto;margin:0;text-decoration:none;"
         href="${isSelf ? "profile.html" : `user.html?uid=${uid}`}">Открыть профиль</a>
    </div>`;

  const friendBtn = body.querySelector("[data-friend]");
  if (friendBtn) {
    const paint = () => {
      const added = isFriend(uid);
      friendBtn.innerHTML = `<span class="nf">${added ? ICON.check : ICON.plus}</span> ${added ? "В друзьях" : "В друзья"}`;
    };
    paint();
    friendBtn.addEventListener("click", async () => {
      friendBtn.disabled = true;
      try {
        isFriend(uid) ? await removeFriend(uid) : await addFriend(uid);
        paint();
      } catch (e) { showToast("Ошибка: " + e.message); }
      finally { friendBtn.disabled = false; }
    });
  }
}

export async function openChannelPreview(channelId) {
  const box = createBox();
  const body = box.querySelector("[data-body]");
  const snap = await getDoc(doc(db, "channels", channelId)).catch(() => null);
  if (!snap?.exists()) { body.innerHTML = `<div class="stub-note">Канал не найден</div>`; return; }
  const ch = snap.data();

  body.innerHTML = `
    <div class="preview-head">
      ${avatarHtml({ avatarUrl: ch.avatarUrl, avatarShape: ch.avatarShape }, 64)}
      <div style="min-width:0;">
        <div class="preview-name">${escapeHtml(ch.name)}</div>
        <div class="muted">@${escapeHtml(ch.username || "")}</div>
      </div>
    </div>
    ${ch.description ? `<div class="profile-bio">${escapeHtml(ch.description)}</div>` : ""}
    <div class="preview-actions">
      <a class="primaryBtn" style="width:auto;margin:0;text-decoration:none;"
         href="channel.html?id=${channelId}">Открыть канал</a>
    </div>`;
}

function createBox() {
  document.getElementById("personPreview")?.remove();
  const box = document.createElement("div");
  box.className = "modal";
  box.id = "personPreview";
  box.innerHTML = `
    <div class="modal-content preview-content">
      <button class="closeBtn modalClose" data-close><span class="nf">${ICON.close}</span></button>
      <div data-body><div class="stub-note">Загружаю...</div></div>
    </div>`;
  document.body.appendChild(box);
  const close = () => box.remove();
  box.querySelector("[data-close]").addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  });
  return box;
}
