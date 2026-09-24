import {
  db, auth, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, orderBy, limit, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove, increment, where
} from "./firebase.js";
import { currentUser, currentUserDoc, authReady } from "./auth.js";
import { TIMING } from "./modules/animation.js";
import { initPostIdentity, identityFields, getPostIdentity } from "./post-identity.js";
import { registerPostNuid } from "./nuid.js";
import { goTo } from "./router.js";
import { wireImageZoom } from "./lightbox.js";
import { askText, askConfirm } from "./dialog.js";
import { uploadImages } from "./storage.js";
import { lazyLoadReplies, loadReplyPreview } from "./post-replies-preview.js";
import { renderPostTracks, renderPostArtworks } from "./post-attachments.js";
import { columnCount, layoutPosts, balanceColumns, revealSequentially } from "./feed-layout.js";
import { showToast, escapeHtml, timeAgo, gendered } from "./ui.js";
import { ICON, SVG_ICON } from "./icons.js";
import { fetchReplies, sendReply } from "./replies.js";
import { imagesToHtml, wireCarousels, getPostImages } from "./carousel.js";
import { markOwned, isOwned } from "./ownership.js";
import { linkifyMentions, wireMentions } from "./mentions.js";
import { kebabHtml, wireKebab } from "./kebab.js";
import { avatarHtml, applyAvatar } from "./avatar.js";
import { paletteColor, CHANNEL_COLOR } from "./palette.js";
import { openEmojiPicker } from "./emoji.js";
import { extractHashtags } from "./hashtags.js";
import { rankPosts } from "./ranking.js";
import { loadSubscriptions } from "./subscriptions.js";
import { loadFriends, isFriend } from "./friends.js";
import { learnFromPost, markNotInterested, undoNotInterested, isSuppressed, loadInterests } from "./interests.js";
import { observeSeen, loadSeen } from "./seen.js";

// см. комментарий в chat.js: ссылку берём заново при каждом запуске
let feedListEl = null;
let feedUnsub = null;
let lastRenderedPosts = null;

// ---------- подписка на общую ленту ----------
// Пересобрать ленту заново: перечитывает отметки прочитанного и интересы,
// затем пересортировывает уже загруженные записи. Полная перезагрузка страницы
// для этого не нужна — данные и так приходят живым потоком.
export async function refreshFeed() {
  await Promise.all([loadSubscriptions(), loadFriends(), loadSeen(), loadInterests()]);
  if (!lastRenderedPosts) return;
  // Оформление авторов дозагружается заново: без этого кнопка «Обновить»
  // рисовала ленту по сырым данным записи, и рамка, украшение и цвет ника
  // пропадали.
  authorCache.clear();
  await enrichAuthors(lastRenderedPosts);
  renderFeed(rankPosts(lastRenderedPosts));
}

// Разовая загрузка последних записей — для подвкладок и подборок, где живая
// подписка не нужна и только тратила бы обращения к базе.
export async function loadRecentPosts(count = 50) {
  const snap = await getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(count)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function subscribeFeed() {
  feedListEl = document.getElementById("feedList");
  if (!feedListEl) return;

  // Список своих каналов загружает оболочка — он нужен не только ленте,
  // но и странице канала, стенам, поиску по тегу. Раньше он заполнялся
  // только здесь, и на других страницах записи канала нельзя было править.
  // Подписка переживает переход между вкладками, а разметка — нет. При
  // возврате в ленту рисуем накопленное сразу: сама подписка пришлёт что-то
  // только когда появится новая запись, а до тех пор экран оставался пустым.
  if (feedUnsub) {
    // Есть что показать — показываем сразу, не дожидаясь новых записей.
    if (lastRenderedPosts?.length) {
      renderFeed(rankPosts(lastRenderedPosts));
      return;
    }

    // Подписка есть, а показывать нечего. Значит она осталась от прошлого
    // захода и новых данных не пришлёт: первую порцию она отдаёт один раз,
    // при создании. Начинаем заново — иначе лента так и висит пустой,
    // и помогает только перезагрузка страницы.
    feedUnsub();
    feedUnsub = null;
  }
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));

  // Если за несколько секунд ничего не пришло, предлагаем обновить:
  // пустая лента без объяснений выглядит одинаково и при поломке,
  // и при плохой связи.
  const slowWatch = setTimeout(() => {
    if (lastRenderedPosts?.length || !feedListEl) return;
    if (feedListEl.querySelector(".post-card")) return;

    feedListEl.innerHTML = `
      <div class="stub-note">
        Лента не загрузилась.
        <button class="subBtn" data-retry-feed>Попробовать снова</button>
      </div>`;

    feedListEl.querySelector("[data-retry-feed]")?.addEventListener("click", () => {
      unsubscribeFeed();
      subscribeFeed();
    });
  }, 7000);

  feedUnsub = onSnapshot(q, (snap) => {
    clearTimeout(slowWatch);
    // Записи «для своих» отсеиваем на месте: база отдаёт список целиком,
    // а разрешение зависит от того, кто смотрит. Правило при этом всё равно
    // не даст открыть такую запись напрямую — здесь мы лишь не показываем
    // её в ленте.
    // В общей ленте показываем записи ленты, а записи стены — только своих
    // друзей и только если автор разрешил это в настройках профиля.
    const posts = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => {
        if (p.place !== "wall") return true;
        if (!currentUser) return false;
        // Свои записи со стены в собственной ленте не показываем: они живут
        // на странице профиля, и дублировать их здесь незачем.
        if (p.authorUid === currentUser.uid) return false;
        return isFriend(p.authorUid) && p.wallInFeed !== false;
      });

    // Лайк меняет одну запись, а не состав ленты. Перерисовывать весь список
    // из-за него — значит сбрасывать раскрытые тексты, положение каруселей
    // и прокрутку. Поэтому если поменялись только уже показанные записи,
    // обновляем именно их.
    const changes = snap.docChanges();
    const onlyUpdates = lastRenderedPosts
      && changes.length > 0
      && changes.every(c => c.type === "modified");

    if (onlyUpdates) {
      // переносим уже подгруженное оформление на новые данные, иначе
      // обновление счётчика стирало бы украшение и цвет ника
      const byId = new Map(lastRenderedPosts.map(p => [p.id, p]));
      posts.forEach(p => {
        const old = byId.get(p.id);
        if (!old) return;
        p.authorAccessory = old.authorAccessory;
        p.authorBorder = old.authorBorder;
        p.authorNickColor = old.authorNickColor;
        p.authorShape = p.authorShape || old.authorShape;
      });
      lastRenderedPosts = posts;
      changes.forEach(c => updatePostCard(posts.find(p => p.id === c.doc.id) || { id: c.doc.id, ...c.doc.data() }));
      return;
    }

    lastRenderedPosts = posts;

    // Каждая порция из базы — это новое состояние ленты: могли появиться
    // записи, пропасть, поменяться. Рисуем его сразу, с тем оформлением
    // авторов, что лежит в записях.
    //
    // Раньше отрисовка шла только после подгрузки оформления, а решение
    // «рисовать или только поправить аватарки» принималось по флагу «лента
    // уже рисовалась». Флаг жил между вкладками — и при возврате вместо
    // отрисовки правились аватарки в пустом списке. По той же причине
    // новые записи не появлялись, пока не перезагрузишь.
    scheduleRender(rankPosts(posts));

    // Настоящее оформление авторов подъезжает следом — его правим точечно,
    // не пересобирая ленту: иначе она дёргалась бы второй раз.
    enrichAuthors(posts)
      .catch(e => console.warn("Оформление авторов:", e.message))
      .then(() => {
        if (feedListEl?.querySelector(".post-card")) repaintAuthors(posts);
        else scheduleRender(rankPosts(posts));   // отрисовка ещё не случилась

        backfillNuid(posts);       // заодно достаём номер одной старой записи
      });
  }, (err) => {
    console.error(err);
    feedListEl.innerHTML = `<div class="stub-note">Не смогла загрузить ленту: ${escapeHtml(err.message)}</div>`;
  });
  // лента могла отрисоваться до того, как Firebase определился с авторизацией —
  // тогда лайки/кнопки редактирования были бы неправильными. Перерисовываем разок,
  // как только авторизация точно готова.
  // Подписки нужны для ранжирования, а они грузятся из аккаунта асинхронно.
  // Первый рендер идёт на локальном кэше (мгновенно), затем один раз
  // перерисовываем уже с актуальным списком из аккаунта.
  // подписки и друзья нужны ранжированию, а грузятся из аккаунта асинхронно:
  // первый рендер идёт на локальном кэше, затем один раз перерисовываем
  Promise.all([loadSubscriptions(), loadFriends(), loadSeen(), loadInterests()]).then(() => {
    if (lastRenderedPosts) scheduleRender(rankPosts(lastRenderedPosts));
  });

  // Поворот экрана или изменение окна меняет число колонок — перекладываем.
  // Порог по числу колонок, а не по каждому пикселю ширины: иначе лента
  // пересобиралась бы при любом движении рамки окна.
  // Следим за самим списком, а не за окном: боковые панели браузера и
  // изменение масштаба меняют его ширину, не трогая размер окна.
  let lastColumns = columnCount(feedListEl);
  if (feedListEl && "ResizeObserver" in window) {
    const observer = new ResizeObserver(() => {
      const now = columnCount(feedListEl);
      if (now === lastColumns) return;
      lastColumns = now;
      if (lastRenderedPosts) renderFeed(rankPosts(lastRenderedPosts));
    });
    observer.observe(feedListEl);
  }
}

