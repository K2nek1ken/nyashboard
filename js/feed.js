import {
  db, auth, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, orderBy, limit, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove, increment, where
} from "./firebase.js";
import { currentUser, currentUserDoc, authReady } from "./auth.js";
import { initPostIdentity, identityFields, getPostIdentity } from "./post-identity.js";
import { registerPostNuid } from "./nuid.js";
import { goTo } from "./router.js";
import { wireImageZoom } from "./lightbox.js";
import { askText, askConfirm } from "./dialog.js";
import { uploadImages } from "./storage.js";
import { showToast, escapeHtml, timeAgo, gendered } from "./ui.js";
import { ICON, SVG_ICON } from "./icons.js";
import { fetchReplies, sendReply, replyRowHtml, wireReplyLikes } from "./replies.js";
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

  // Свои каналы нужны, чтобы их записями можно было распоряжаться.
  // Раньше список объявлялся, но никогда не заполнялся.
  import("./channels.js")
    .then(({ fetchManagedChannelIds }) => fetchManagedChannelIds())
    .then(ids => setManagedChannels(ids || []))
    .catch(() => {});
  if (!feedListEl) return;
  if (feedUnsub) return;
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
  feedUnsub = onSnapshot(q, (snap) => {
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
    // Оформление авторов — украшение: если оно не подгрузилось, ленту всё
    // равно показываем, иначе сбой мелочи оставил бы пустой экран.
    enrichAuthors(posts)
      .catch(e => console.warn("Оформление авторов:", e.message))
      .then(() => {
        renderFeed(rankPosts(posts));
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
    if (lastRenderedPosts) renderFeed(rankPosts(lastRenderedPosts));
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

// Записи появляются по очереди сверху вниз, а не все разом: так список
// выглядит живым и глазу проще зацепиться за первую карточку, пока
// подтягиваются остальные. Задержка небольшая и с потолком — иначе на длинной
// ленте нижние карточки ждали бы неприлично долго.
function revealSequentially(container) {
  const cards = container.querySelectorAll(".post-card");
  cards.forEach((card, i) => {
    card.classList.add("appearing");
    setTimeout(() => card.classList.remove("appearing"), Math.min(i * 45, 600));
  });
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

let backfillComplained = false;

async function backfillNuid(posts) {
  if (!currentUser) return;                       // проставить может только вошедший
  if (Date.now() - lastBackfill < 1500) return;

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
      // Раньше отказ уходил в никуда, и понять, почему номеров нет, было
      // невозможно. Теперь причина видна, а про отказ прав говорим вслух —
      // почти всегда это незалитые правила базы.
      console.warn("Номер записи не проставился:", e.message);
      if (!backfillComplained && /permission|insufficient/i.test(e.message)) {
        backfillComplained = true;
        showToast("Номера записей не проставляются — похоже, правила базы не обновлены");
      }
      return;                                      // остальные тоже не пройдут
    }
  }
  // показываем проставленные номера сразу
  if (lastRenderedPosts) renderFeed(rankPosts(lastRenderedPosts));
}

async function enrichAuthors(posts) {
  const uids = [...new Set(
    posts.filter(p => p.authorUid && !p.isAnonymous && p.authorAccessory === undefined)
         .map(p => p.authorUid)
  )];
  const needChannels = posts.some(p => p.channelId && p.channelAccessory === undefined);
  if (!uids.length && !needChannels) return;

  const { getUserDoc } = await import("./data.js");
  await Promise.all(uids.map(async uid => {
    if (authorCache.has(uid)) return;
    authorCache.set(uid, await getUserDoc(uid).catch(() => null));
  }));

  // каналы: оформление тоже могло измениться после публикации
  const channelIds = [...new Set(
    posts.filter(p => p.channelId && p.channelAccessory === undefined).map(p => p.channelId)
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
  const card = feedListEl?.querySelector(`.post-card[data-id="${post.id}"]`);
  if (!card) return;

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

// Сколько колонок помещается. Считаем по фактической ширине списка, а не по
// ширине окна: у окна её могут съедать боковые панели браузера, а масштаб
// страницы сдвигает пороги — из-за этого в одном браузере выходило три
// колонки, а в другом ни одной. Ширина контейнера свободна от этого:
// сколько места реально есть, столько колонок и будет.
const MIN_COLUMN = 330;   // уже этого запись читается плохо

function columnCount(container) {
  // Ширина берётся у самого списка, но в момент первой отрисовки он может быть
  // ещё нулевым — тогда опираемся на окно за вычетом колонки навигации.
  let width = container?.clientWidth || 0;
  if (!width) {
    const sidebar = window.innerWidth >= 900 ? 320 : 0;
    width = Math.max(0, window.innerWidth - sidebar - 80);
  }
  if (!width) return 1;
  return Math.max(1, Math.min(3, Math.floor(width / MIN_COLUMN)));
}

// Примерная высота записи. Точную до отрисовки знать нельзя, но для раскладки
// хватает оценки: важно лишь понимать, какая запись заметно выше остальных.
function estimateHeight(p) {
  let h = 110;                                  // шапка, кнопки, поле ответа
  const text = p.text || "";
  h += Math.min(320, Math.ceil(text.length / 48) * 21);   // строки текста
  if ((p.imageUrls?.length || p.imageUrl) ? 1 : 0) h += 250;  // карусель фиксированной высоты
  if (/#U3\d{6}/i.test(text)) h += 90;           // прикреплённый трек
  return h;
}

// Раскладка по колонкам. Записи идут по порядку, но каждая следующая ложится
// в самую короткую колонку — иначе две записи с фотографиями подряд попадали
// в одну и вытягивали её вдвое, оставляя рядом пустоту.
//
// Порядок чтения при этом сохраняется: первые записи всё равно занимают начала
// колонок слева направо, потому что пустая колонка всегда самая короткая.
function layoutPosts(container, posts, buildHtml) {
  const cols = columnCount(container);
  if (cols === 1) {
    container.innerHTML = posts.map(buildHtml).join("");
    container.classList.remove("has-columns");
    return;
  }

  const buckets = Array.from({ length: cols }, () => []);
  const heights = new Array(cols).fill(0);

  posts.forEach(p => {
    // из равных по высоте выбираем самую левую — так первые записи
    // раскладываются слева направо, как и читаются
    let target = 0;
    for (let i = 1; i < cols; i++) {
      if (heights[i] < heights[target] - 1) target = i;
    }
    buckets[target].push(buildHtml(p));
    heights[target] += estimateHeight(p);
  });

  container.innerHTML = buckets
    .map(items => `<div class="feed-column">${items.join("")}</div>`)
    .join("");
  // Помечаем классом, а не полагаемся на проверку вложенности в стилях:
  // так поведение одинаково во всех браузерах.
  container.classList.add("has-columns");
}

// Правка записи отдельным окном: встроенное поле выглядело неровно и
// сбивало разметку карточки, особенно рядом с фотографиями.
async function startInlineEdit(post, card) {
  const textEl = card.querySelector(".post-text");
  const original = textEl?.dataset.raw || post.text || "";

  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-content" style="max-width:520px;">
      <button class="closeBtn modalClose" data-cancel><span class="nf">${ICON.close}</span></button>
      <h2 style="margin-top:0;font-size:17px;">Изменить запись</h2>
      <textarea class="edit-post-area">${escapeHtml(original)}</textarea>
      <div class="dialog-buttons">
        <button class="secondaryBtn" data-cancel>Отмена</button>
        <button class="primaryBtn" data-save>Сохранить</button>
      </div>
    </div>`;
  document.body.appendChild(box);

  const area = box.querySelector(".edit-post-area");
  const close = () => box.remove();
  box.querySelectorAll("[data-cancel]").forEach(b => b.addEventListener("click", close));
  box.addEventListener("click", (e) => { if (e.target === box) close(); });

  area.focus();
  area.setSelectionRange(area.value.length, area.value.length);

  box.querySelector("[data-save]").addEventListener("click", async () => {
    const next = area.value.trim();
    if (!next || next === original) { close(); return; }

    const saveBtn = box.querySelector("[data-save]");
    saveBtn.disabled = true;
    saveBtn.textContent = "Сохраняю…";
    try {
      await updateDoc(doc(db, "posts", post.id), {
        text: next,
        hashtags: extractHashtags(next),
        editedAt: serverTimestamp()
      });
      post.text = next;

      // обновляем карточку на месте, чтобы правка была видна сразу
      if (textEl) {
        textEl.dataset.raw = next;
        textEl.innerHTML = linkifyMentions(escapeHtml(next.replace(/\s*#U3\d{6}/gi, "").trim()));
        wireMentions(textEl);
      }
      close();
      showToast("Изменено ♡");
    } catch (e) {
      console.error(e);
      showToast("Не вышло: " + e.message);
      saveBtn.disabled = false;
      saveBtn.textContent = "Сохранить";
    }
  });

  area.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) box.querySelector("[data-save]").click();
  });
}

function renderFeed(posts) {
  if (!posts.length) {
    feedListEl.innerHTML = `<div class="stub-note">Пока пусто. Жми «+» и пиши ${gendered("первым", "первой", "первым(ой)")} ♡</div>`;
    return;
  }
  layoutPosts(feedListEl, posts, p => postToHtml(p));
  posts.forEach(p => wirePostCard(p, feedListEl));
  revealSequentially(feedListEl);
  balanceColumns(feedListEl);

  // Если при раскладке ширина ещё не была известна, число колонок могло
  // выйти неверным — проверяем на следующем кадре, когда список уже на месте.
  requestAnimationFrame(() => {
    const shouldBe = columnCount(feedListEl);
    const actual = feedListEl.querySelectorAll(".feed-column").length || 1;
    if (shouldBe !== actual && lastRenderedPosts) renderFeed(rankPosts(lastRenderedPosts));
  });
}

// Оценка высоты приблизительная, поэтому после отрисовки смотрим, что вышло
// на самом деле, и если одна колонка сильно длиннее — переносим в короткую
// нижние записи. Двигаем только с конца: верх ленты трогать нельзя, там
// самое важное, и записи не должны прыгать под уже читающим человеком.
function balanceColumns(container) {
  const columns = [...container.querySelectorAll(".feed-column")];
  if (columns.length < 2) return;

  for (let pass = 0; pass < 4; pass++) {
    const heights = columns.map(c => c.offsetHeight);
    const tallest = heights.indexOf(Math.max(...heights));
    const shortest = heights.indexOf(Math.min(...heights));
    const gap = heights[tallest] - heights[shortest];

    // перекос меньше высоты средней записи выравнивать незачем
    if (gap < 260) return;

    const last = columns[tallest].lastElementChild;
    if (!last) return;
    // перенос не должен сделать короткую колонку длиннее длинной
    if (last.offsetHeight > gap) return;

    columns[shortest].appendChild(last);
  }
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
  const kebabItems = [
    ...(onPostPage ? [] : [{ action: "openPost", label: "Открыть пост", icon: ICON.open }]),
    suppressed
      ? { action: "undoNotInterested", label: "Вернуть в рекомендации", icon: ICON.up }
      : { action: "notInterested", label: "Не рекомендовать", icon: ICON.down },
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
  // длинный текст сворачиваем, чтобы один пост не занимал весь экран
  // Идентификатор трека убираем из текста: он написан на самой карточке
  // проигрывателя, и дублировать его строкой незачем. При правке текст
  // берётся из data-raw, поэтому там идентификатор остаётся на месте.
  const rawText = (p.text || "").replace(/\s*#U3\d{6}/gi, "").trim();
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
        <input type="text" placeholder="Твой ответ..." data-reply-input>
        <button class="nf" data-action="replyEmoji" title="эмодзи">${ICON.smile}</button>
        <button data-action="sendReply"><span class="nf">${ICON.send}</span></button>
      </div>
      <div class="image-preview hidden" data-reply-preview></div>
    </article>`;
}

export function wirePostCard(p, container = document) {
  const card = container.querySelector(`.post-card[data-id="${p.id}"]`);
  if (!card) return;

  wireCarousels(card);
  wireMentions(card);
  observeSeen(card);
  renderPostTracks(p, card);
  renderPostArtworks(p, card);
  wireImageZoom(card);

  card.querySelectorAll('[data-action="viewAuthor"]').forEach(el => {
    el.addEventListener("click", () => {
      const uid = el.dataset.uid;
      if (!uid) { showToast("Это аноним, профиля нет ¯\\_(ツ)_/¯"); return; }
      // Не зовём people.js напрямую — иначе feed.js и people.js импортировали бы
      // друг друга по кругу. Вместо этого просто сообщаем «хотят открыть профиль»,
      // а кто это покажет (и покажет ли) — забота слушателя.
      document.dispatchEvent(new CustomEvent("nyash:view-profile", { detail: { uid } }));
    });
  });
  card.querySelectorAll('[data-action="viewChannel"]').forEach(el => {
    el.addEventListener("click", () => { goTo(`channel.html?id=${el.dataset.channelId}`); });
  });

  card.querySelector('[data-action="like"]').addEventListener("click", () => toggleLike(p));
  card.querySelector('[data-action="dislike"]').addEventListener("click", () => toggleDislike(p));
  card.querySelector('[data-action="repost"]').addEventListener("click", () => repost(p));

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
      if (window.matchMedia("(min-width: 900px)").matches) startInlineEdit(p, card);
      else openPostEditor(p);
    },
    deletePost: () => deletePost(p, card)
  });

  const expandBtn = card.querySelector('[data-action="toggleExpand"]');
  if (expandBtn) {
    const textEl = card.querySelector(".post-text");
    expandBtn.addEventListener("click", () => {
      const expanded = textEl.classList.toggle("expanded");
      expandBtn.innerHTML = expanded
        ? `<span class="nf">${ICON.up}</span> свернуть`
        : `<span class="nf">${ICON.down}</span> показать полностью`;
    });
  }

  const input = card.querySelector('[data-reply-input]');
  card.querySelector('[data-action="focusReply"]').addEventListener("click", () => input.focus());

  // прикрепление фото к ответу
  const fileInput = card.querySelector("[data-reply-file]");
  const previewBox = card.querySelector("[data-reply-preview]");
  let pendingReplyImage = null;
  card.querySelector("[data-reply-attach]").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    pendingReplyImage = file;
    previewBox.classList.remove("hidden");
    previewBox.innerHTML = `<img src="${URL.createObjectURL(file)}"><button class="removeImg" data-remove><span class="nf">${ICON.close}</span></button>`;
    previewBox.querySelector("[data-remove]").addEventListener("click", () => {
      pendingReplyImage = null;
      previewBox.classList.add("hidden");
      previewBox.innerHTML = "";
    });
  });

  card.querySelector('[data-action="replyEmoji"]').addEventListener("click", (e) => {
    e.stopPropagation();
    openEmojiPicker(card.querySelector(".reply-input-row"), (emoji) => {
      input.value += emoji;
      input.focus();
    });
  });

  const sendBtn = card.querySelector('[data-action="sendReply"]');
  const send = async () => {
    const text = input.value.trim();
    if (!text && !pendingReplyImage) return;
    sendBtn.disabled = true;
    try {
      await sendReply(p.id, text, pendingReplyImage);
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
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });

  // Ответы грузим ТОЛЬКО когда карточка появилась на экране. Раньше лента из
  // 50 постов делала 50 запросов к Firestore сразу при открытии страницы —
  // это и медленно, и быстро жжёт бесплатный лимит чтений.
  lazyLoadReplies(p.id, card);
}

// Треки, упомянутые в тексте записи, показываем карточками под ней: ссылка
// вида #U3XXXXXX превращается в проигрыватель, а не остаётся набором символов.
// Работы из «Творчества» по их номеру — как треки, только картинкой.
async function renderPostArtworks(p, card) {
  const ids = [...new Set(((p.text || "").match(/#U5\d{6}/gi) || []))]
    .map(t => t.slice(1).toUpperCase()).slice(0, 3);
  if (!ids.length || card.dataset.artDone) return;
  card.dataset.artDone = "1";

  try {
    const { resolveNuid } = await import("./nuid.js");
    const { getArtwork } = await import("./art.js");
    const { openLightbox } = await import("./lightbox.js");

    const works = [];
    for (const nuid of ids) {
      const hit = await resolveNuid(nuid);
      if (hit?.type !== "art") continue;
      const art = await getArtwork(hit.uid);
      if (art) works.push(art);
    }
    if (!works.length) return;

    const host = document.createElement("div");
    host.className = "post-artworks";
    host.innerHTML = works.map(a => `
      <div class="art-attached">
        <img src="${a.imageUrl}" alt="${escapeHtml(a.title)}" loading="lazy">
        <div class="art-attached-body">
          <div class="art-attached-title">${escapeHtml(a.title)}</div>
          ${a.description ? `<div class="art-desc">${escapeHtml(a.description)}</div>` : ""}
          <span class="track-nuid" data-copy-nuid="${a.publicUid || ""}">${a.publicUid || ""}</span>
        </div>
      </div>`).join("");

    (card.querySelector(".post-text") || card).insertAdjacentElement("afterend", host);
    host.querySelectorAll("img").forEach((img, i) => {
      img.addEventListener("click", () => openLightbox(img.src, works.map(w => w.imageUrl), i));
    });
  } catch (e) {
    console.warn("Работы не подгрузились:", e.message);
  }
}

async function renderPostTracks(p, card) {
  const host = card.querySelector(`[data-post-tracks="${p.id}"]`);
  if (!host) return;
  const ids = [...new Set((p.text || "").match(/#U3\d{6}/gi) || [])]
    .map(t => t.slice(1).toUpperCase());
  if (!ids.length) return;

  try {
    const { resolveNuid } = await import("./nuid.js");
    const { getTrack } = await import("./music.js");
    const { trackCardHtml, wireTrackCards } = await import("./music-ui.js");

    const tracks = [];
    for (const nuid of ids.slice(0, 3)) {     // не больше трёх на запись
      const hit = await resolveNuid(nuid);
      if (hit?.type !== "track") continue;
      const track = await getTrack(hit.uid);
      if (track) tracks.push(track);
    }
    if (!tracks.length) return;

    // Отметка «в любимом» должна быть видна и здесь, а не только в разделе
    // музыки: иначе непонятно, добавлен трек или нет.
    const { loadFavorites } = await import("./music.js");
    const favIds = currentUser
      ? new Set((await loadFavorites().catch(() => [])).map(t => t.id))
      : new Set();

    host.innerHTML = tracks.map(t => trackCardHtml(t, { favorite: favIds.has(t.id) })).join("");
    wireTrackCards(host, tracks, () => renderPostTracks(p, card));
  } catch (e) {
    console.warn("Треки записи не загрузились:", e.message);
  }
}

let replyObserver = null;
function lazyLoadReplies(postId, card) {
  if (!("IntersectionObserver" in window)) { loadReplyPreview(postId, card); return; }
  if (!replyObserver) {
    replyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        replyObserver.unobserve(entry.target);
        loadReplyPreview(entry.target.dataset.id, entry.target);
      });
    }, { rootMargin: "300px" });   // с запасом, чтобы подгрузилось до появления
  }
  replyObserver.observe(card);
}

// Превью топ-3 самых залайканных ответов, реддит-стайл отступ слева.
// Кнопка "показать все N" ведёт на отдельную страницу поста (post.html?id=...).
async function loadReplyPreview(postId, card) {
  const box = card.querySelector(`.replies-preview[data-preview-for="${postId}"]`);
  if (!box) return;
  try {
    const all = await fetchReplies(postId);
    if (!all.length) { box.innerHTML = ""; return; }
    const top3 = all.slice(0, 3);
    box.innerHTML = top3.map(replyRowHtml).join("") +
      (all.length > 3
        ? `<a class="showMoreReplies" href="post.html?id=${postId}">показать все ${all.length} ответов &#8594;</a>`
        : "");
    wireReplyLikes(box, top3);
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="muted">Не смогла загрузить ответы: ${escapeHtml(e.message)}</div>`;
  }
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
  const anonRow = document.getElementById("anonToggleRow");
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
    anonRow.classList.add("hidden"); // автора на редактировании не меняем
  } else {
    title.textContent = "Новый пост";
    publishBtn.textContent = "Опубликовать";
    anonRow.classList.remove("hidden");
    if (!currentUser) {
      anonToggle.checked = true;
      anonToggle.disabled = true;
    } else {
      anonToggle.disabled = false;
      anonToggle.checked = false;
    }
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

  if (fab) fab.addEventListener("click", () => openPostEditor(null));

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
      showToast("Ошибка: " + e.message);
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
      const img = wrap.querySelector("img");
      applyAvatar(img, a, "neko");
      img.style.width = img.style.height = "34px";
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
