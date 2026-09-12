import { createZip, readZip } from "./zip.js";
import { getSettings, setSetting, DEFAULTS } from "./settings.js";
import { getLogoSound, saveLogoSoundBlob, getParticleImage, saveParticleImageBlob } from "./logo-sound.js";
import { showToast } from "./ui.js";

// ============================================================
//  Перенос настроек вместе с файлами
//
//  Раньше сохранялся только список настроек, а звук логотипа и картинка
//  частиц оставались на старом устройстве — их приходилось выбирать заново.
//  Теперь всё уезжает одним архивом.
//
//  Старый формат (просто список настроек) по-прежнему принимается: файлы
//  переносить незачем, если их и не было.
//
//  ---- о безопасности ----
//  Файл настроек приходит извне, значит доверять ему нельзя. Проверок три:
//
//  1. Разбор в изолированном виде: содержимое читается как данные и никогда
//     не исполняется. Никаких eval и подстановки в разметку.
//  2. Белый список: применяются только известные настройки и только значения
//     ожидаемого вида. Всё лишнее отбрасывается молча — так подложить
//     постороннее поле не выйдет.
//  3. Файлы проверяются по содержимому, а не по названию: смотрим первые
//     байты и убеждаемся, что это правда звук или картинка. Подменить
//     расширение недостаточно.
// ============================================================

const MAX_SOUND = 1024 * 1024;        // как и при обычной загрузке
const MAX_IMAGE = 512 * 1024;
const MAX_JSON = 128 * 1024;          // список настроек не бывает большим

// Первые байты известных форматов. Файл без узнаваемого начала не
// принимается: под видом картинки может приехать что угодно.
const SIGNATURES = {
  image: [
    [0x89, 0x50, 0x4e, 0x47],                     // PNG
    [0xff, 0xd8, 0xff],                           // JPEG
    [0x47, 0x49, 0x46, 0x38],                     // GIF
    [0x52, 0x49, 0x46, 0x46],                     // WEBP (RIFF)
    [0x3c, 0x73, 0x76, 0x67],                     // <svg
    [0x3c, 0x3f, 0x78, 0x6d, 0x6c]                // <?xml (svg с объявлением)
  ],
  audio: [
    [0x49, 0x44, 0x33],                           // MP3 с тегами
    [0xff, 0xfb], [0xff, 0xf3], [0xff, 0xf2],     // MP3 без тегов
    [0x52, 0x49, 0x46, 0x46],                     // WAV
    [0x4f, 0x67, 0x67, 0x53],                     // OGG
    [0x66, 0x4c, 0x61, 0x43]                      // FLAC
  ]
};

function looksLike(kind, bytes) {
  return SIGNATURES[kind].some(sig => sig.every((b, i) => bytes[i] === b));
}

// ---------- сохранение ----------

export async function exportBackup() {
  const files = {
    "settings.json": new TextEncoder().encode(JSON.stringify({
      kind: "nyashboard-settings",
      version: 2,
      savedAt: new Date().toISOString(),
      settings: getSettings()
    }, null, 2))
  };

  const sound = await getLogoSound().catch(() => null);
  if (sound?.blob) files["logo-sound" + extOf(sound.name)] = sound.blob;

  const particle = await getParticleImage().catch(() => null);
  if (particle?.blob) files["particle" + extOf(particle.name)] = particle.blob;

  const zip = await createZip(files);
  const url = URL.createObjectURL(zip);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nyashboard-${new Date().toISOString().slice(0, 10)}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function extOf(name = "") {
  const m = /\.[a-z0-9]{2,5}$/i.exec(name);
  return m ? m[0].toLowerCase() : "";
}

// ---------- восстановление ----------

export async function importBackup(file) {
  if (!file?.size) throw new Error("файл не читается — скопируй его на устройство");

  const isZip = /\.zip$/i.test(file.name) || file.type === "application/zip";
  return isZip ? importFromZip(file) : importFromJson(file);
}

async function importFromJson(file) {
  if (file.size > MAX_JSON) throw new Error("файл настроек подозрительно большой");
  const text = await file.text();
  const applied = applySettingsJson(text);
  return { applied, skipped: [] };
}

async function importFromZip(file) {
  const entries = await readZip(file);
  const skipped = [];

  const jsonBytes = entries["settings.json"];
  if (!jsonBytes) throw new Error("в архиве нет файла настроек");
  if (jsonBytes.length > MAX_JSON) throw new Error("файл настроек подозрительно большой");

  const applied = applySettingsJson(new TextDecoder().decode(jsonBytes));

  // Файлы восстанавливаем по одному: повреждённый пропускаем, но остальное
  // всё равно применяем — иначе одна битая картинка отменяла бы весь перенос.
  for (const [name, bytes] of Object.entries(entries)) {
    if (name === "settings.json") continue;

    try {
      if (name.startsWith("logo-sound")) {
        if (bytes.length > MAX_SOUND) throw new Error("слишком большой");
        if (!looksLike("audio", bytes)) throw new Error("не похоже на звук");
        await saveLogoSoundBlob(new Blob([bytes]), name);
      } else if (name.startsWith("particle")) {
        if (bytes.length > MAX_IMAGE) throw new Error("слишком большая");
        if (!looksLike("image", bytes)) throw new Error("не похоже на картинку");
        await saveParticleImageBlob(new Blob([bytes]), name);
      }
    } catch (e) {
      console.warn(`Файл «${name}» не восстановлен:`, e.message);
      skipped.push(name);
    }
  }

  return { applied, skipped };
}

// Применяет только известные настройки и только подходящие значения.
function applySettingsJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, "").trim());
  } catch {
    throw new Error("это не файл настроек");
  }

  const incoming = parsed?.settings && typeof parsed.settings === "object"
    ? parsed.settings
    : parsed;
  if (!incoming || typeof incoming !== "object") throw new Error("это не файл настроек");

  let applied = 0;
  for (const [key, value] of Object.entries(incoming)) {
    // ключа нет среди известных — пропускаем, не спрашивая
    if (!(key in DEFAULTS)) continue;

    const expected = DEFAULTS[key];
    if (Array.isArray(expected)) {
      if (!Array.isArray(value)) continue;
      // в списках допускаем только короткие строки — порядок вкладок и подобное
      const clean = value.filter(v => typeof v === "string" && v.length <= 40).slice(0, 40);
      setSetting(key, clean);
      applied++;
      continue;
    }
    if (typeof value !== typeof expected) continue;
    if (typeof value === "string" && value.length > 200) continue;

    setSetting(key, value);
    applied++;
  }

  if (!applied) throw new Error("знакомых настроек не нашлось");
  return applied;
}
