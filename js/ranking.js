import { isSeen } from "./seen.js";
import { getSubscriptionsSync } from "./subscriptions.js";
import { getSettings } from "./settings.js";

// Умная лента. Идея простая и предсказуемая (никакого чёрного ящика):
// каждому посту начисляем очки, сортируем по убыванию.
//
//   +1000  пост от канала, на который ты подписан(а), и ты его ещё не видел(а)
//          — именно это даёт «старые посты подписок всё равно наверху»
//   +300   любой другой непросмотренный пост
//   +N     свежесть: чем новее, тем больше (затухает за неделю)
//   -700   уже просмотренные — уезжают вниз, но не исчезают совсем
//
// Порядок пересчитывается только при загрузке страницы: если бы он менялся
// прямо во время чтения, лента прыгала бы под пальцами.
const WEIGHTS = {
  subscribedUnseen: 1000,
  unseen: 300,
  seenPenalty: -700,
  freshnessMax: 250
};

export function scorePost(post, subs) {
  const seen = isSeen(post.id);
  const fromSubscription = post.channelId && subs.includes(post.channelId);

  let score = 0;
  if (!seen && fromSubscription) score += WEIGHTS.subscribedUnseen;
  else if (!seen) score += WEIGHTS.unseen;
  if (seen) score += WEIGHTS.seenPenalty;
  // подписки получают бонус и после прочтения, иначе канал утонет навсегда
  if (fromSubscription) score += 200;

  const ms = post.createdAt?.toMillis?.() || 0;
  if (ms) {
    const ageDays = (Date.now() - ms) / 86400000;
    score += Math.max(0, WEIGHTS.freshnessMax * (1 - ageDays / 7));
  }
  return score;
}

export function rankPosts(posts) {
  if (getSettings().feedMode !== "smart") {
    return [...posts].sort((a, b) =>
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  }
  const subs = getSubscriptionsSync();
  return [...posts]
    .map(p => ({ post: p, score: scorePost(p, subs) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.post);
}
