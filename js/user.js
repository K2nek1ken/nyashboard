import { getUserDoc } from "./data.js";
import { goTo } from "./router.js";
import { loadUserFeed, renderPostsInto } from "./feed.js";
import { authReady, currentUser } from "./auth.js";
import { escapeHtml, setText, setHtml } from "./ui.js";
import { avatarHtml } from "./avatar.js";
import { relationBadge, badgeHtml, nameHtml } from "./person.js";
import { fetchOnline } from "./presence.js";
import { requestNuid, maskNuid } from "./nuid.js";
import { loadFriends, isFriend, addFriend, removeFriend, isMutualFriend } from "./friends.js";
import { openOrCreateChat } from "./dm.js";
import { showToast } from "./ui.js";
import { ICON } from "./icons.js";
import { defaultAvatar } from "./default-avatar.js";

function getUid() {
  const raw = new URLSearchParams(location.search).get("uid");
  // «me» — это своя страница: так «Моя стена» в меню ведёт туда же, куда
  // попадают другие, глядя на тебя. Настройки живут отдельно.
  if (raw === "me") return currentUser?.uid || null;
  return raw;
}

export async function initUserPage() {
  const postsEl = document.getElementById("uPosts");
  await authReady;                 // «me» известен только после входа
  const uid = getUid();
  if (!uid) { postsEl.innerHTML = `<div class="stub-note">Не указан профиль (нет ?uid= в ссылке)</div>`; return; }

  await authReady; // иначе лайки/кнопки на постах могут отрисоваться неправильно
  const user = await getUserDoc(uid);
  if (!user) { postsEl.innerHTML = `<div class="stub-note">Профиль не найден</div>`; return; }

  // Аватарка со всем оформлением и метка отношения — то же, что видно
  // в списках. Раньше здесь была своя упрощённая вёрстка, и на странице
  // человека пропадали и рамка, и украшение, и цвет ника, и метка «в сети».
  await loadFriends().catch(() => {});
  const [badge, online] = await Promise.all([
    relationBadge(uid, user).catch(() => null),
    fetchOnline([uid]).catch(() => new Set())
  ]);

  const head = document.getElementById("uAvatarHost");
  if (head) {
    head.className = online.has(uid) ? "online-wrap" : "";
    head.innerHTML = avatarHtml(user, 72);
  }

  setHtml("uNickname", nameHtml(user, { clickable: false }) + badgeHtml(badge));
  setText("uUsername", user.username);
  setText("uBio", user.bio || "");
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
  await renderMusicButton(uid, user);

  try {
    const posts = await loadUserFeed(uid);

    // Записи разложены по двум вкладкам: слева то, что человек писал в ленту,
    // справа — его стена. Вкладку «Лента» можно закрыть в настройках профиля,
    // и тогда посторонние её не увидят.
    const feedPosts = posts.filter(p => p.place !== "wall");
    const wallPosts = posts.filter(p => p.place === "wall");

    const isSelf = currentUser && currentUser.uid === uid;
    const visibility = user.feedTabVisibility || "everyone";
    let canSeeFeed = isSelf || visibility === "everyone";
    if (!canSeeFeed && visibility === "friends") {
      canSeeFeed = await isMutualFriend(uid).catch(() => false);
    }

    // На своей странице даём писать прямо отсюда — за этим на стену и заходят.
    if (isSelf) {
      const host = document.getElementById("userPostBox");
      if (host) {
        host.classList.remove("hidden");
        // Плавающая кнопка, как в ленте: на телефоне тянуться вверх неудобно,
        // а на компьютере она встаёт обычной кнопкой над списком.
        host.innerHTML = `
          <button class="primaryBtn wall-write-btn" id="writeWallBtn">
            <span class="nf">${ICON.pencil}</span><span class="wall-write-label">Написать на стену</span>
          </button>`;
        host.querySelector("#writeWallBtn").addEventListener("click", async () => {
          const { openWallComposer } = await import("./wall-composer.js");
          openWallComposer(() => location.reload());
        });
      }
    }

    const tabs = document.getElementById("userSubtabs");
    const feedBtn = tabs?.querySelector('[data-usub="feed"]');
    if (feedBtn) feedBtn.classList.toggle("hidden", !canSeeFeed);

    // Стена открывается первой: это личная страница человека, а лента —
    // то, что он и так пишет у всех на виду. Плюс адрес может указать вкладку.
    const wanted = location.hash.replace("#", "");
    let active = wanted === "feed" && canSeeFeed ? "feed" : "wall";

    function paint() {
      const list = active === "wall" ? wallPosts : feedPosts;
      tabs?.querySelectorAll("[data-usub]").forEach(b =>
        b.classList.toggle("active", b.dataset.usub === active));

      if (!list.length) {
        postsEl.innerHTML = `<div class="stub-note">${
          active === "wall" ? "На стене пока пусто" : "В ленте пока пусто"}</div>`;
        return;
      }
      renderPostsInto(postsEl, list, user.nickname);
    }

    tabs?.querySelectorAll("[data-usub]").forEach(btn => {
      btn.addEventListener("click", () => { active = btn.dataset.usub; paint(); });
    });
    paint();
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
        goTo(`dm.html?chat=${chatId}`);
      } catch (err) { showToast(err.message); e.target.disabled = false; }
    });
  }
  await paint();
}


