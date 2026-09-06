import {
  db, auth, collection, addDoc, doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, orderBy, limit, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove, increment, where
} from "./firebase.js";
import { currentUser, currentUserDoc, authReady } from "./auth.js";
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
import { paletteColor } from "./palette.js";
import { openEmojiPicker } from "./emoji.js";
import { extractHashtags } from "./hashtags.js";
import { rankPosts } from "./ranking.js";
import { loadSubscriptions } from "./subscriptions.js";
import { loadFriends } from "./friends.js";
import { learnFromPost, markNotInterested, undoNotInterested, isSuppressed, loadInterests } from "./interests.js";
import { observeSeen, loadSeen } from "./seen.js";

const feedListEl = document.getElementById("feedList");
let feedUnsub = null;
let lastRenderedPosts = null;

// ---------- подписка на общую ленту ----------
// Пересобрать ленту заново: перечитывает отметки прочитанного и интересы,
// затем пересортировывает уже загруженные записи. Полная перезагрузка страницы
// для этого не нужна — данные и так приходят живым потоком.
export async function refreshFeed() {
  await Promise.all([loadSubscriptions(), loadFriends(), loadSeen(), loadInterests()]);
  if (lastRenderedPosts) renderFeed(rankPosts(lastRenderedPosts));
}