// Оформление автора (украшение, цвет ника, форма аватарки) копируется в запись
// при публикации — чтобы не запрашивать профиль на каждую строку ленты.
// Но у записей, сделанных до появления этих полей, их просто нет, а ещё
// человек мог сменить украшение уже после публикации. Поэтому недостающее
// дозагружаем: по одному запросу на автора, а не на запись.
const authorCache = new Map();

// Записи, опубликованные до появления номеров, получают их при первом показе.
// По одной за раз и не чаще, чем раз в несколько секунд: разом присваивать
// всей ленте — лишняя нагрузка, а спешить некуда.
let lastBackfill = 0;

let backfillPaused = 0;

async function backfillNuid(posts) {
  if (!currentUser) return;                       // проставить может только вошедший
  if (Date.now() - lastBackfill < 1500) return;

  // После неудачи делаем паузу: если дело в связи или правах, повторять
  // каждые полторы секунды бессмысленно — только запросы жечь.
  if (Date.now() < backfillPaused) return;

  // Пачкой по пять: по одной за четыре секунды полсотни старых записей
  // нумеровались бы три минуты — человек успел бы уйти.
  const targets = posts.filter(p => !p.publicUid).slice(0, 5);
  if (!targets.length) return;
  lastBackfill = Date.now();

  for (const target of targets) {
    try {
      const nuid = await registerPostNuid(target.id);
      await updateDoc(doc(db, "posts", target.id), { publicUid: nuid });
      target.publicUid = nuid;
    } catch (e) {
      // Молча: номер — приятная мелочь, а не то, ради чего человек открыл
      // ленту. Причины бывают разные — от незалитых правил до плохой связи, —
      // и сообщать о каждой попытке значит мешать без нужды. Не проставился
      // сейчас — проставится при следующем просмотре.
      console.warn("Номер записи не проставился:", e.message);
      backfillPaused = Date.now() + 60000;         // вернёмся через минуту
      return;                                      // остальные тоже не пройдут
    }
  }
  // показываем проставленные номера сразу
  if (lastRenderedPosts) renderFeed(rankPosts(lastRenderedPosts));
}

// Как долго держим оформление автора в памяти. Пять минут: человек
// меняет аватарку не каждую минуту, но и ждать перезагрузки страницы,
// чтобы увидеть новую, не должен.
const AUTHOR_TTL = 5 * 60 * 1000;
const authorFetchedAt = new Map();

export async function enrichAuthors(posts) {
  // Берём оформление из профиля для всех записей, а не только для тех,
  // где его нет. В записи лежит копия на момент публикации — она
  // устаревает, как только человек сменил аватарку или украшение.
  const uids = [...new Set(
    posts.filter(p => p.authorUid && !p.isAnonymous).map(p => p.authorUid)
  )];
  const needChannels = posts.some(p => p.channelId);
  if (!uids.length && !needChannels) return;

  const { getUserDoc } = await import("./data.js");
  const now = Date.now();
  await Promise.all(uids.map(async uid => {
    // Свежее — не перезапрашиваем: иначе каждая прокрутка ленты стоила бы
    // по запросу на каждого автора.
    if (authorCache.has(uid) && now - (authorFetchedAt.get(uid) || 0) < AUTHOR_TTL) return;

    authorCache.set(uid, await getUserDoc(uid).catch(() => null));
    authorFetchedAt.set(uid, now);
  }));

  // Переносим свежее оформление в сами записи — дальше его берёт отрисовка
  // либо точечное обновление, если лента уже на экране.
  posts.forEach(p => {
    const u = p.authorUid && authorCache.get(p.authorUid);
    if (!u || p.isAnonymous) return;
    p.authorNickname = u.nickname || p.authorNickname;
    p.authorAvatar = u.avatarUrl ?? p.authorAvatar;
    p.authorShape = u.avatarShape || p.authorShape;
    p.authorAccessory = u.accessory || "none";
    p.authorBorder = u.avatarBorder || "pink";
    p.authorNickColor = u.nickColor || "";
    p.authorStatus = u.statusEmoji || "";
  });

  // Оформление канала берём из самого канала всегда, а не только когда его
  // нет в записи. В записи лежит копия на момент публикации — она устаревает
  // сразу, как владелец сменил цвет или украшение. Запрос один на канал,
  // а не на запись: дальше берётся из памяти.
  const channelIds = [...new Set(
    posts.filter(p => p.channelId).map(p => p.channelId)
  )];
  if (channelIds.length) {
    const { getChannel } = await import("./channels.js");
    await Promise.all(channelIds.map(async id => {
      if (authorCache.has("ch:" + id)) return;
      authorCache.set("ch:" + id, await getChannel(id).catch(() => null));
    }));
    posts.forEach(p => {
      const ch = p.channelId && authorCache.get("ch:" + p.channelId);
      if (!ch) return;
      p.channelAccessory = ch.accessory || "none";
      p.channelBorder = ch.avatarBorder || "teal";
      p.channelShape = ch.avatarShape || "circle";
      p.channelAvatar = ch.avatarUrl || p.channelAvatar;
    });
  }

  posts.forEach(p => {
    const u = p.authorUid && authorCache.get(p.authorUid);
    if (!u) return;
    if (p.authorAccessory === undefined) p.authorAccessory = u.accessory || "none";
    if (p.authorBorder === undefined) p.authorBorder = u.avatarBorder || "pink";
    if (p.authorNickColor === undefined) p.authorNickColor = u.nickColor || "";
    if (!p.authorShape) p.authorShape = u.avatarShape || "circle";
  });
}

