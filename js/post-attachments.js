import { escapeHtml } from "./ui.js";

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
  const ids = [...new Set(((p.text || "").match(/#U5\d{6}/gi) || []))]
    .map(t => t.slice(1).toUpperCase()).slice(0, 3);
  if (!ids.length) { card.querySelector(".post-artworks")?.remove(); return; }
  // при повторной отрисовке прежние карточки убираем, иначе они удвоятся
  card.querySelector(".post-artworks")?.remove();

  try {
    const { resolveNuid } = await import("./nuid.js");
    const { getArtwork } = await import("./art.js");
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
      <div class="art-attached">
        <img src="${a.imageUrl}" alt="${escapeHtml(a.title)}" loading="lazy">
        <div class="art-attached-body">
          <div class="art-attached-title">${escapeHtml(a.title)}</div>
          ${a.description ? `<div class="art-desc">${escapeHtml(a.description)}</div>` : ""}
          <span class="track-nuid" data-copy-nuid="${a.publicUid || ""}">${a.publicUid || ""}</span>
        </div>
      </div>`).join("");

    // Ставим после кнопки «показать полностью», если она есть: иначе работа
    // вклинивалась между текстом и кнопкой, и кнопка оказывалась под ней.
    const anchor = card.querySelector(".expandBtn") || card.querySelector(".post-text") || card;
    anchor.insertAdjacentElement("afterend", host);
    host.querySelectorAll("img").forEach((img, i) => {
      img.addEventListener("click", () => openLightbox(img.src, works.map(w => w.imageUrl), i));
    });
  } catch (e) {
    console.warn("Работы не подгрузились:", e.message);
  }
}
export async function renderPostTracks(p, card) {
  const host = card.querySelector(`[data-post-tracks="${p.id}"]`);
  if (!host) return;
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

    host.innerHTML = tracks.map(t => trackCardHtml(t, { favorite: favIds.has(t.id) })).join("");
    wireTrackCards(host, tracks, () => renderPostTracks(p, card));
  } catch (e) {
    console.warn("Треки записи не загрузились:", e.message);
  }
}
