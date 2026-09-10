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

export async function listArtworks(count = 40) {
  const snap = await getDocs(query(collection(db, "artworks"),
    orderBy("createdAt", "desc"), limit(count)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getArtwork(id) {
  const snap = await getDoc(doc(db, "artworks", id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
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
