// Звук логотипа. Файл хранится в браузере (IndexedDB), а не на сервере:
// заливать чужие аудиофайлы в общее хранилище незачем, а так у каждого свой
// звук и никакого трафика.
const DB_NAME = "nyash_media";
const STORE = "sounds";
const KEY = "logo";

function withStore(mode) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const tx = req.result.transaction(STORE, mode);
      resolve({ store: tx.objectStore(STORE), db: req.result });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveLogoSound(file) {
  if (file.size > 1024 * 1024) throw new Error("Файл больше мегабайта — возьми покороче");
  const { store } = await withStore("readwrite");
  return new Promise((resolve, reject) => {
    const r = store.put({ blob: file, name: file.name }, KEY);
    r.onsuccess = () => resolve(file.name);
    r.onerror = () => reject(r.error);
  });
}

export async function getLogoSound() {
  try {
    const { store } = await withStore("readonly");
    return new Promise((resolve) => {
      const r = store.get(KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function clearLogoSound() {
  const { store } = await withStore("readwrite");
  store.delete(KEY);
}

let cachedUrl = null;
export async function playLogoSound() {
  const rec = await getLogoSound();
  if (!rec) return false;
  if (!cachedUrl) cachedUrl = URL.createObjectURL(rec.blob);
  const audio = new Audio(cachedUrl);
  audio.volume = 0.7;
  audio.play().catch(() => {});
  return true;
}