// Обновляет одну карточку на месте: счётчики, отметки и подпись «изменено».
// Порядок в ленте при этом не трогаем — он пересчитывается только при загрузке
// страницы, иначе записи прыгали бы под пальцами во время чтения.
function updatePostCard(post) {
  // Карточку ищем по всей странице, а не только в ленте: записи показываются
  // и на стенах, и в поиске по тегу, и там обновление тоже нужно.
  const card = document.querySelector(`.post-card[data-id="${post.id}"]`);
  if (!card) return;

  // Отметка о правке: появляется сразу, а не после обновления списка.
  const timeEl = card.querySelector(".post-time");
  if (timeEl && post.editedAt && !timeEl.innerHTML.includes("изменено")) {
    timeEl.innerHTML = `${timeAgo(post.createdAt)}<span class="post-edited-tag">(изменено)</span>`;
  }

  const liked = currentUser && (post.likedBy || []).includes(currentUser.uid);
  const disliked = currentUser && (post.dislikedBy || []).includes(currentUser.uid);

  const likeBtn = card.querySelector('[data-action="like"]');
  if (likeBtn) {
    likeBtn.classList.toggle("liked", !!liked);
    likeBtn.querySelector(".likeCount").textContent = post.likesCount || 0;
    likeBtn.querySelector(".nf").textContent = liked ? ICON.heartFilled : ICON.heart;
  }

  const dislikeBtn = card.querySelector('[data-action="dislike"]');
  if (dislikeBtn) {
    dislikeBtn.classList.toggle("disliked", !!disliked);
    dislikeBtn.querySelector(".dislikeCount").textContent = post.dislikesCount || 0;
    const svg = dislikeBtn.querySelector(".svg-ic");
    if (svg) svg.outerHTML = disliked ? SVG_ICON.heartBroken : SVG_ICON.heartBrokenOutline;
  }

  // текст мог измениться при правке
  // Видео в записи — отдельным проигрывателем под текстом.
  //
  // Если видео убрали при правке, проигрыватель тоже должен исчезнуть:
  // иначе он остался бы висеть до перезагрузки.
  if (!p.videoUrl) {
    card.querySelector("[data-video-card]")?.remove();
    delete card.dataset.videoDone;
  }

  if (p.videoUrl && !card.dataset.videoDone) {
    card.dataset.videoDone = "1";
    import("./video-player.js").then(({ videoHtml, wireVideo }) => {
      const host = card.querySelector(".post-text") || card;
      host.insertAdjacentHTML("afterend", videoHtml(p.videoUrl, { poster: p.videoPoster || "" }));
      wireVideo(card);
    }).catch(e => console.warn("Видео не показалось:", e.message));
  }

  const textEl = card.querySelector(".post-text");
  if (textEl && post.text !== undefined) {
    const current = textEl.dataset.raw;
    if (current !== post.text) {
      textEl.dataset.raw = post.text;
      textEl.innerHTML = linkifyMentions(escapeHtml(post.text || ""));
      wireMentions(textEl);
    }
  }
}


// Несколько запросов на перерисовку подряд схлопываются в один.
//
// Лента обновляется сразу из нескольких мест: пришли записи, подгрузилось
// оформление авторов, загрузились подписки. Каждое просит перерисовать,
// и раньше список перестраивался по два-три раза за полсекунды — заметно
// дёргался и сбрасывал появление записей.
let repaintTimer = null;

// Подъехал список своих записей — перерисовываем, чтобы у анонимно
// написанных своих записей появились кнопки правки и удаления.
if (typeof window !== "undefined" && !window.__nyashOwnedFeedHook) {
  window.__nyashOwnedFeedHook = true;
  window.addEventListener("nyash:owned", () => {
    if (lastRenderedPosts?.length && feedListEl?.isConnected) {
      scheduleRender(rankPosts(lastRenderedPosts));
    }
  });
}

function scheduleRender(posts) {
  clearTimeout(repaintTimer);
  repaintTimer = setTimeout(() => renderFeed(posts), 40);
}

function renderFeed(posts) {
  if (!posts.length) {
    feedListEl.innerHTML = `<div class="stub-note">Пока пусто. Жми «+» и пиши ${gendered("первым", "первой", "первым(ой)")} ♡</div>`;
    return;
  }
  layoutPosts(feedListEl, posts, p => postToHtml(p));
  posts.forEach(p => wirePostCard(p, feedListEl));
  revealSequentially(feedListEl);
  fadeInPosts(feedListEl);
  balanceColumns(feedListEl);

  // Если при раскладке ширина ещё не была известна, число колонок могло
  // выйти неверным — проверяем на следующем кадре, когда список уже на месте.
  requestAnimationFrame(() => {
    const shouldBe = columnCount(feedListEl);
    const actual = feedListEl.querySelectorAll(".feed-column").length || 1;
    if (shouldBe !== actual && lastRenderedPosts) renderFeed(rankPosts(lastRenderedPosts));
  });
}

// Управляющие каналов знают свои каналы из общего списка — он загружается
// один раз при старте ленты, поэтому проверка здесь синхронная.
let managedChannels = new Set();
export function setManagedChannels(ids) { managedChannels = new Set(ids); }

function canManagePost(p) {
  if (currentUser && p.authorUid && p.authorUid === currentUser.uid) return true;
  // записями канала распоряжается вся его команда, а не только автор публикации
  if (p.channelId && managedChannels.has(p.channelId)) return true;
  return isOwned("post", p.id);
}

