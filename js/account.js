import { db, auth, doc, deleteDoc, getDocs, collection } from "./firebase.js";
import { currentUser, logout } from "./auth.js";
import { clearInterests } from "./interests.js";
import { clearSeen } from "./seen.js";

// Удаление аккаунта своими руками — чтобы не лезть в консоль Firebase после
// каждого теста. Чистим всё, что принадлежит человеку и на что хватает прав.
//
// Записи и сообщения намеренно не трогаем: у них своя система владения,
// и массовое удаление с клиента было бы и медленным, и опасным.
export async function deleteMyAccount() {
  if (!currentUser) throw new Error("Нужен аккаунт");
  const uid = currentUser.uid;

  const userDoc = await import("./data.js").then(m => m.getUserDoc(uid));

  // подколлекции: подписки, друзья, личные данные
  for (const sub of ["subscriptions", "friends", "private"]) {
    const snap = await getDocs(collection(db, "users", uid, sub)).catch(() => null);
    if (snap) await Promise.all(snap.docs.map(d => deleteDoc(d.ref).catch(() => {})));
  }

  // бронь юзернейма и идентификатор
  if (userDoc?.username) {
    await deleteDoc(doc(db, "usernames", userDoc.username.toLowerCase())).catch(() => {});
  }
  await deleteDoc(doc(db, "userNuids", uid)).catch(() => {});

  // сам профиль
  await deleteDoc(doc(db, "users", uid)).catch(() => {});

  // локальные следы
  clearInterests();
  clearSeen();
  localStorage.removeItem("nyash_profile_cache");
  localStorage.removeItem("nyash_channel_subs");

  // и сама учётная запись; если Firebase требует свежий вход — просто выходим
  try {
    await auth.currentUser?.delete();
  } catch {
    await logout();
  }
}
