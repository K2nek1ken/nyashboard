import { db, doc, getDoc } from "./firebase.js";
import { getUserDoc } from "./data.js";
import { currentUser } from "./auth.js";
import { loadFriends, isFriend, addFriend, removeFriend, isMutualFriend } from "./friends.js";
import { avatarHtml } from "./avatar.js";
import { relationBadge, badgeHtml, nameHtml, isAdmin } from "./person.js";
import { escapeHtml, showToast } from "./ui.js";
import { fetchOnline } from "./presence.js";
import { getAlias, setAlias } from "./aliases.js";
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

  const online = await fetchOnline([uid]);
  // Аватарка со всем оформлением: раньше сюда приходил профиль без полей
  // украшения и рамки, потому они и не показывались.
  const decorated = {
    ...user,
    accessory: user.accessory || "none",
    avatarBorder: user.avatarBorder || "pink"
  };
  body.innerHTML = `
    <div class="preview-head">
      <span class="${online.has(uid) ? "online-wrap" : ""}">${avatarHtml(decorated, 64)}</span>
      <div style="min-width:0;">
        <div class="preview-name">${nameHtml(user, { clickable: false })} ${badgeHtml(badge)}</div>
        <div class="muted">@${escapeHtml(user.username || "???")}</div>
      </div>
    </div>
    ${user.bio ? `<div class="profile-bio">${escapeHtml(user.bio)}</div>` : ""}
    <div class="preview-actions">
      ${isSelf ? "" : `<button class="secondaryBtn" data-friend style="width:auto;margin:0;"></button>`}
      ${isSelf ? "" : `<button class="secondaryBtn" data-rename style="width:auto;margin:0;" title="как называть этого человека"><span class="nf">${ICON.pencil}</span></button>`}
      <a class="primaryBtn" style="width:auto;margin:0;text-decoration:none;"
         href="user.html?uid=${uid}">Открыть профиль</a>
    </div>

    <!-- Разделы человека: то же, что доступно на его странице.
         Для себя ведут туда же — «профиль» это страница со стеной и лентой,
         а не экран настроек. -->
    <div class="preview-sections">
      <a class="preview-section" href="user.html?uid=${uid}#feed">
        <span class="nf">${ICON.home}</span><span>Лента</span>
      </a>
      <a class="preview-section" href="user.html?uid=${uid}#wall">
        <span class="nf">${ICON.pencil}</span><span>Стена</span>
      </a>
      <a class="preview-section" href="user.html?uid=${uid}#music">
        <span class="nf">${ICON.music}</span><span>Музыка</span>
      </a>
      ${isSelf ? `<a class="preview-section" href="friends.html">
        <span class="nf">${ICON.users}</span><span>Друзья</span>
      </a>` : ""}
      ${isSelf ? `<a class="preview-section" href="profile.html">
        <span class="nf">${ICON.gear}</span><span>Настройки</span>
      </a>` : ""}
    </div>
    <div class="section-title" style="margin-bottom:6px;">Последние записи</div>
    <div id="previewPosts" class="feed-list"><div class="stub-note">Загружаю…</div></div>`;

  // Записи в карточке: без них не понять, чем человек живёт, а ради этого
  // карточку чаще всего и открывают.
  try {
    // Загружается на месте, а не обычным импортом: иначе получается кольцо
    // (лента → упоминания → карточка → снова лента), а такие связи ломаются
    // непредсказуемо при малейшей правке.
    const { loadUserFeed, renderPostsInto } = await import("./feed.js");
    const posts = await loadUserFeed(uid);
    const el = body.querySelector("#previewPosts");
    if (!posts.length) el.innerHTML = `<div class="stub-note">Пока пусто</div>`;
    else renderPostsInto(el, posts.slice(0, 3), user.nickname);
  } catch (e) {
    console.warn("Записи в карточке не загрузились:", e.message);
  }

  body.querySelector("[data-rename]")?.addEventListener("click", async () => {
    const { askText } = await import("./dialog.js");
    const next = await askText("Как называть этого человека", {
      value: getAlias(uid) || "",
      placeholder: user.nickname || "",
      hint: "Имя видно только тебе. Пустое поле вернёт настоящее.",
      maxlength: 40
    });
    if (next === null) return;
    setAlias(uid, next);
    showToast(next ? "Переименован ♡" : "Имя возвращено");
    openPersonPreview(uid);      // перерисовываем карточку с новым именем
  });

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
      ${avatarHtml({
          avatarUrl: ch.avatarUrl, avatarShape: ch.avatarShape,
          accessory: ch.accessory || "none", avatarBorder: ch.avatarBorder || "teal"
        }, 64)}
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

// Превью сообщения чата по его идентификатору. Показываем текст (длинный можно
// прокрутить) и даём перейти к нему в переписке.
export async function openMessagePreview(msgId, nuid) {
  const box = createBox();
  const body = box.querySelector("[data-body]");

  const snap = await getDoc(doc(db, "chatMessages", msgId)).catch(() => null);
  if (!snap?.exists()) {
    body.innerHTML = `<div class="stub-note">Сообщение не найдено — возможно, удалено</div>`;
    return;
  }
  const m = snap.data();

  body.innerHTML = `
    <div class="preview-head">
      <div style="min-width:0;">
        <div class="preview-name">${escapeHtml(m.nickname || "сообщение")}</div>
        <div class="muted track-nuid" data-copy-nuid="${nuid || ""}">${nuid || ""}</div>
      </div>
    </div>
    <div class="message-preview-body">
      ${m.text ? escapeHtml(m.text) : "<span class='muted'>без текста</span>"}
      ${m.imageUrl ? `<img src="${m.imageUrl}" style="max-width:100%;border-radius:10px;margin-top:8px;">` : ""}
    </div>
    <div class="preview-actions">
      <a class="primaryBtn" style="width:auto;margin:0;text-decoration:none;"
         href="chat.html?msg=${encodeURIComponent(nuid || "")}">Перейти к сообщению</a>
    </div>`;
}
