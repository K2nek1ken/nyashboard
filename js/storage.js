import { IMAGE_HOSTS, IMGBB_API_KEY, CLOUDINARY_CLOUD, CLOUDINARY_PRESET } from "./config.js";

// Сжимаем перед отправкой — телефонные фото часто 3000-4000px в ширину и по
// несколько мегабайт каждое; для ленты за глаза хватает 1600px по длинной
// стороне. Меньше данных — быстрее уходит, независимо от того, какой сервис
// принимает на другом конце. Если сжать не вышло (старый браузер и т.п.) —
// просто грузим оригинал, не роняем публикацию из-за этого.
async function compressImage(file, maxDim = 1600, quality = 0.85) {
  if (!file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) { bitmap.close?.(); return file; } // уже компактное, сжимать незачем
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch (e) {
    console.warn("Не смогла сжать картинку, гружу как есть:", e);
    return file;
  }
}

// ================== Загрузчики ==================
// Каждый возвращает публичный URL картинки либо кидает ошибку.
// Все — бесплатные и без обязательной оплаты. Firebase Storage отсюда убран
// намеренно: с конца 2024 Google требует привязанный биллинг (тариф Blaze)
// даже для создания бакета, так что как "бесплатная подушка" он не годится.

// Обычный запрос не отменяется сам по себе: если сервер молчит, обещание
// висит бесконечно. Отсюда и «вечная публикация» без единой ошибки.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (e) {
    if (e.name === "AbortError") throw new Error("хранилище не ответило вовремя");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Для больших файлов обычного запроса мало: он не сообщает, сколько уже ушло,
// и человек смотрит на неподвижную надпись, гадая, идёт ли что-то вообще.
// Здесь запрос старого образца — он единственный умеет отдавать ход отправки.
// Отсчёт времени тоже другой: он сбрасывается на каждом сдвиге, поэтому
// медленная, но живая загрузка не обрывается по общему сроку.
function uploadWithProgress(url, formData, { onProgress, stallMs = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stallTimer = null;

    const resetStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        xhr.abort();
        reject(new Error("отправка остановилась — проверь связь"));
      }, stallMs);
    };

    xhr.upload.onprogress = (e) => {
      resetStall();
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      clearTimeout(stallTimer);
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText.trim());
      else reject(new Error(`ответ ${xhr.status}`));
    };
    xhr.onerror = () => {
      clearTimeout(stallTimer);
      reject(new Error("не удалось соединиться с хранилищем"));
    };
    xhr.onabort = () => clearTimeout(stallTimer);

    xhr.open("POST", url);
    resetStall();
    xhr.send(formData);
  });
}

const UPLOADERS = {
  // Быстрый, но требует ключ и имеет суточные лимиты на бесплатном тарифе.
  async imgbb(file) {
    const base64 = await fileToBase64(file);
    const form = new FormData();
    form.append("key", IMGBB_API_KEY);
    form.append("image", base64.split(",")[1]);

    const res = await fetch("https://api.imgbb.com/1/upload", { method: "POST", body: form });
    let json;
    try { json = await res.json(); }
    catch { throw new Error(`imgbb вернул не-JSON (HTTP ${res.status})`); }

    // imgbb иногда отвечает HTTP 200 даже при мягком отказе (например, при рейт-лимите),
    // поэтому проверяем не только res.ok, но и реальное содержимое ответа.
    if (!res.ok || json.success !== true || !json.data?.url) {
      throw new Error(json?.error?.message || json?.status_txt || `HTTP ${res.status}`);
    }
    return json.data.url;
  },

  // Без ключей и без регистрации вообще. Медленнее imgbb, зато нечему кончиться.
  async catbox(file) {
    const form = new FormData();
    form.append("reqtype", "fileupload");
    form.append("fileToUpload", file, file.name);
    // Ограничение по времени обязательно: если хранилище не отвечает, запрос
    // висит без ошибки, и человек смотрит на бесконечную «загрузку».
    const res = await fetchWithTimeout("https://catbox.moe/user/api.php",
      { method: "POST", body: form }, 90000);
    const text = (await res.text()).trim();
    if (!res.ok || !text.startsWith("https://")) {
      throw new Error(text.slice(0, 120) || `HTTP ${res.status}`);
    }
    return text;
  },

  // Тоже без ключей. Файлы живут ограниченное время (около часа по умолчанию),
  // поэтому стоит последним — только чтобы публикация вообще не сорвалась.
  async uguu(file) {
    const form = new FormData();
    form.append("files[]", file, file.name);
    const res = await fetchWithTimeout("https://uguu.se/upload?output=text",
      { method: "POST", body: form }, 90000);
    const text = (await res.text()).trim();
    if (!res.ok || !text.startsWith("https://")) {
      throw new Error(text.slice(0, 120) || `HTTP ${res.status}`);
    }
    return text;
  }
};