// Кнопка «Музыка» и фонотека человека. Видимость решается по его настройке:
// правило базы всё равно не отдаст приватную подколлекцию чужому, поэтому
// здесь мы лишь показываем понятный ответ вместо пустоты и ошибки в консоли.
async function renderMusicButton(uid, user) {
  const host = document.getElementById("musicBlock");
  if (!host) return;

  const visibility = user.musicVisibility || "everyone";
  const isSelf = currentUser && currentUser.uid === uid;

  host.innerHTML = `
    <button class="secondaryBtn" id="showMusicBtn" style="width:auto; margin:0 0 14px;">
      <span class="nf">${ICON.music}</span> Музыка
    </button>
    `;

  host.querySelector("#showMusicBtn").addEventListener("click", async () => {
    // Окно вместо блока снизу: раньше список дописывался под страницу и
    // убирался только перезагрузкой.
    const box = document.createElement("div");
    box.className = "modal";
    box.id = "musicModal";
    box.innerHTML = `
      <div class="modal-content" style="max-width:420px;max-height:80vh;display:flex;flex-direction:column;">
        <button class="closeBtn modalClose" data-close><span class="nf">${ICON.close}</span></button>
        <h2 style="margin-top:0;font-size:17px;">Музыка</h2>
        <div data-list style="overflow-y:auto;min-height:0;">
          <div class="stub-note">Загружаю…</div>
        </div>
      </div>`;
    document.body.appendChild(box);

    const close = () => box.remove();
    box.querySelector("[data-close]").addEventListener("click", close);
    box.addEventListener("click", (e) => { if (e.target === box) close(); });

    const list = box.querySelector("[data-list]");

    if (!isSelf && visibility === "nobody") {
      list.innerHTML = `<div class="stub-note">Пусто</div>`;
      return;
    }
    if (!isSelf && visibility === "friends") {
      await loadFriends().catch(() => {});
      const mutual = await isMutualFriend(uid).catch(() => false);
      if (!mutual) { list.innerHTML = `<div class="stub-note">Пусто</div>`; return; }
    }

    try {
      const { loadFavorites } = await import("./music.js");
      const { trackCardHtml, wireTrackCards } = await import("./music-ui.js");
      const tracks = await loadFavorites(uid);
      if (!tracks.length) { list.innerHTML = `<div class="stub-note">Пусто</div>`; return; }
      list.innerHTML = tracks.map(t => trackCardHtml(t, { favorite: true })).join("");
      wireTrackCards(list, tracks);
    } catch {
      // отказ базы означает закрытый доступ — показываем то же, что и при «никто»
      list.innerHTML = `<div class="stub-note">Пусто</div>`;
    }
  });
}
