// Звук логотипа. Файл хранится в браузере (IndexedDB), а не на сервере:
// заливать чужие аудиофайлы в общее хранилище незачем, а так у каждого свой
// звук и никакого трафика.
const DB_NAME = "nyash_media";
const STORE = "sounds";
const KEY = "logo";
const PARTICLE_KEY = "particle";

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
  if (!file.size) throw new Error("файл не читается — скопируй его на устройство и выбери оттуда");
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

// ---------- своя картинка для частиц ----------
// Хранится рядом со звуком логотипа: тоже личный файл, который незачем
// отправлять на сервер.

// До трёх мегабайт: обычные фотографии столько и весят, а прежний предел
// в полмегабайта отсекал почти всё.
//
// Картинка при этом уменьшается перед сохранением: на экране частица занимает
// пару десятков точек, и хранить ради неё снимок на четыре тысячи точек
// незачем — это только память и торможение при отрисовке.
const MAX_PARTICLE_SOURCE = 3 * 1024 * 1024;
const PARTICLE_SIZE = 256;

export async function saveParticleImage(file) {
  if (!file.size) throw new Error("файл не читается — скопируй его на устройство");
  if (file.size > MAX_PARTICLE_SOURCE) throw new Error("картинка больше 3 МБ — возьми полегче");

  // Векторные оставляем как есть: они и так лёгкие, а уменьшение их бы
  // испортило — весь смысл в том, что они не теряют чёткости.
  const isVector = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  const blob = isVector ? file : await shrinkImage(file, PARTICLE_SIZE);
  return saveParticleImageBlob(blob, file.name);
}

// Уменьшает картинку, сохраняя пропорции и прозрачность.
function shrinkImage(file, maxSide) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);

      // png, а не jpeg: у него есть прозрачность, без которой частица
      // превратилась бы в прямоугольник с фоном
      canvas.toBlob(
        (out) => out ? resolve(out) : reject(new Error("не вышло уменьшить картинку")),
        "image/png"
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("это не картинка или формат не поддерживается"));
    };
    img.src = url;
  });
}

export async function getParticleImage() {
  try {
    const { store } = await withStore("readonly");
    return new Promise((resolve) => {
      const r = store.get(PARTICLE_KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}

export async function clearParticleImage() {
  const { store } = await withStore("readwrite");
  store.delete(PARTICLE_KEY);
}

// Сохранение из готового содержимого — для восстановления из архива, где
// файл уже проверен и приходит не от выбора в диалоге.
export async function saveLogoSoundBlob(blob, name = "logo") {
  const { store } = await withStore("readwrite");
  return new Promise((resolve, reject) => {
    const r = store.put({ blob, name }, KEY);
    r.onsuccess = () => resolve(name);
    r.onerror = () => reject(r.error);
  });
}

export async function saveParticleImageBlob(blob, name = "particle") {
  const { store } = await withStore("readwrite");
  return new Promise((resolve, reject) => {
    const r = store.put({ blob, name }, PARTICLE_KEY);
    r.onsuccess = () => resolve(name);
    r.onerror = () => reject(r.error);
  });
}