// Идём по списку из config.js сверху вниз: первый сработавший побеждает.
// Если сервис отвалился (лимит, недоступен, CORS) — молча пробуем следующий,
// и только когда закончились все — сдаёмся с понятной ошибкой.
export async function uploadImage(file) {
  if (!file) return null;
  const compressed = await compressImage(file);

  const errors = [];
  for (const hostName of IMAGE_HOSTS) {
    const uploader = UPLOADERS[hostName];
    if (!uploader) { console.warn(`Неизвестный хост "${hostName}" в IMAGE_HOSTS, пропускаю`); continue; }
    if (hostName === "imgbb" && !IMGBB_API_KEY) { continue; } // без ключа нет смысла и пробовать
    try {
      return await uploader(compressed);
    } catch (e) {
      console.warn(`${hostName} не сработал:`, e.message);
      errors.push(`${hostName}: ${e.message}`);
    }
  }
  throw new Error(`не удалось загрузить "${file.name}" — ${errors.join("; ")}`);
}

// Грузит несколько файлов ПАРАЛЛЕЛЬНО — для 5-10 фото последовательная загрузка
// была заметно медленной (каждый запрос — секунда-две, помноженные на
// количество фото). Параллельно — тот же итог за время самого долгого запроса,
// а не суммы всех.
export async function uploadImages(files) {
  return Promise.all(files.map(file => uploadImage(file)));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


// ================== Аудио ==================
// Картинки сжимаются перед отправкой, музыку трогать нельзя — иначе потеряется
// то, ради чего люди и выкладывают FLAC. Поэтому файл уходит как есть, а из
// цепочки хостингов подходит только тот, что принимает произвольные файлы:
// imgbb работает исключительно с изображениями.
const AUDIO_TYPES = /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i;
const MAX_AUDIO_MB = 25;

export function isAudioFile(file) {
  return file && (file.type.startsWith("audio/") || AUDIO_TYPES.test(file.name));
}

// Загрузка аудио идёт запросом с отслеживанием хода: файлы тяжёлые, и без
// этого непонятно, идёт ли отправка вообще. onProgress получает долю от 0 до 1.
export async function uploadAudio(file, onProgress = null) {
  if (!isAudioFile(file)) throw new Error("это не аудиофайл");
  // Нулевой размер означает, что файл лежит там, откуда браузер его прочитать
  // не может: подключённый телефон, сетевой диск. Выбрать даёт, а содержимого нет.
  if (!file.size) throw new Error("файл не читается — скопируй его на устройство и выбери оттуда");
  const mb = file.size / (1024 * 1024);
  if (mb > MAX_AUDIO_MB) throw new Error(`файл больше ${MAX_AUDIO_MB} МБ`);

  if (!CLOUDINARY_CLOUD || !CLOUDINARY_PRESET) {
    throw new Error("хранилище для музыки не настроено — см. js/config.js");
  }

  // Аудио отправляется как «video»: у Cloudinary это общий раздел для всего,
  // что не картинка, и звук туда входит.
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", CLOUDINARY_PRESET);

  const text = await uploadWithProgress(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/video/upload`,
    form, { onProgress }
  );

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error("хранилище ответило непонятным образом"); }

  if (json.error) throw new Error(json.error.message || "хранилище отказало");
  if (!json.secure_url) throw new Error("хранилище не вернуло ссылку");
  return json.secure_url;
}