export function postToHtml(p, maskAuthor = false) {
  const isChannelPost = !!p.channelId;
  // В контексте репоста имя автора закрыто звёздочками, пока сервер не
  // подтвердит, что показывать можно
  const masked = maskAuthor && !isChannelPost && !p.isAnonymous && p.authorUid;
  const authorName = isChannelPost
    ? escapeHtml(p.channelName || "канал")
    : (p.isAnonymous ? "Аноним"
      : masked ? "•".repeat(Math.min(8, (p.authorNickname || "").length || 6))
      : escapeHtml(p.authorNickname || "???"));
  // цвет ника выбирает автор, и он одинаков для всех, кто видит запись
  const nameStyle = isChannelPost
    ? ` style="color:${CHANNEL_COLOR}"`
    : (!p.isAnonymous && !masked && p.authorNickColor
        ? ` style="color:${paletteColor(p.authorNickColor)}"` : "");
  const authorAttrs = isChannelPost
    ? `data-action="viewChannel" data-channel-id="${p.channelId}"`
    : `data-action="viewAuthor" data-uid="${p.authorUid || ""}"`;
  const liked = currentUser && (p.likedBy || []).includes(currentUser.uid);
  const disliked = currentUser && (p.dislikedBy || []).includes(currentUser.uid);
  const canManage = canManagePost(p);
  // Правка идёт отдельным окном, поэтому наличие редактора на странице больше
  // ни при чём. Раньше кнопка пропадала везде, где его нет, — и свои записи
  // нельзя было изменить, например со страницы человека.
  const hasEditor = true;
  const onPostPage = location.pathname.endsWith("post.html");
  const suppressed = isSuppressed(p.id);

  // Прятать от себя собственные записи и записи своих каналов бессмысленно,
  // как и жаловаться на них.
  const canSuppress = !(currentUser && p.authorUid === currentUser.uid)
                   && !(p.channelId && managedChannels.has(p.channelId))
                   && !isOwned("post", p.id);

  const kebabItems = [
    ...(onPostPage ? [] : [{ action: "openPost", label: "Открыть пост", icon: ICON.open }]),
    ...(canSuppress ? [suppressed
      ? { action: "undoNotInterested", label: "Вернуть в рекомендации", icon: ICON.up }
      : { action: "notInterested", label: "Не рекомендовать", icon: ICON.down }] : []),
    ...(p.publicUid ? [{ action: "copyNuid", label: "Скопировать NUID", icon: ICON.hash }] : []),
    // Жаловаться на себя и прятать своё — бессмысленно. Управляющие канала
    // тоже считаются своими для его записей.
    ...(canSuppress ? [{ action: "report", label: "Пожаловаться", icon: ICON.warning }] : []),
    ...(canManage
      ? [
          ...(hasEditor ? [{ action: "editPost", label: "Изменить", icon: ICON.pencil }] : []),
          { action: "deletePost", label: "Удалить", icon: ICON.close, danger: true }
        ]
      : [])
  ];
  // Длинный текст сворачиваем, чтобы одна запись не занимала весь экран.
  // При правке текст берётся из data-raw — там номера остаются на месте.
  // Номера прикреплённого убираем из текста: они написаны на самих
  // карточках — проигрывателя и работы, — и строкой дублировались зря.
  const rawText = (p.text || "")
    .replace(/\s*#U[35]\d{6}/gi, "")
    .trim();
  const isLong = rawText.length > 420 || rawText.split("\n").length > 10;
  const authorForAvatar = isChannelPost
    ? { avatarUrl: p.channelAvatar, avatarShape: p.channelShape || "circle",
        accessory: p.channelAccessory, avatarBorder: p.channelBorder }
    : (p.isAnonymous || masked ? {}
                     : { avatarUrl: p.authorAvatar, avatarShape: p.authorShape,
                         statusEmoji: p.authorStatus, accessory: p.authorAccessory,
                         avatarBorder: p.authorBorder });
  const avatarVariant = masked ? "hidden" : "neko";
  return `
    <article class="post-card" data-id="${p.id}">
      <div class="post-head">
        <span ${authorAttrs} style="cursor:pointer;">${avatarHtml(authorForAvatar, 34, "", avatarVariant)}</span>
        <span class="post-author ${(!isChannelPost && p.isAnonymous) ? "anon" : ""} ${masked ? "author-masked" : ""}" ${authorAttrs}${nameStyle}>${authorName}</span>
        <div class="post-meta-right">
          ${p.publicUid ? `<span class="track-nuid" data-copy-nuid="${p.publicUid}" title="нажми, чтобы скопировать">${p.publicUid}</span>` : ""}
          ${p.place === "wall" ? `<span class="wall-badge" title="запись со стены"><span class="nf">${ICON.users}</span></span>` : ""}
          <span class="post-time">${timeAgo(p.createdAt)}${p.editedAt ? '<span class="post-edited-tag">(изменено)</span>' : ""}</span>
          ${kebabHtml(kebabItems, p.id)}
        </div>
      </div>
      <div class="post-text ${isLong ? "collapsible" : ""}" data-raw="${escapeHtml(p.text || "")}">${linkifyMentions(escapeHtml(rawText))}</div>
      ${isLong ? `<button class="expandBtn" data-action="toggleExpand"><span class="nf">${ICON.down}</span> показать полностью</button>` : ""}
      ${imagesToHtml(getPostImages(p))}
      <div class="post-tracks" data-post-tracks="${p.id}"></div>
      <div class="post-actions">
        <button data-action="like" class="${liked ? "liked" : ""}"><span class="nf">${liked ? ICON.heartFilled : ICON.heart}</span> <span class="likeCount">${p.likesCount || 0}</span></button>
        <button data-action="dislike" class="${disliked ? "disliked" : ""}">${disliked ? SVG_ICON.heartBroken : SVG_ICON.heartBrokenOutline} <span class="dislikeCount">${p.dislikesCount || 0}</span></button>
        <button data-action="focusReply"><span class="nf">${ICON.comment}</span> ответить</button>
        <button data-action="repost"><span class="nf">${ICON.repost}</span> репост</button>
      </div>
      <div class="replies-preview" data-preview-for="${p.id}">
        <div class="muted" style="padding:6px 0;">загружаю ответы...</div>
      </div>
      <div class="reply-input-row" style="position:relative;">
        <label class="attachBtn nf" data-reply-attach title="фото">${ICON.attach}</label>
        <input type="file" accept="image/*" data-reply-file hidden>
        <textarea placeholder="Твой ответ..." data-reply-input rows="1"></textarea>
        <button class="nf" data-action="replyEmoji" title="эмодзи">${ICON.smile}</button>
        <button data-action="sendReply"><span class="nf">${ICON.send}</span></button>
      </div>
      <div class="image-preview hidden" data-reply-preview></div>
    </article>`;
}

// Самая свежая версия каждой записи — по номеру. Обновляется при каждой
// привязке и точечном обновлении карточки; обработчики читают отсюда.
const livePosts = new Map();

// Окно на свежую версию записи: чтение и запись полей идут в тот объект,
// что лежит в livePosts сейчас, а не в тот, что был при привязке.
function livePost(orig) {
  const id = orig.id;
  const cur = () => livePosts.get(id) || orig;
  return new Proxy(orig, {
    get: (_, k) => cur()[k],
    set: (_, k, v) => { cur()[k] = v; return true; },
    has: (_, k) => k in cur(),
    ownKeys: () => Reflect.ownKeys(cur()),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(cur(), k);
      return d ? { ...d, configurable: true } : undefined;
    }
  });
}

