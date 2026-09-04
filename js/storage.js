import { IMAGE_HOSTS, IMGBB_API_KEY } from "./config.js";

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
    const res = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
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
    const res = await fetch("https://uguu.se/upload?output=text", { method: "POST", body: form });
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

// «Сохранить всё локально» — выгружает снепшот того, что сейчас в памяти приложения, в JSON-файл.
export function exportLocalBackup(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nyashboard-backup-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
