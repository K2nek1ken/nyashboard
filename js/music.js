import {
  db, collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc, updateDoc,
  query, orderBy, limit, where, serverTimestamp, arrayUnion, arrayRemove, increment
} from "./firebase.js";
import { currentUser, currentUserDoc } from "./auth.js";
import { uploadAudio, uploadImage } from "./storage.js";
import { generateUniqueNuid, registerNuid } from "./nuid.js";

// ============================================================
//  Музыка
//
//  Треки лежат в общей библиотеке, файлы — на том же бесплатном хранилище,
//  что и картинки (оно принимает произвольные файлы, а не только изображения).
//
//  У каждого трека свой идентификатор вида U3XXXXXX: по нему трек можно
//  прикрепить к записи, как упоминание.
// ============================================================

export async function uploadTrack({ file, title, artist, coverFile, onProgress }) {
  if (!currentUser) throw new Error("Нужен аккаунт");
  if (!title?.trim()) throw new Error("Нужно название");

  const url = await uploadAudio(file, onProgress);
  const coverUrl = coverFile ? await uploadImage(coverFile) : null;

  // Длительность читаем в браузере: сервер её не сообщит, а показывать
  // продолжительность на карточке нужно.
  const duration = await readDuration(url);

  const ref = await addDoc(collection(db, "tracks"), {
    title: title.trim(),
    artist: (artist || "").trim(),
    url,
    coverUrl,
    duration,
    format: (file.name.split(".").pop() || "").toLowerCase(),
    sizeBytes: file.size,
    uploaderUid: currentUser.uid,
    uploaderName: currentUserDoc?.nickname || "",
    likesCount: 0,
    likedBy: [],
    createdAt: serverTimestamp()
  });

  const nuid = await generateUniqueNuid(3);
  await registerNuid(ref.id, nuid, "track").catch(() => {});
  await updateDoc(doc(db, "tracks", ref.id), { publicUid: nuid }).catch(() => {});

  return { id: ref.id, publicUid: nuid };
}

// Длительность читается браузером, а он может и не ответить: файл ещё не
// раздаётся хранилищем, отвечает медленно, мешает политика доступа. Без
// ограничения по времени обещание висело бы вечно — и публикация вместе с ним,
// без единой ошибки. Длительность не критична: не узнали — покажем прочерк.
function readDuration(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const audio = new Audio();
    let done = false;
    const finish = (value) => { if (!done) { done = true; resolve(value); } };

    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Math.round(audio.duration) || 0);
    audio.onerror = () => finish(0);
    setTimeout(() => finish(0), timeoutMs);
    audio.src = url;
  });
}

export async function listTracks(count = 50) {
  const snap = await getDocs(query(collection(db, "tracks"),
    orderBy("createdAt", "desc"), limit(count)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getTrack(trackId) {
  const snap = await getDoc(doc(db, "tracks", trackId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function deleteTrack(trackId) {
  await deleteDoc(doc(db, "tracks", trackId));
}

// ================== Любимое ==================
// Хранится в приватной части аккаунта, как интересы и подписки.

export async function toggleFavorite(track) {
  if (!currentUser) throw new Error("Нужен аккаунт");
  const ref = doc(db, "users", currentUser.uid, "music", track.id);
  const existing = await getDoc(ref);

  if (existing.exists()) {
    await deleteDoc(ref);
    await updateDoc(doc(db, "tracks", track.id), {
      likedBy: arrayRemove(currentUser.uid), likesCount: increment(-1)
    }).catch(() => {});
    return false;
  }
  await setDoc(ref, { addedAt: serverTimestamp() });
  await updateDoc(doc(db, "tracks", track.id), {
    likedBy: arrayUnion(currentUser.uid), likesCount: increment(1)
  }).catch(() => {});
  return true;
}

export async function loadFavorites(uid = currentUser?.uid) {
  if (!uid) return [];
  const snap = await getDocs(collection(db, "users", uid, "music"));
  const tracks = await Promise.all(snap.docs.map(d => getTrack(d.id)));
  return tracks.filter(Boolean);
}

export function formatDuration(seconds) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}


// ============================================================
//  Плейлисты
//
//  Лежат в приватной части аккаунта, рядом с любимым: это личные подборки,
//  и показывать их кому-то, кроме владельца, незачем.
//
//  В подборке хранятся только идентификаторы треков — сами треки живут в общей
//  библиотеке. Так подборка не ломается, если трек переименуют, и не занимает
//  лишнего места.
// ============================================================

export async function listPlaylists() {
  if (!currentUser) return [];
  const snap = await getDocs(collection(db, "users", currentUser.uid, "playlists"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function createPlaylist(name) {
  if (!currentUser) throw new Error("Нужен аккаунт");
  if (!name?.trim()) throw new Error("Нужно название");
  const ref = await addDoc(collection(db, "users", currentUser.uid, "playlists"), {
    name: name.trim(),
    trackIds: [],
    updatedAt: Date.now()
  });
  return ref.id;
}

export async function renamePlaylist(playlistId, name) {
  await updateDoc(doc(db, "users", currentUser.uid, "playlists", playlistId),
                  { name: name.trim(), updatedAt: Date.now() });
}

export async function deletePlaylist(playlistId) {
  await deleteDoc(doc(db, "users", currentUser.uid, "playlists", playlistId));
}

export async function addToPlaylist(playlistId, trackId) {
  const ref = doc(db, "users", currentUser.uid, "playlists", playlistId);
  const snap = await getDoc(ref);
  const ids = snap.data()?.trackIds || [];
  if (ids.includes(trackId)) return false;      // уже есть — не дублируем
  await updateDoc(ref, { trackIds: [...ids, trackId], updatedAt: Date.now() });
  return true;
}

export async function removeFromPlaylist(playlistId, trackId) {
  const ref = doc(db, "users", currentUser.uid, "playlists", playlistId);
  const snap = await getDoc(ref);
  const ids = (snap.data()?.trackIds || []).filter(id => id !== trackId);
  await updateDoc(ref, { trackIds: ids, updatedAt: Date.now() });
}

// Треки подборки в заданном порядке. Пропавшие (удалённые из библиотеки)
// молча отбрасываем — иначе подборка ломалась бы целиком из-за одного трека.
export async function loadPlaylistTracks(playlist) {
  const tracks = await Promise.all((playlist.trackIds || []).map(id => getTrack(id).catch(() => null)));
  return tracks.filter(Boolean);
}

// Порядок в любимом человек задаёт сам: «поднять наверх» переставляет трек
// в начало. Порядок хранится отдельно, потому что в самих записях его нет.
const FAV_ORDER_KEY = "favOrder";

export async function moveFavoriteToTop(trackId) {
  if (!currentUser) return;
  const ref = doc(db, "users", currentUser.uid, "private", FAV_ORDER_KEY);
  const snap = await getDoc(ref);
  const order = (snap.exists() ? snap.data().ids : []) || [];
  const next = [trackId, ...order.filter(id => id !== trackId)];
  await setDoc(ref, { ids: next }, { merge: true });
}

export async function loadFavoriteOrder() {
  if (!currentUser) return [];
  const snap = await getDoc(doc(db, "users", currentUser.uid, "private", FAV_ORDER_KEY)).catch(() => null);
  return snap?.exists() ? (snap.data().ids || []) : [];
}
