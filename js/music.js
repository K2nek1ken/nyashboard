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
