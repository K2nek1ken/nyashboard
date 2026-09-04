import {
  db, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp
} from "./firebase.js";
import { currentUser } from "./auth.js";
import { dmChatId } from "./friends.js";

// Личные чаты. Один документ на пару людей, id — оба uid по алфавиту, чтобы
// у пары всегда был ровно один чат независимо от того, кто написал первым.
// Создать его правила разрешают только при взаимной дружбе, поэтому написать
// в личку постороннему нельзя даже в обход интерфейса.

export async function openOrCreateChat(otherUid) {
  if (!currentUser) throw new Error("Нужен аккаунт");
  const chatId = dmChatId(currentUser.uid, otherUid);
  const ref = doc(db, "dmChats", chatId);

  const snap = await getDoc(ref).catch(() => null);
  if (snap?.exists()) return chatId;

  try {
    await setDoc(ref, {
      participants: [currentUser.uid, otherUid].sort(),
      createdAt: serverTimestamp(),
      lastMessage: "",
      lastAt: serverTimestamp(),
      lastSender: ""
    });
    return chatId;
  } catch (e) {
    // Отказ базы тут означает ровно одно: дружба не взаимная.
    throw new Error("Чат откроется, только когда вы добавите друг друга в друзья");
  }
}

export async function listChats() {
  if (!currentUser) return [];
  const q = query(collection(db, "dmChats"),
                  where("participants", "array-contains", currentUser.uid));
  const snap = await getDocs(q);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.lastAt?.toMillis?.() || 0) - (a.lastAt?.toMillis?.() || 0));
}

// Порядок в запросе — по убыванию, разворот на клиенте. С "asc" limit отдавал бы
// первые 200 сообщений переписки, то есть самые старые: после двухсотого
// сообщения новые в чат просто не приходили бы.
export function subscribeMessages(chatId, onUpdate, onError) {
  const q = query(collection(db, "dmChats", chatId, "messages"),
                  orderBy("createdAt", "desc"), limit(200));
  return onSnapshot(q,
    snap => onUpdate(snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse()),
    err => onError?.(err));
}

export async function sendMessage(chatId, text, imageUrl = null) {
  await addDoc(collection(db, "dmChats", chatId, "messages"), {
    senderUid: currentUser.uid,
    text,
    imageUrl,
    createdAt: serverTimestamp()
  });
  // превью для списка чатов
  await updateDoc(doc(db, "dmChats", chatId), {
    lastMessage: (text || "фото").slice(0, 80),
    lastAt: serverTimestamp(),
    lastSender: currentUser.uid
  }).catch(() => {});
}

export async function editMessage(chatId, msgId, text) {
  await updateDoc(doc(db, "dmChats", chatId, "messages", msgId),
                  { text, editedAt: serverTimestamp() });
}

export async function deleteMessage(chatId, msgId) {
  await deleteDoc(doc(db, "dmChats", chatId, "messages", msgId));
}

export function otherParticipant(chat) {
  return (chat.participants || []).find(u => u !== currentUser?.uid);
}
