// ============================================================
//  Чтение и сборка zip-архивов
//
//  Своя реализация вместо библиотеки: нужен ровно один формат и две
//  операции, а лишняя зависимость на пару сотен килобайт того не стоит.
//
//  При сборке файлы кладутся без сжатия: внутри музыка и картинки, они уже
//  сжаты, и повторное сжатие только тратило бы время.
//  При чтении поддерживаются оба способа — и без сжатия, и обычный: архив
//  мог быть пересобран чем угодно.
// ============================================================

const textEncoder = new TextEncoder();

// ---------- сборка ----------

export async function createZip(files) {
  const entries = [];
  const chunks = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = content instanceof Uint8Array
      ? content
      : new Uint8Array(await new Response(content).arrayBuffer());
    const nameBytes = textEncoder.encode(name);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // подпись локальной записи
    lv.setUint16(4, 20, true);           // минимальная версия
    lv.setUint16(6, 0, true);            // флаги
    lv.setUint16(8, 0, true);            // без сжатия
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    chunks.push(local, data);
    entries.push({ nameBytes, crc, size: data.length, offset });
    offset += local.length + data.length;
  }

  // оглавление архива
  const dirChunks = [];
  let dirSize = 0;
  for (const e of entries) {
    const rec = new Uint8Array(46 + e.nameBytes.length);
    const dv = new DataView(rec.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(10, 0, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.size, true);
    dv.setUint32(24, e.size, true);
    dv.setUint16(28, e.nameBytes.length, true);
    dv.setUint32(42, e.offset, true);
    rec.set(e.nameBytes, 46);
    dirChunks.push(rec);
    dirSize += rec.length;
  }

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...dirChunks, end], { type: "application/zip" });
}

// ---------- чтение ----------

// Предел размера архива. Дело не в правилах, а в том, как это устроено:
// чтобы прочитать оглавление, архив нужно целиком поднять в память —
// у браузера на телефоне её столько нет, и вкладка просто умирает
// без единого сообщения.
//
// Полтора гигабайта музыки — это нормальное желание, но его нужно
// разбить на несколько архивов.
const MAX_ZIP = 300 * 1024 * 1024;

export async function readZip(blob) {
  if (blob.size > MAX_ZIP) {
    const mb = Math.round(blob.size / 1024 / 1024);
    throw new Error(
      `архив на ${mb} МБ — слишком велик. Браузер читает его целиком в память, ` +
      `и на большом файле вкладка падает. Раздели примерно по 300 МБ.`
    );
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);

  // Оглавление лежит в конце — ищем его подпись с хвоста.
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 65558; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error("это не архив или он повреждён");

  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  const out = {};

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;   // оглавление обрывается
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    // содержимое лежит после локального заголовка
    const lnameLen = view.getUint16(localOffset + 26, true);
    const lextraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lnameLen + lextraLen;
    const raw = bytes.subarray(start, start + compSize);

    try {
      out[name] = method === 0 ? raw : await inflate(raw);
    } catch {
      // Один повреждённый файл не должен ронять весь архив: пропускаем его,
      // а вызывающая сторона покажет, чего не хватило.
      console.warn("Файл в архиве не читается:", name);
    }

    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(data) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("браузер не умеет распаковывать этот архив");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------- контрольная сумма ----------

let crcTable = null;

function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
