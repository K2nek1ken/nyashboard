// Чтение обложки и названий прямо из аудиофайла (теги ID3v2 у MP3 и Vorbis
// у FLAC). Библиотеку тянуть ради этого не хочется, а нужны буквально три поля,
// поэтому разбираем вручную и только то, что нужно.
//
// Если тегов нет или формат непонятен — просто возвращаем пустой результат:
// человек введёт название сам, это не ошибка.

export async function readAudioMeta(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
    if (String.fromCharCode(head[0], head[1], head[2]) === "ID3") return readId3(head);
    if (String.fromCharCode(head[0], head[1], head[2], head[3]) === "fLaC") return readFlac(head);
  } catch (e) {
    console.warn("Теги не прочитались:", e.message);
  }
  return { title: "", artist: "", cover: null };
}

// ---------- ID3v2 (MP3) ----------
function readId3(bytes) {
  const out = { title: "", artist: "", cover: null };
  // размер тега записан «синхробезопасно»: по 7 бит в каждом байте
  const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
  let pos = 10;
  const end = Math.min(10 + size, bytes.length);

  while (pos + 10 < end) {
    const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    const frameSize = (bytes[pos + 4] << 24) | (bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7];
    pos += 10;
    if (frameSize <= 0 || pos + frameSize > end) break;

    const frame = bytes.subarray(pos, pos + frameSize);
    if (id === "TIT2") out.title = decodeText(frame);
    else if (id === "TPE1") out.artist = decodeText(frame);
    else if (id === "APIC") out.cover = decodePicture(frame);

    pos += frameSize;
  }
  return out;
}

function decodeText(frame) {
  const encoding = frame[0];
  const body = frame.subarray(1);
  // 1 и 2 — варианты UTF-16, 3 — UTF-8, 0 — латиница
  const label = encoding === 1 || encoding === 2 ? "utf-16" : encoding === 3 ? "utf-8" : "windows-1251";
  try {
    return new TextDecoder(label).decode(body).replace(/\0+$/, "").trim();
  } catch {
    return "";
  }
}

function decodePicture(frame) {
  let pos = 1;                                  // байт кодировки
  let mime = "";
  while (pos < frame.length && frame[pos] !== 0) mime += String.fromCharCode(frame[pos++]);
  pos++;                                        // ноль после типа
  pos++;                                        // байт «роль картинки»
  // описание, тоже заканчивается нулём
  while (pos < frame.length && frame[pos] !== 0) pos++;
  pos++;
  if (pos >= frame.length) return null;
  return new Blob([frame.subarray(pos)], { type: mime || "image/jpeg" });
}

// ---------- FLAC ----------
function readFlac(bytes) {
  const out = { title: "", artist: "", cover: null };
  let pos = 4;
  while (pos + 4 < bytes.length) {
    const last = (bytes[pos] & 0x80) !== 0;
    const type = bytes[pos] & 0x7f;
    const size = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    pos += 4;
    if (pos + size > bytes.length) break;

    if (type === 4) readVorbis(bytes.subarray(pos, pos + size), out);
    else if (type === 6) out.cover = readFlacPicture(bytes.subarray(pos, pos + size));

    pos += size;
    if (last) break;
  }
  return out;
}

function readVorbis(block, out) {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  let pos = 0;
  const vendorLen = view.getUint32(pos, true); pos += 4 + vendorLen;
  const count = view.getUint32(pos, true); pos += 4;

  for (let i = 0; i < count && pos + 4 <= block.length; i++) {
    const len = view.getUint32(pos, true); pos += 4;
    const text = new TextDecoder("utf-8").decode(block.subarray(pos, pos + len));
    pos += len;
    const [key, ...rest] = text.split("=");
    const value = rest.join("=");
    if (/^title$/i.test(key)) out.title = value;
    if (/^artist$/i.test(key)) out.artist = value;
  }
}

function readFlacPicture(block) {
  const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
  let pos = 4;                                   // тип картинки
  const mimeLen = view.getUint32(pos); pos += 4;
  const mime = new TextDecoder().decode(block.subarray(pos, pos + mimeLen)); pos += mimeLen;
  const descLen = view.getUint32(pos); pos += 4 + descLen;
  pos += 16;                                     // размеры, глубина цвета
  const dataLen = view.getUint32(pos); pos += 4;
  if (pos + dataLen > block.length) return null;
  return new Blob([block.subarray(pos, pos + dataLen)], { type: mime || "image/jpeg" });
}
