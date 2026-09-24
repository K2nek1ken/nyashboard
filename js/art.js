import {
  db, collection, addDoc, doc, getDoc, getDocs, deleteDoc, updateDoc,
  query, orderBy, limit, serverTimestamp, arrayUnion, arrayRemove, increment
} from "./firebase.js";
import { currentUser, currentUserDoc } from "./auth.js";
import { uploadImage } from "./storage.js";
import { generateUniqueNuid, registerNuid } from "./nuid.js";

// ============================================================
//  Творчество
//
//  Работы художников: картинка на первом месте, к ней название, описание,
//  оценки и обсуждение. От обычных записей отличается тем, что картинка
//  обязательна и показывается крупно — ради неё всё и затевается.
//
//  У каждой работы свой идентификатор вида U5XXXXXX, как у треков.
// ============================================================

export async function uploadArt({ file, title, description }) {
  if (!currentUser) throw new Error("Нужен аккаунт");
  if (!file) throw new Error("Нужна картинка");
  if (!title?.trim()) throw new Error("Нужно название");

  const imageUrl = await uploadImage(file);
  if (!imageUrl) throw new Error("картинка не загрузилась");

  const ref = await addDoc(collection(db, "artworks"), {
    title: title.trim(),
    description: (description || "").trim(),
    imageUrl,
    authorUid: currentUser.uid,
    authorName: currentUserDoc?.nickname || "",
    authorAvatar: currentUserDoc?.avatarUrl || "",
    likesCount: 0,
    likedBy: [],
    createdAt: serverTimestamp()
  });

  const nuid = await generateUniqueNuid(5);
  await registerNuid(ref.id, nuid, "art").catch(() => {});
  await updateDoc(doc(db, "artworks", ref.id), { publicUid: nuid }).catch(() => {});

  return { id: ref.id, publicUid: nuid };
}

// Видеоработа. Устроена так же, как обычная: у неё есть картинка —
// первый кадр, — поэтому в сетке, в поиске и во вложениях она выглядит
// как все остальные. Отличается только тем, что по нажатию играет.
export async function uploadArtVideo({ file, title, description, onProgress }) {
  if (!currentUser) throw new Error("Нужен аккаунт");
  if (!file) throw new Error("Нужно видео");
  if (!title?.trim()) throw new Error("Нужно название");

  const { uploadVideo } = await import("./storage.js");
  const video = await uploadVideo(file, onProgress);

  const ref = await addDoc(collection(db, "artworks"), {
    title: title.trim(),
    description: (description || "").trim(),
    kind: "video",
    videoUrl: video.url,
    imageUrl: video.poster,          // первый кадр — картинкой для сетки
    duration: video.duration || 0,
    authorUid: currentUser.uid,
    authorName: currentUserDoc?.nickname || "",
    authorAvatar: currentUserDoc?.avatarUrl || "",
    likesCount: 0,
    likedBy: [],
    createdAt: serverTimestamp()
  });

  const nuid = await generateUniqueNuid(5);
  await registerNuid(ref.id, nuid, "art").catch(() => {});
  await updateDoc(doc(db, "artworks", ref.id), { publicUid: nuid }).catch(() => {});

  return { id: ref.id, publicUid: nuid };
}

export async function listArtworks(count = 40) {
  try {
    const snap = await getDocs(query(collection(db, "artworks"),
      orderBy("createdAt", "desc"), limit(count)));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // Пока правила для работ не залиты, база отвечает отказом. Показываем
    // это как пустой раздел с понятной причиной, а не как вечную загрузку.
    if (/permission|insufficient/i.test(e.message)) {
      throw new Error("правила базы для работ не задеплоены");
    }
    throw e;
  }
}

export async function getArtwork(id) {
  const snap = await getDoc(doc(db, "artworks", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateArtwork(id, patch) {
  await updateDoc(doc(db, "artworks", id), { ...patch, editedAt: serverTimestamp() });
}

export async function deleteArtwork(id) {
  await deleteDoc(doc(db, "artworks", id));
}

// Оценка с той же защитой, что и у записей: сначала смотрим актуальное
// состояние, чтобы счётчик нельзя было накрутить повторным нажатием.
export async function toggleArtLike(art) {
  if (!currentUser) throw new Error("Войди, чтобы оценивать");
  const ref = doc(db, "artworks", art.id);
  const snap = await getDoc(ref);
  const fresh = snap.exists() ? snap.data() : art;
  const liked = (fresh.likedBy || []).includes(currentUser.uid);

  await updateDoc(ref, {
    likedBy: liked ? arrayRemove(currentUser.uid) : arrayUnion(currentUser.uid),
    likesCount: increment(liked ? -1 : 1)
  });
  return !liked;
}


// Как показать работу: картинкой или видео. Одна функция на все места —
// сетку «Творчества», вложения в ленте и в чате, — чтобы они не разошлись:
// добавишь новый вид работ здесь, и он появится везде.
//
// У видео свои кнопки, поэтому оно проигрывается на месте, а не открывает
// просмотр картинок по нажатию.
export function artMediaHtml(a, className = "") {
  const title = String(a.title || "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  if (a.kind === "video" && a.videoUrl) {
    // Свой проигрыватель, тот же, что у видео в записях: родные кнопки
    // браузера выглядят чужеродно и у каждого свои. Оживить его нужно
    // после вставки — см. wireArtVideos ниже.
    return `<div class="art-video-slot ${className}"
                 data-art-video="${a.videoUrl}" data-art-poster="${a.imageUrl || ""}"></div>`;
  }
  return `<img class="${className}" src="${a.imageUrl}" alt="${title}" loading="lazy">`;
}

// Картинки работ для просмотра — без видео: просмотр листает только их.
export function artImages(works) {
  return works.filter(w => w.kind !== "video").map(w => w.imageUrl);
}


// Вставляет проигрыватель в заготовленные места и оживляет его.
//
// Отдельным шагом, потому что разметка проигрывателя и его обработчики
// живут в своём модуле: держать их копию здесь значило бы разойтись
// с видео в записях при первой же правке.
export async function wireArtVideos(container) {
  const slots = [...(container?.querySelectorAll?.("[data-art-video]") || [])];
  if (!slots.length) return;

  const { videoHtml, wireVideo } = await import("./video-player.js");
  for (const slot of slots) {
    if (slot.dataset.ready) continue;
    slot.dataset.ready = "1";
    slot.innerHTML = videoHtml(slot.dataset.artVideo, { poster: slot.dataset.artPoster });
  }
  wireVideo(container);
}
