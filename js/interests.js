import { extractHashtags } from "./hashtags.js";
import { createSyncedStore } from "./synced-store.js";

// ============================================================
//  Профиль интересов
//
//  Привязан к аккаунту: лежит в приватном документе, куда никто, кроме самого
//  владельца, заглянуть не может. На сервере — чтобы рекомендации были
//  одинаковыми на телефоне и на компьютере: если держать их только в браузере,
//  аккаунт фактически ничего не значит. У гостей без аккаунта остаётся
//  локальная копия — синхронизировать им просто не к чему.
//
//  Запись отложенная и пачками, поэтому лайки не превращаются в поток запросов.
//
//  Устройство максимально простое, потому что «настоящие» рекомендации тут
//  не построить при всём желании: три словаря с весами — слова, хештеги,
//  авторы. Лайкнул запись — всё, что в ней есть, чуть прибавляет в весе.
//  Дизлайкнул или нажал «не рекомендовать» — убавляет.
//
//  Оценка новой записи — это пересечение её слов со словарём. По сути
//  «похоже на то, что тебе заходило» и ничего умнее.
// ============================================================

const LIMITS = { words: 300, tags: 120, authors: 120 };
const DECAY = 0.92;   // при переполнении веса подтухают, чтобы старое забывалось

const STOPWORDS = new Set([
  "и","в","на","с","по","для","не","что","как","это","к","о","из","за","то","а","но","же",
  "я","ты","он","она","мы","вы","они","был","была","было","быть","есть","бы","ли","да","нет",
  "the","a","an","is","are","was","to","of","in","on","for","and","or","it","this","that"
]);

function empty() { return { words: {}, tags: {}, authors: {} }; }

// Слияние при входе в аккаунт: веса складываются, поэтому то, что человек
// налайкал гостем на этом устройстве, не пропадает, а дополняет накопленное
// в аккаунте.
function mergeProfiles(remote, local) {
  const out = { words: { ...remote.words }, tags: { ...remote.tags }, authors: { ...remote.authors } };
  for (const section of ["words", "tags", "authors"]) {
    for (const [k, v] of Object.entries(local[section] || {})) {
      out[section][k] = (out[section][k] || 0) + v;
    }
  }
  return out;
}

const store = createSyncedStore({
  localKey: "nyash_interests",
  docName: "interests",
  empty,
  merge: mergeProfiles
});

export const loadInterests = store.load;

// Значимые слова записи: без стоп-слов, без коротких, без повторов.
// Ограничение сверху нужно, чтобы одна простыня текста не перевесила всё
// остальное в словаре.
export function extractWords(text, max = 25) {
  const seen = new Set();
  const words = (text || "").toLowerCase().match(/[a-zа-яё0-9]{3,}/g) || [];
  const out = [];
  for (const w of words) {
    if (STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

function bump(dict, key, delta, limit) {
  dict[key] = (dict[key] || 0) + delta;
  if (Math.abs(dict[key]) < 0.2) delete dict[key];

  const keys = Object.keys(dict);
  if (keys.length > limit) {
    // подтухание + отсев самых слабых: словарь не растёт бесконечно
    for (const k of keys) {
      dict[k] *= DECAY;
      if (Math.abs(dict[k]) < 0.3) delete dict[k];
    }
    const left = Object.keys(dict);
    if (left.length > limit) {
      left.sort((a, b) => Math.abs(dict[a]) - Math.abs(dict[b]))
          .slice(0, left.length - limit)
          .forEach(k => delete dict[k]);
    }
  }
}

function authorKey(post) {
  return post.channelId || post.authorUid || null;
}

// weight > 0 — понравилось, weight < 0 — наоборот.
export function learnFromPost(post, weight) {
  if (!post) return;
  const words = extractWords(post.text);
  const tags = post.hashtags?.length ? post.hashtags : extractHashtags(post.text);
  store.update(profile => {
    words.forEach(w => bump(profile.words, w, weight, LIMITS.words));
    tags.forEach(t => bump(profile.tags, t, weight * 2, LIMITS.tags));   // тег точнее слова
    const key = authorKey(post);
    if (key) bump(profile.authors, key, weight, LIMITS.authors);
  });
}

// «Не рекомендовать»: теги и слова просаживаем равномерно и мягко,
// автора — заметнее, как и просил Неко.
export function markNotInterested(post) {
  if (!post) return;
  const words = extractWords(post.text, 15);
  const tags = post.hashtags?.length ? post.hashtags : extractHashtags(post.text);
  store.update(profile => {
    words.forEach(w => bump(profile.words, w, -1, LIMITS.words));
    tags.forEach(t => bump(profile.tags, t, -2, LIMITS.tags));
    const key = authorKey(post);
    if (key) bump(profile.authors, key, -5, LIMITS.authors);
  });
}

// Насколько запись похожа на то, что тебе заходило.
// Возвращает примерно от -1 до 1, дальше ranking.js домножает на свой вес.
export function interestScore(post) {
  if (!post) return 0;
  const profile = store.get();
  let score = 0;

  const tags = post.hashtags?.length ? post.hashtags : [];
  for (const t of tags) score += (profile.tags[t] || 0) * 1.5;

  const words = extractWords(post.text, 20);
  for (const w of words) score += (profile.words[w] || 0);

  const key = authorKey(post);
  if (key) score += (profile.authors[key] || 0) * 2;

  // Сжимаем в разумный диапазон: без этого одна залайканная тема
  // могла бы задавить вообще всё остальное в ленте.
  return Math.tanh(score / 12);
}

export function clearInterests() {
  store.reset();
}

// для страницы настроек — показать, что вообще накопилось
export function interestsSummary() {
  const profile = store.get();
  const top = (dict, n) => Object.entries(dict)
    .sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  return {
    words: Object.keys(profile.words).length,
    tags: Object.keys(profile.tags).length,
    authors: Object.keys(profile.authors).length,
    topTags: top(profile.tags, 6),
    topWords: top(profile.words, 8)
  };
}