export function wirePostCard(p, container = document) {
  const card = container.querySelector(`.post-card[data-id="${p.id}"]`);
  if (!card) return;

  // Обработчики должны видеть запись такой, какая она СЕЙЧАС, а не на момент
  // привязки. Раньше каждое действие запоминало объект записи при первой
  // привязке: запись менялась — правка, лайк, обновление из базы, — карточка
  // обновлялась точечно, а «изменить» открывало редактор со старым текстом.
  // Так пропадал прикреплённый номер: в записи он был, в редакторе — нет.
  //
  // Поэтому здесь p — окно на самую свежую версию записи по её номеру.
  livePosts.set(p.id, p);
  p = livePost(p);

  // Привязка каждого места — один раз на элемент. Карточка теперь
  // обновляется частями и привязывается повторно; без этого обработчиков
  // становилось по два: «показать полностью» раскрывало и тут же сворачивало.
  const on = (el, type, fn, opts) => {
    if (!el) return;
    const key = "w" + type;
    if (el.dataset[key]) return;
    el.dataset[key] = "1";
    el.addEventListener(type, fn, opts);
  };

  wireCarousels(card);
  wireMentions(card);
  observeSeen(card);
  renderPostTracks(p, card);
  renderPostArtworks(p, card);
  wireImageZoom(card);

  card.querySelectorAll('[data-action="viewAuthor"]').forEach(el => {
    on(el, "click", () => {
      const uid = el.dataset.uid;
      if (!uid) { showToast("Это аноним, профиля нет ¯\\_(ツ)_/¯"); return; }
      // Не зовём people.js напрямую — иначе feed.js и people.js импортировали бы
      // друг друга по кругу. Вместо этого просто сообщаем «хотят открыть профиль»,
      // а кто это покажет (и покажет ли) — забота слушателя.
      document.dispatchEvent(new CustomEvent("nyash:view-profile", { detail: { uid } }));
    });
  });
  card.querySelectorAll('[data-action="viewChannel"]').forEach(el => {
    on(el, "click", () => { goTo(`channel.html?id=${el.dataset.channelId}`); });
  });

  on(card.querySelector('[data-action="like"]'), "click", () => toggleLike(p));
  on(card.querySelector('[data-action="dislike"]'), "click", () => toggleDislike(p));
  on(card.querySelector('[data-action="repost"]'), "click", () => repost(p));

  wireKebab(card, {
    openPost: () => { goTo(`post.html?id=${p.id}`); },
    notInterested: () => {
      // Только локально: понижаем вес темы и автора в своём профиле интересов,
      // на сервер ничего не уходит. Запись при этом не исчезает — просто
      // уедет вниз при следующей загрузке ленты.
      markNotInterested(p);
      card.style.opacity = "0.45";
      showToast("Учла — такое будет ниже в ленте");
    },
    undoNotInterested: () => {
      // Полный откат: снятое понижение возвращается обратно, чтобы случайное
      // нажатие не портило рекомендации навсегда.
      undoNotInterested(p);
      card.style.opacity = "";
      showToast("Вернула в рекомендации");
    },
    copyNuid: async () => {
      const { copyNuid } = await import("./copy-nuid.js");
      copyNuid(p.publicUid);
    },
    report: async () => {
      const { openReportDialog } = await import("./reports.js");
      openReportDialog({ kind: "post", id: p.id, preview: p.text || "" });
    },
    editPost: () => {
      // На широком экране правим прямо в карточке: отдельный экран ради
      // пары слов — лишний шаг, и из него не видно, как запись выглядит.
      // Один редактор на всё: он создаётся на месте и работает на любой
      // странице — в ленте, на стене, в поиске по тегу.
      import("./post-composer.js").then(({ openPostComposer }) => {
        openPostComposer({
          post: p,
          onDone: () => patchPostCard(card, p)
        });
      }).catch(e => showToast("Редактор не открылся: " + e.message));
    },
    deletePost: () => deletePost(p, card)
  });

  const expandBtn = card.querySelector('[data-action="toggleExpand"]');
  if (expandBtn) {
    const textEl = card.querySelector(".post-text");
    on(expandBtn, "click", () => {
      const expanded = textEl.classList.toggle("expanded");
      expandBtn.innerHTML = expanded
        ? `<span class="nf">${ICON.up}</span> свернуть`
        : `<span class="nf">${ICON.down}</span> показать полностью`;
    });
  }

  const input = card.querySelector('[data-reply-input]');
  on(card.querySelector('[data-action="focusReply"]'), "click", () => input.focus());

  // прикрепление фото к ответу
  const fileInput = card.querySelector("[data-reply-file]");
  const previewBox = card.querySelector("[data-reply-preview]");
  let pendingReplyImage = null;
  on(card.querySelector("[data-reply-attach]"), "click", () => fileInput.click());
  on(fileInput, "change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    pendingReplyImage = file;
    previewBox.classList.remove("hidden");
    previewBox.innerHTML = `<img src="${URL.createObjectURL(file)}"><button class="removeImg" data-remove><span class="nf">${ICON.close}</span></button>`;
    on(previewBox.querySelector("[data-remove]"), "click", () => {
      pendingReplyImage = null;
      previewBox.classList.add("hidden");
      previewBox.innerHTML = "";
    });
  });

  on(card.querySelector('[data-action="replyEmoji"]'), "click", (e) => {
    e.stopPropagation();
    openEmojiPicker(card.querySelector(".reply-input-row"), (emoji) => {
      input.value += emoji;
      input.focus();
    }, e.currentTarget);
  });

  const sendBtn = card.querySelector('[data-action="sendReply"]');
  const send = async () => {
    const text = input.value.trim();
    if (!text && !pendingReplyImage) return;
    sendBtn.disabled = true;
    try {
      // Если отвечаем на чей-то ответ — цитата уедет вместе с сообщением.
      const { currentReplyTarget, clearReplyTarget } = await import("./replies.js");
      await sendReply(p.id, text, pendingReplyImage, currentReplyTarget(card));
      clearReplyTarget(card);
      input.value = "";
      pendingReplyImage = null;
      previewBox.classList.add("hidden");
      previewBox.innerHTML = "";
      showToast("Ответ отправлен");
      loadReplyPreview(p.id, card);
    } catch (e) {
      console.error(e);
      showToast("Не отправилось: " + e.message);
    } finally {
      sendBtn.disabled = false;
    }
  };
  on(sendBtn, "click", send);
  // Enter переносит строку, отправка — кнопкой. На компьютере ещё и
  // сочетанием: там Enter под рукой, а тянуться к кнопке ради каждого
  // ответа утомительно.
  //
  // На телефоне Enter не отправляет вовсе: там для этого есть кнопка,
  // а клавиша нужна как раз для переноса.
  on(input, "keydown", (e) => {
    if (e.key !== "Enter") return;

    // Enter — перенос, отправка по Shift+Enter или Ctrl+Enter.
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      send();
    }
  });

  // Поле растёт под текст: ответ на несколько строк не должен прятаться
  // в одну щель.
  const growReply = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
  };
  on(input, "input", growReply);

  // Ответы грузим ТОЛЬКО когда карточка появилась на экране. Раньше лента из
  // 50 постов делала 50 запросов к Firestore сразу при открытии страницы —
  // это и медленно, и быстро жжёт бесплатный лимит чтений.
  lazyLoadReplies(p.id, card);
}


