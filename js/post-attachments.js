import { escapeHtml } from "./ui.js";
import { currentUser } from "./auth.js";

// Что уже загружали — держим в памяти. Разметка пересоздаётся при каждой
// перерисовке списка, и отметка «загружено» на ней теряется: без этого
// прикреплённое запрашивалось заново на каждое новое сообщение и успевало
// мигнуть, пока грузится.
const attachmentCache = new Map();

async function remember(key, load) {
  if (attachmentCache.has(key)) return attachmentCache.get(key);
  const value = await load();
  attachmentCache.set(key, value);
  return value;
}

// ============================================================
//  Прикреплённое к записи
//
//  Треки и работы, упомянутые номером: «#U3669463» превращается
//  в проигрыватель, «#U5395660» — в картинку работы.
//
//  Дополнение к карточке, а не её часть: подгружается после отрисовки
//  и не задерживает показ записи. Не загрузилось — запись всё равно
//  на месте, просто без приложения.
// ============================================================

// Треки, упомянутые в тексте записи, показываем карточками под ней: ссылка
// вида #U3XXXXXX превращается в проигрыватель, а не остаётся набором символов.
// Работы из «Творчества» по их номеру — как треки, только картинкой.
export async function renderPostArtworks(p, card) {
  // Уже нарисовано для этого же текста — ничего не делаем. Карточка теперь
  // обновляется частями и привязывается повторно, и без этого работы
  // перерисовывались на каждое обновление.
  const key = p.text || "";
  if (card.dataset.artFor === key) return;
  card.dataset.artFor = key;

  // Номер этой отрисовки. Если, пока мы грузили работы, началась новая,
  // наша устарела — выходим, ничего не вставляя. Раньше два вызова
  // подряд оба доходили до вставки, и работа появлялась дважды.
  const token = (card._artToken = (card._artToken || 0) + 1);

  const ids = [...new Set(((p.text || "").match(/#U5\d{6}/gi) || []))]
    .map(t => t.slice(1).toUpperCase()).slice(0, 3);
  if (!ids.length) { card.querySelector(".post-artworks")?.remove(); return; }

  try {
    const { resolveNuid } = await import("./nuid.js");
    const { getArtwork, artMediaHtml, artImages, wireArtVideos } = await import("./art.js");
    const { openLightbox } = await import("./lightbox.js");

    const works = [];
    for (const nuid of ids) {
      const hit = await resolveNuid(nuid);
      if (hit?.type !== "art") continue;
      const art = await getArtwork(hit.uid);
      if (art) works.push(art);
    }
    if (!works.length) return;

    const host = document.createElement("div");
    host.className = "post-artworks";
    host.innerHTML = works.map(a => `
      <div class="art-attached" data-art-id="${a.id}">
        ${artMediaHtml(a)}
        <div class="art-attached-body">
          <div class="art-attached-title">${escapeHtml(a.title)}</div>
          ${a.description ? `<div class="art-desc">${escapeHtml(a.description)}</div>` : ""}
          <span class="track-nuid" data-copy-nuid="${a.publicUid || ""}">${a.publicUid || ""}</span>
        </div>

        <!-- Открыть саму работу: из вложения не видно ни автора, ни оценок,
             и поставить сердечко было негде. -->
        <button class="art-open" data-open-art="${a.id}" title="открыть работу">
          <span class="nf">&#xf08e;</span>
        </button>
      </div>`).join("");

    // Ставим после кнопки «показать полностью», если она есть: иначе работа
    // вклинивалась между текстом и кнопкой, и кнопка оказывалась под ней.
    const anchor = card.querySelector(".expandBtn") || card.querySelector(".post-text") || card;
    // Проверяем, не устарели ли, и убираем прежний блок прямо перед
    // вставкой — не раньше: так нет ни пустого мига, ни дубля.
    if (card._artToken !== token) return;
    card.querySelectorAll(".post-artworks").forEach(el => el.remove());
    anchor.insertAdjacentElement("afterend", host);
    host.querySelectorAll("img").forEach((img, i) => {
      img.addEventListener("click", () => openLightbox(img.src, artImages(works), i));
    });

    // Видеоработы — своим проигрывателем, как видео в записях.
    wireArtVideos(host);

    // Кнопка «открыть работу» — окно с автором, описанием и оценками.
    host.querySelectorAll("[data-open-art]").forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const { openArtPreview } = await import("./art-ui.js");
        openArtPreview(btn.dataset.openArt);
      });
    });
  } catch (e) {
    console.warn("Работы не подгрузились:", e.message);
  }
}
export async function renderPostTracks(p, card) {
  const host = card.querySelector(`[data-post-tracks="${p.id}"]`);
  if (!host) return;

  // Те же две защиты, что у работ: не перерисовывать без нужды —
  // иначе обрывался бы играющий проигрыватель, — и не вставлять устаревшее.
  const key = p.text || "";
  if (host.dataset.tracksFor === key) return;
  host.dataset.tracksFor = key;
  const token = (host._token = (host._token || 0) + 1);
  const ids = [...new Set((p.text || "").match(/#U3\d{6}/gi) || [])]
    .map(t => t.slice(1).toUpperCase());

  // Если после правки трека в тексте не осталось — убираем и карточку.
  if (!ids.length) { host.innerHTML = ""; return; }

  try {
    const { resolveNuid } = await import("./nuid.js");
    const { getTrack } = await import("./music.js");
    const { trackCardHtml, wireTrackCards } = await import("./music-ui.js");

    const tracks = [];
    for (const nuid of ids.slice(0, 3)) {     // не больше трёх на запись
      const hit = await resolveNuid(nuid);
      if (hit?.type !== "track") continue;
      const track = await getTrack(hit.uid);
      if (track) tracks.push(track);
    }
    if (!tracks.length) return;

    // Отметка «в любимом» должна быть видна и здесь, а не только в разделе
    // музыки: иначе непонятно, добавлен трек или нет.
    const { loadFavorites } = await import("./music.js");
    const favIds = currentUser
      ? new Set((await loadFavorites().catch(() => [])).map(t => t.id))
      : new Set();

    if (host._token !== token) return;   // пока грузили, началась новая отрисовка
    host.innerHTML = tracks.map(t => trackCardHtml(t, { favorite: favIds.has(t.id) })).join("");
    wireTrackCards(host, tracks, () => renderPostTracks(p, card));
  } catch (e) {
    console.warn("Треки записи не загрузились:", e.message);
  }
}
