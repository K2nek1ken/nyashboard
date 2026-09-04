import { getUserDoc } from "./data.js";
import { loadUserFeed, renderPostsInto } from "./feed.js";
import { authReady, currentUser } from "./auth.js";
import { escapeHtml } from "./ui.js";
import { shapeClass } from "./avatar.js";
import { requestNuid, maskNuid } from "./nuid.js";
import { loadFriends, isFriend, addFriend, removeFriend, isMutualFriend } from "./friends.js";
import { openOrCreateChat } from "./dm.js";
import { showToast } from "./ui.js";
import { ICON } from "./icons.js";
import { defaultAvatar } from "./default-avatar.js";

function getUid() {
  return new URLSearchParams(location.search).get("uid");
}

export async function initUserPage() {
  const postsEl = document.getElementById("uPosts");
  const uid = getUid();
  if (!uid) { postsEl.innerHTML = `<div class="stub-note">Не указан профиль (нет ?uid= в ссылке)</div>`; return; }

  await authReady; // иначе лайки/кнопки на постах могут отрисоваться неправильно
  const user = await getUserDoc(uid);
  if (!user) { postsEl.innerHTML = `<div class="stub-note">Профиль не найден</div>`; return; }

  document.getElementById("uNickname").textContent = user.nickname;
  document.getElementById("uUsername").textContent = user.username;
  const avatarEl = document.getElementById("uAvatar");
  avatarEl.src = user.avatarUrl || defaultAvatar();
  avatarEl.className = `avatar-shaped ${shapeClass(user.avatarShape)}`;
  document.getElementById("uStatus").textContent = user.statusEmoji || "";
  document.getElementById("uBio").textContent = user.bio || "";
  document.title = `NyashBoard ♡ — ${user.nickname}`;

  // NUID запрашивается отдельно, как и просил Неко: сначала на экране маска,
  // затем браузер отправляет запрос, и база сама решает — отдать значение или
  // отказать, исходя из настройки приватности владельца профиля. При отказе
  // настоящий идентификатор просто не приходит в браузер, а не прячется в вёрстке.
  const nuidEl = document.getElementById("uNuid");
  nuidEl.textContent = maskNuid(null);
  nuidEl.title = "нажми, чтобы запросить";
  nuidEl.className = "nuid-masked";

  let revealed = false;
  nuidEl.addEventListener("click", async () => {
    if (revealed) return;
    nuidEl.textContent = "запрашиваю…";
    const value = await requestNuid(uid);
    if (value) {
      nuidEl.textContent = value;
      nuidEl.className = "";
      nuidEl.title = "";
      revealed = true;
    } else {
      nuidEl.textContent = "скрыт";
      nuidEl.className = "muted";
      nuidEl.title = "владелец профиля закрыл доступ";
    }
  });

  await renderFriendActions(uid);

  try {
    const posts = await loadUserFeed(uid);
    renderPostsInto(postsEl, posts, user.nickname);
  } catch (e) {
    console.error(e);
    postsEl.innerHTML = `<div class="stub-note">Ошибка загрузки: ${escapeHtml(e.message)}</div>`;
  }
}


// Кнопки «в друзья» и «написать». Дружба односторонняя, поэтому кнопка добавления
// работает сразу; личный чат откроется только когда вас добавят в ответ —
// об этом честно скажет сообщение из dm.js, если взаимности ещё нет.
async function renderFriendActions(uid) {
  const host = document.getElementById("friendActions");
  if (!host) return;
  if (!currentUser || currentUser.uid === uid) { host.innerHTML = ""; return; }

  await loadFriends();

  async function paint() {
    const added = isFriend(uid);
    // Взаимность спрашиваем точечно: «есть ли я в его списке». Список целиком
    // при этом остаётся закрытым — правила разрешают читать только свою запись.
    const mutual = added ? await isMutualFriend(uid) : false;

    host.innerHTML = `
      <button class="${added ? "secondaryBtn" : "primaryBtn"}" data-toggle-friend
              style="width:auto; margin:0; padding:8px 18px;">
        <span class="nf">${added ? ICON.check : ICON.plus}</span> ${added ? "В друзьях" : "Добавить в друзья"}
      </button>
      ${mutual ? `<button class="secondaryBtn" data-open-dm style="width:auto; margin:0; padding:8px 18px;">
        <span class="nf">${ICON.comment}</span> Написать</button>` : ""}
      ${added && !mutual ? `<span class="muted" style="font-size:12px; align-self:center;">
        ждём ответной заявки — тогда откроется чат</span>` : ""}`;

    host.querySelector("[data-toggle-friend]").addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        if (isFriend(uid)) { await removeFriend(uid); showToast("Убрали из друзей"); }
        else { await addFriend(uid); showToast("Добавили в друзья ♡"); }
        await paint();
      } catch (err) { showToast("Ошибка: " + err.message); await paint(); }
    });

    host.querySelector("[data-open-dm]")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      try {
        const chatId = await openOrCreateChat(uid);
        location.href = `dm.html?chat=${chatId}`;
      } catch (err) { showToast(err.message); e.target.disabled = false; }
    });
  }
  await paint();
}