// Отметка ставится по актуальному состоянию документа, а не по тому, что
// лежит в памяти страницы. Раньше при устаревших данных клиент считал, что
// отметки нет, и добавлял единицу к счётчику ещё раз — список при этом
// не менялся, потому что человек в нём уже был, и число накручивалось.
async function toggleVote(p, { listField, countField, weight, collectionName = "posts" }) {
  if (!currentUser) { showToast("Войди, чтобы оценивать ♡"); return; }

  const ref = doc(db, collectionName, p.id);
  const snap = await getDoc(ref).catch(() => null);
  const fresh = snap?.exists() ? snap.data() : p;
  const has = (fresh[listField] || []).includes(currentUser.uid);

  // Противоположная отметка снимается: держать одновременно «нравится» и
  // «не нравится» бессмысленно — это взаимоисключающие оценки.
  const opposite = listField === "likedBy"
    ? { list: "dislikedBy", count: "dislikesCount" }
    : { list: "likedBy", count: "likesCount" };
  const hadOpposite = !has && (fresh[opposite.list] || []).includes(currentUser.uid);

  try {
    const patch = {
      [listField]: has ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
      [countField]: increment(has ? -1 : 1)
    };
    if (hadOpposite) {
      patch[opposite.list] = arrayRemove(currentUser.uid);
      patch[opposite.count] = increment(-1);
    }
    await updateDoc(ref, patch);
  } catch (e) {
    // Сервер отклоняет несогласованные изменения — значит данные разъехались.
    // Показываем актуальное состояние, чтобы человек видел правду.
    console.warn("Отметка не прошла:", e.message);
    if (snap?.exists()) updatePostCard({ id: p.id, ...fresh });
    showToast("Не вышло — обнови ленту");
    return;
  }

  // локальные данные приводим в соответствие, иначе следующее нажатие
  // снова сработает по устаревшему состоянию
  p[listField] = has
    ? (fresh[listField] || []).filter(u => u !== currentUser.uid)
    : [...(fresh[listField] || []), currentUser.uid];
  p[countField] = Math.max(0, (fresh[countField] || 0) + (has ? -1 : 1));

  if (hadOpposite) {
    p[opposite.list] = (fresh[opposite.list] || []).filter(u => u !== currentUser.uid);
    p[opposite.count] = Math.max(0, (fresh[opposite.count] || 0) - 1);
  }
  updatePostCard(p);      // обе отметки перерисовываем сразу

  learnFromPost(p, has ? -weight : weight);
}

const toggleLike = (p) =>
  toggleVote(p, { listField: "likedBy", countField: "likesCount", weight: 3 });

const toggleDislike = (p) =>
  toggleVote(p, { listField: "dislikedBy", countField: "dislikesCount", weight: -3 });

async function repost(p) {
  if (!currentUser) { showToast("Войди, чтобы репостить"); return; }
  if (p.authorUid === currentUser.uid) { showToast("Это уже твой пост ¯\\_(ツ)_/¯"); return; }
  // id вида {uid}_{postId}: один репост на пару «человек + запись», и правила
  // могут по имени проверить, репостил ли конкретный человек эту запись —
  // на этом держится режим «показывать автора только репостнувшим»
  await setDoc(doc(db, "reposts", `${currentUser.uid}_${p.id}`), {
    uid: currentUser.uid,
    postId: p.id,
    createdAt: serverTimestamp()
  });
  showToast(`Репостнул${gendered("", "а", "(а)")} на свою страницу ♡ (это просто ссылка, не дубль)`);
}

async function deletePost(p, card) {
  if (!await askConfirm("Удалить запись?", { hint: "Запись и ответы к ней исчезнут навсегда.", okLabel: "Удалить", danger: true })) return;
  try {
    await deleteDoc(doc(db, "posts", p.id));
    card.remove();
    showToast("Пост удалён");
  } catch (e) {
    console.error(e);
    showToast("Не удалилось: " + e.message);
  }
}

// ---------- полноэкранный редактор поста (создание И редактирование) ----------
let editorImages = []; // [{type:'existing', url} | {type:'new', file}]
let editingPostId = null;

function renderImageStrip() {
  const strip = document.getElementById("postImageStrip");
  const hint = document.getElementById("imageCountHint");
  strip.innerHTML = editorImages.map((img, i) => `
    <div class="thumb" data-idx="${i}">
      <img src="${img.type === "existing" ? img.url : URL.createObjectURL(img.file)}">
      <button class="removeThumb" data-remove-idx="${i}"><span class="nf">${ICON.close}</span></button>
    </div>`).join("");
  hint.textContent = editorImages.length ? `${editorImages.length}/10` : "";
  strip.querySelectorAll("[data-remove-idx]").forEach(btn => {
    btn.addEventListener("click", () => {
      editorImages.splice(Number(btn.dataset.removeIdx), 1);
      renderImageStrip();
    });
  });
}

export function openPostEditor(post = null) {
  const editor = document.getElementById("postEditor");
  const textarea = document.getElementById("postTextArea");
  // Выбор имени — общий модуль: он же собирает поля записи.
  initPostIdentity(document.getElementById("postIdentityHost"));
  const identityHost = document.getElementById("postIdentityHost");
  const title = document.getElementById("editorTitle");
  const publishBtn = document.getElementById("publishPostBtn");
  if (!editor) return;

  editingPostId = post ? post.id : null;
  textarea.value = post ? (post.text || "") : "";
  editorImages = post ? getPostImages(post).map(url => ({ type: "existing", url })) : [];
  renderImageStrip();

  if (post) {
    title.textContent = "Редактирование поста";
    publishBtn.textContent = "Сохранить";
    // Автора при правке не меняем: запись уже опубликована от чьего-то имени.
    identityHost?.classList.add("hidden");
  } else {
    title.textContent = "Новый пост";
    publishBtn.textContent = "Опубликовать";
    identityHost?.classList.remove("hidden");
  }

  editor.classList.remove("hidden");
  textarea.focus();
}