// Разовая загрузка последних записей — для подвкладок и подборок, где живая
// подписка не нужна и только тратила бы обращения к базе.
export async function loadRecentPosts(count = 50) {
  const snap = await getDocs(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(count)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function subscribeFeed() {
  if (!feedListEl) return;
  if (feedUnsub) return;
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(50));
  feedUnsub = onSnapshot(q, (snap) => {
    const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lastRenderedPosts = posts;
    enrichAuthors(posts).then(() => renderFeed(rankPosts(posts)));
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

async function enrichAuthors(posts) {
  const uids = [...new Set(
    posts.filter(p => p.authorUid && !p.isAnonymous && p.authorAccessory === undefined)
         .map(p => p.authorUid)
  )];
  if (!uids.length) return;

  const { getUserDoc } = await import("./data.js");
  await Promise.all(uids.map(async uid => {
    if (authorCache.has(uid)) return;
    authorCache.set(uid, await getUserDoc(uid).catch(() => null));
  }));

  posts.forEach(p => {
    const u = p.authorUid && authorCache.get(p.authorUid);
    if (!u) return;
    if (p.authorAccessory === undefined) p.authorAccessory = u.accessory || "none";
    if (p.authorBorder === undefined) p.authorBorder = u.avatarBorder || "pink";
    if (p.authorNickColor === undefined) p.authorNickColor = u.nickColor || "";
    if (!p.authorShape) p.authorShape = u.avatarShape || "circle";
  });
}

function renderFeed(posts) {
  if (!posts.length) {
    feedListEl.innerHTML = `<div class="stub-note">Пока пусто. Жми «+» и пиши ${gendered("первым", "первой", "первым(ой)")} ♡</div>`;
    return;
  }
  feedListEl.innerHTML = posts.map(p => postToHtml(p)).join("");
  posts.forEach(p => wirePostCard(p, feedListEl));
  revealSequentially(feedListEl);
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
  const nameStyle = (!isChannelPost && !p.isAnonymous && !masked && p.authorNickColor)
    ? ` style="color:${paletteColor(p.authorNickColor)}"` : "";
  const authorAttrs = isChannelPost
    ? `data-action="viewChannel" data-channel-id="${p.channelId}"`
    : `data-action="viewAuthor" data-uid="${p.authorUid || ""}"`;
  const liked = currentUser && (p.likedBy || []).includes(currentUser.uid);
  const disliked = currentUser && (p.dislikedBy || []).includes(currentUser.uid);
  const canManage = canManagePost(p);
  const hasEditor = !!document.getElementById("postEditor");
  const onPostPage = location.pathname.endsWith("post.html");
  const suppressed = isSuppressed(p.id);
  const kebabItems = [
    ...(onPostPage ? [] : [{ action: "openPost", label: "Открыть пост", icon: ICON.open }]),
    suppressed
      ? { action: "undoNotInterested", label: "Вернуть в рекомендации", icon: ICON.up }
      : { action: "notInterested", label: "Не рекомендовать", icon: ICON.down },
    ...(canManage
      ? [
          ...(hasEditor ? [{ action: "editPost", label: "Изменить", icon: ICON.pencil }] : []),
          { action: "deletePost", label: "Удалить", icon: ICON.close, danger: true }
        ]
      : [])
  ];
  // длинный текст сворачиваем, чтобы один пост не занимал весь экран
  const rawText = p.text || "";
  const isLong = rawText.length > 420 || rawText.split("\n").length > 10;
  const authorForAvatar = isChannelPost
    ? { avatarUrl: p.channelAvatar, avatarShape: "rounded" }
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
          <span class="post-time">${timeAgo(p.createdAt)}${p.editedAt ? '<span class="post-edited-tag">(изменено)</span>' : ""}</span>
          ${kebabHtml(kebabItems, p.id)}
        </div>
      </div>
      <div class="post-text ${isLong ? "collapsible" : ""}">${linkifyMentions(escapeHtml(rawText))}</div>
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
    el.addEventListener("click", () => { location.href = `channel.html?id=${el.dataset.channelId}`; });
  });

  card.querySelector('[data-action="like"]').addEventListener("click", () => toggleLike(p));
  card.querySelector('[data-action="dislike"]').addEventListener("click", () => toggleDislike(p));
  card.querySelector('[data-action="repost"]').addEventListener("click", () => repost(p));

  wireKebab(card, {
    openPost: () => { location.href = `post.html?id=${p.id}`; },
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
    editPost: () => openPostEditor(p),
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
    host.innerHTML = tracks.map(t => trackCardHtml(t)).join("");
    wireTrackCards(host, tracks);
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

async function toggleLike(p) {
  if (!currentUser) { showToast("Войди, чтобы лайкать ♡"); return; }
  const liked = (p.likedBy || []).includes(currentUser.uid);
  await updateDoc(doc(db, "posts", p.id), {
    likedBy: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
    likesCount: increment(liked ? -1 : 1)
  });
  // лайк — главный сигнал для рекомендаций; снятие лайка откатывает его
  learnFromPost(p, liked ? -3 : 3);
}

async function toggleDislike(p) {
  if (!currentUser) { showToast("Войди, чтобы дизлайкать"); return; }
  const disliked = (p.dislikedBy || []).includes(currentUser.uid);
  await updateDoc(doc(db, "posts", p.id), {
    dislikedBy: disliked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
    dislikesCount: increment(disliked ? -1 : 1)
  });
  learnFromPost(p, disliked ? 3 : -3);
}

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
  const anonToggle = document.getElementById("postAnonToggle");
  const anonLabel = document.getElementById("postAnonLabel");
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
      anonLabel.textContent = "гость — всегда анонимно";
    } else {
      anonToggle.disabled = false;
      anonToggle.checked = false;
      anonLabel.textContent = "от своего имени";
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
  const anonToggle = document.getElementById("postAnonToggle");
  const anonLabel = document.getElementById("postAnonLabel");
  const imageInput = document.getElementById("postImageInput");
  const publishBtn = document.getElementById("publishPostBtn");

  if (fab) fab.addEventListener("click", () => openPostEditor(null));

  anonToggle.addEventListener("change", () => {
    anonLabel.textContent = anonToggle.checked ? "анонимно" : "от своего имени";
  });

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
        const isAnon = !currentUser || anonToggle.checked;
        const ref = await addDoc(collection(db, "posts"), {
          authorUid: (!isAnon && currentUser) ? currentUser.uid : null,
          authorNickname: (!isAnon && currentUserDoc) ? currentUserDoc.nickname : null,
          authorAvatar: (!isAnon && currentUserDoc) ? currentUserDoc.avatarUrl : null,
          authorShape: (!isAnon && currentUserDoc) ? (currentUserDoc.avatarShape || "circle") : null,
          authorStatus: (!isAnon && currentUserDoc) ? (currentUserDoc.statusEmoji || "") : null,
          // украшение, цвет рамки и цвет ника — часть образа автора, и они
          // должны быть видны прямо в ленте, без запроса профиля на каждую запись
          authorAccessory: (!isAnon && currentUserDoc) ? (currentUserDoc.accessory || "none") : null,
          authorBorder: (!isAnon && currentUserDoc) ? (currentUserDoc.avatarBorder || "pink") : null,
          authorNickColor: (!isAnon && currentUserDoc) ? (currentUserDoc.nickColor || "") : null,
          channelId: null,
          isAnonymous: isAnon,
          text,
          hashtags: extractHashtags(text),
          imageUrls,
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
        if (!isAnon && currentUser && currentUserDoc) {
          await setDoc(doc(db, "postAuthors", ref.id), {
            uid: currentUser.uid,
            nickname: currentUserDoc.nickname || "",
            avatarUrl: currentUserDoc.avatarUrl || "",
            avatarShape: currentUserDoc.avatarShape || "circle",
            statusEmoji: currentUserDoc.statusEmoji || ""
          }).catch(() => {});
        }
        markOwned("post", ref.id);
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
  enrichAuthors(posts).then(() => paintPostsInto(container, posts, ownerNickname));
}

function paintPostsInto(container, posts, ownerNickname) {
  if (!posts.length) { container.innerHTML = `<div class="stub-note">Тут пока пусто</div>`; return; }
  container.innerHTML = posts.map(p => {
    // В репосте автор может быть скрыт — решает сервер, см. revealRepostAuthor
    const html = postToHtml(p, p._isRepost);
    if (!p._isRepost) return html;
    return `<div class="repost-badge"><span class="nf">${ICON.repost}</span> ${escapeHtml(ownerNickname)} репостнул${gendered("", "а", "(а)")}</div>` + html;
  }).join("");
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
