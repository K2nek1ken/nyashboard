import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously,
  setPersistence, indexedDBLocalPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDoc, updateDoc, deleteDoc, addDoc,
  query, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion,
  arrayRemove, increment, where, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

import { FIREBASE_CONFIG } from "./config.js";

export const app = initializeApp(FIREBASE_CONFIG);
export const auth = getAuth(app);

// Сессия должна переживать перезагрузку страницы и переключение вкладок.
// Явно просим самое живучее хранилище: IndexedDB, а если браузер его не даёт
// (приватный режим, жёсткие настройки) — откатываемся на localStorage.
// Без этого при каждом обновлении страницы человек выглядел бы вышедшим.
setPersistence(auth, indexedDBLocalPersistence)
  .catch(() => setPersistence(auth, browserLocalPersistence))
  .catch((e) => console.warn("Не удалось включить постоянную сессию:", e.message));
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export {
  signInWithPopup, signOut, onAuthStateChanged, signInAnonymously, setPersistence,
  collection, doc, setDoc, getDoc, updateDoc, deleteDoc, addDoc,
  query, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion,
  arrayRemove, increment, where, getDocs, writeBatch,
  ref, uploadBytes, getDownloadURL
};