export function initPostEditor() {
  const editor = document.getElementById("postEditor");
  if (!editor) return;
  const fab = document.getElementById("newPostFab");
  const closeBtn = document.getElementById("closeEditorBtn");
  const textarea = document.getElementById("postTextArea");
  // Выбор имени — общий модуль: он же собирает поля записи.
  initPostIdentity(document.getElementById("postIdentityHost"));
  const imageInput = document.getElementById("postImageInput");
  const publishBtn = document.getElementById("publishPostBtn");

  if (fab) {
    fab.addEventListener("click", async () => {
      const { openPostComposer } = await import("./post-composer.js");
      openPostComposer({ place: "feed" });
    });
  }

  closeBtn.addEventListener("click", () => editor.classList.add("hidden"));

  imageInput.addEventListener("change", () => {
    const files = Array.from(imageInput.files || []);
    const room = 10 - editorImages.length;
    if (files.length > room) showToast(`Максимум 10 фото — добавила только ${room}`);
    files.slice(0, room).forEach(file => editorImages.push({ type: "new", file }));
    imageInput.value = "";
    renderImageStrip();
  });

  publishBtn.addEventListener("click", async () => {
    const text = textarea.value.trim();
    if (!text && !editorImages.length) { showToast("Пустой пост не отправить"); return; }
    publishBtn.disabled = true;
    const originalLabel = publishBtn.textContent;
    publishBtn.textContent = editingPostId ? "Сохраняю..." : "Публикую...";
    try {
      const newFiles = editorImages.filter(i => i.type === "new").map(i => i.file);
      const uploadedUrls = newFiles.length ? await uploadImages(newFiles) : [];
      let uploadIdx = 0;
      const imageUrls = editorImages.map(i => i.type === "existing" ? i.url : uploadedUrls[uploadIdx++]);

      // подстраховка: если куда-то всё же просочился пустой URL, лучше явная
      // понятная ошибка сейчас, чем невнятный отказ Firestore на "undefined" позже
      if (imageUrls.some(u => !u)) {
        throw new Error("Одна из картинок не загрузилась — попробуй ещё раз");
      }

      if (editingPostId) {
        await updateDoc(doc(db, "posts", editingPostId), {
          text, hashtags: extractHashtags(text), imageUrls, editedAt: serverTimestamp()
        });
        showToast("Пост обновлён ♡");
      } else {
        const ref = await addDoc(collection(db, "posts"), {
          // Имя автора, украшения и цвета собирает выбор имени публикации:
          // он знает, публикуешь ты от себя, анонимно или от имени канала.
          ...identityFields(),
          text,
          hashtags: extractHashtags(text),
          imageUrls,
          // Где опубликовано: в ленте или на стене профиля. Это разные места,
          // а не уровни доступа — записи стены живут у тебя на странице и
          // попадают в чужую ленту только к друзьям, и то по твоей настройке.
          place: "feed",
          // копия настройки автора: лента не должна запрашивать профиль
          // ради каждой записи
          wallInFeed: currentUserDoc?.wallInFeed !== false,
          likesCount: 0,
          likedBy: [],
          dislikesCount: 0,
          dislikedBy: [],
          createdAt: serverTimestamp()
        });
        // секрет владения — id совпадает с id поста, чтобы правила Firestore могли
        // найти его через get() по тому же пути; ownerUid = FUID текущей сессии
        // (реальный аккаунт ИЛИ анонимная гостевая сессия — она тоже валидна)
        await setDoc(doc(db, "postSecrets", ref.id), { ownerUid: auth.currentUser.uid });
        // копия авторства для репостов: выдаётся по настройке приватности
        // Копия авторства нужна только для записей от своего имени: у анонимных
        // и канальных её быть не должно.
        if (getPostIdentity().kind === "self" && currentUser && currentUserDoc) {
          await setDoc(doc(db, "postAuthors", ref.id), {
            uid: currentUser.uid,
            nickname: currentUserDoc.nickname || "",
            avatarUrl: currentUserDoc.avatarUrl || "",
            avatarShape: currentUserDoc.avatarShape || "circle",
            statusEmoji: currentUserDoc.statusEmoji || ""
          }).catch(() => {});
        }
        markOwned("post", ref.id);

        // Идентификатор записи: по нему на неё можно сослаться откуда угодно.
        registerPostNuid(ref.id)
          .then(nuid => updateDoc(doc(db, "posts", ref.id), { publicUid: nuid }))
          .catch(e => console.warn("Идентификатор записи не записался:", e.message));
        showToast("Опубликовано ♡");
      }
      editor.classList.add("hidden");
    } catch (e) {
      console.error(e);
      showToast(friendlyError(e));
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = originalLabel;
    }
  });
}

// используется вкладкой "люди"/просмотром профиля.
// Без orderBy в самом запросе — сортируем на клиенте, чтобы не требовать
// составной индекс Firestore (та же причина, по которой раньше зависали ответы).
export async function loadUserFeed(uid) {
  const postsQ = query(collection(db, "posts"), where("authorUid", "==", uid));
  const repostsQ = query(collection(db, "reposts"), where("uid", "==", uid));
  const [postsSnap, repostsSnap] = await Promise.all([getDocs(postsQ), getDocs(repostsQ)]);

  const own = postsSnap.docs.map(d => ({ id: d.id, ...d.data(), _isRepost: false }));

  const repostRefs = repostsSnap.docs.map(d => d.data());
  const originals = await Promise.all(repostRefs.map(async (r) => {
    const snap = await getDoc(doc(db, "posts", r.postId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data(), _isRepost: true, _repostedAt: r.createdAt };
  }));

  const merged = [...own, ...originals.filter(Boolean)]
    .sort((a, b) => {
      const ta = (a._isRepost ? a._repostedAt : a.createdAt)?.toMillis?.() || 0;
      const tb = (b._isRepost ? b._repostedAt : b.createdAt)?.toMillis?.() || 0;
      return tb - ta;
    });

  return merged;
}

// стена канала — все посты этого канала, без реposts (у каналов их не бывает)
export async function loadChannelWall(channelId) {
  const q = query(collection(db, "posts"), where("channelId", "==", channelId));
  const snap = await getDocs(q);
  const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  posts.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  return posts;
}

export function renderPostsInto(container, posts, ownerNickname) {
  // тот же приём для чужих страниц и карточек профиля
  enrichAuthors(posts)
    .catch(e => console.warn("Оформление авторов:", e.message))
    .then(() => {
      paintPostsInto(container, posts, ownerNickname);
      // Записи всюду одни и те же — просто показаны в разных местах.
      // Значит и номера им проставляются одинаково: на стене, на странице
      // канала, в подборках. Раньше это работало только в ленте.
      backfillNuid(posts);
    });
}

function paintPostsInto(container, posts, ownerNickname) {
  if (!posts.length) { container.innerHTML = `<div class="stub-note">Тут пока пусто</div>`; return; }
  layoutPosts(container, posts, p => {
    // В репосте автор может быть скрыт — решает сервер, см. revealRepostAuthor
    const html = postToHtml(p, p._isRepost);
    if (!p._isRepost) return html;
    return `<div class="repost-badge"><span class="nf">${ICON.repost}</span> ${escapeHtml(ownerNickname)} репостнул${gendered("", "а", "(а)")}</div>` + html;
  });
  posts.forEach(p => {
    wirePostCard(p, container);
    if (p._isRepost) revealRepostAuthor(p, container);
  });
  revealSequentially(container);
}

// Пока ответ сервера не пришёл, показываем ту же маску, что и при полном
// скрытии — иначе по мельканию настоящего ника всё было бы видно.
async function revealRepostAuthor(p, container) {
  if (!p.authorUid || p.isAnonymous) return;
  const card = container.querySelector(`.post-card[data-id="${p.id}"]`);
  if (!card) return;
  try {
    const snap = await getDoc(doc(db, "postAuthors", p.id));
    if (!snap.exists()) return;
    const a = snap.data();
    const nameEl = card.querySelector(".post-author");
    if (nameEl) {
      nameEl.textContent = a.nickname || "???";
      nameEl.classList.remove("author-masked");
    }
    const wrap = card.querySelector(".post-head .avatar-wrap");
    if (wrap) {
      // Раскрытый автор репоста — с оформлением, как и везде.
      wrap.innerHTML = avatarHtml({
        ...a,
        accessory: a.accessory || "none",
        avatarBorder: a.avatarBorder || "pink"
      }, 34);

      const st = wrap.querySelector(".avatar-status");
      if (st) st.textContent = a.statusEmoji || "";
    }
  } catch {
    // отказ сервера — значит автор закрыл доступ, маска остаётся
  }
}

// Закрывает живую подписку на ленту. Нужна при переходе на другую вкладку:
// без неё каждая открытая лента продолжала бы слушать базу, и подписки
// копились бы с каждым переходом.
export function unsubscribeFeed() {
  if (feedUnsub) { feedUnsub(); feedUnsub = null; }
  lastRenderedPosts = null;
}

// Отказ базы приходит по-английски и человеку ничего не объясняет.
// Переводим самое частое, остальное показываем как есть.
function friendlyError(e) {
  const msg = e?.message || "";
  if (/permission|insufficient/i.test(msg)) {
    return "Не хватает прав — проверь, что правила базы обновлены";
  }
  if (/network|offline|unavailable/i.test(msg)) {
    return "Нет связи с сервером — попробуй ещё раз";
  }
  if (/quota|resource-exhausted/i.test(msg)) {
    return "Слишком много запросов — подожди немного";
  }
  return "Ошибка: " + msg;
}

// Сбрасывает запомненное оформление канала: после его изменения лента должна
// показать новое, а не то, что осталось в памяти с прошлой загрузки.
export function forgetChannelDecor(channelId = null) {
  if (channelId) authorCache.delete("ch:" + channelId);
  else [...authorCache.keys()].filter(k => k.startsWith("ch:")).forEach(k => authorCache.delete(k));
}


// Записи проявляются, а не возникают разом. Сверху вниз, с небольшим
// запозданием у каждой следующей — так видно, что лента загрузилась,
// а не застыла.
//
// Длительности — в modules/animation.js.
function fadeInPosts(host) {
  if (!host) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const cards = [...host.querySelectorAll(".post-card")];
  cards.forEach((el, i) => {
    if (el.dataset.shown) return;    // эта запись уже проявлялась
    el.dataset.shown = "1";

    el.style.animationDelay = `${Math.min(i * TIMING.post.step, TIMING.post.max)}ms`;
    el.classList.add("post-in");

    setTimeout(() => {
      el.classList.remove("post-in");
      el.style.animationDelay = "";
    }, TIMING.post.appear + TIMING.post.max + 80);
  });
}


// Обновляет аватарки и имена авторов, не трогая остальное.
//
// Оформление приходит позже самих записей: в записи лежит копия на момент
// публикации, а настоящее — в профиле. Раньше ради него пересобиралась вся
// лента, и она заметно дёргалась через мгновение после появления.
function repaintAuthors(posts) {
  if (!feedListEl) return;

  // Шапка отвечает за всё, что относится к автору: аватарку с формой
  // и украшением, имя, цвет ника, номер записи. Обновляем её целиком —
  // и получаем разом всё перечисленное.
  for (const p of posts) {
    const card = feedListEl.querySelector(`.post-card[data-id="${p.id}"]`);
    if (card) patchPostCard(card, p);
  }
}


// ============================================================
//  Точечное обновление карточки записи
//
//  Раньше при любом изменении карточка пересобиралась целиком, и вместе
//  с ней терялось всё, что внутри уже живёт: открытая карусель,
//  подгруженный проигрыватель, разложенное видео. А лента при этом
//  заметно дёргалась.
//
//  Теперь сравниваем по частям и меняем только то, что правда изменилось.
//  Части выбраны так, чтобы каждая отвечала за своё: шапка — за автора
//  и время, текст — за текст, действия — за оценки.
// ============================================================

// Что сравниваем и в каком порядке. Порядок важен только для читаемости.
const CARD_PARTS = [
  ".post-head",       // аватарка, имя, цвет ника, номер, время, меню
  ".post-text",       // сам текст
  ".carousel",        // картинки
  ".post-actions"     // оценки, ответы, репост
];

export function patchPostCard(card, post) {
  if (!card) return;

  // Свежая версия записи — для обработчиков: они читают отсюда.
  livePosts.set(post.id, post);

  const next = document.createElement("div");
  next.innerHTML = postToHtml(post);
  const fresh = next.firstElementChild;
  if (!fresh) return;

  for (const part of CARD_PARTS) {
    const a = card.querySelector(part);
    const b = fresh.querySelector(part);

    if (!a && b) { card.appendChild(b.cloneNode(true)); continue; }
    if (a && !b) { a.remove(); continue; }
    if (!a || !b) continue;

    if (a.innerHTML !== b.innerHTML) {
      a.innerHTML = b.innerHTML;

      // В шапке и в действиях живут кнопки — после замены они новые,
      // а обработчики остались на старых. Просим навесить заново.
      if (part === ".post-head" || part === ".post-actions") {
        delete card.dataset.wired;
      }
    }
    if (a.className !== b.className) a.className = b.className;
  }

  // Прикреплённое пересобираем только если изменился текст: номера
  // треков и работ берутся из него.
  const textChanged = card.querySelector(".post-text")?.dataset.raw !== post.text;
  if (textChanged) {
    card.querySelector(".post-text")?.setAttribute("data-raw", post.text || "");
    renderPostTracks(post, card);
    renderPostArtworks(post, card);
  }

  if (card.className !== fresh.className) card.className = fresh.className;

  // Привязываем заново — теперь это безопасно: привязка каждого места
  // делается один раз на элемент, так что навесится только на то, что
  // заменилось, а уже привязанное пропустится.
  wirePostCard(post, card.parentElement || document);
}
