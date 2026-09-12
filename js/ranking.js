import { isSeen } from "./seen.js";
import { getSubscriptionsSync } from "./subscriptions.js";
import { getFriendsSync } from "./friends.js";
import { interestScore } from "./interests.js";
import { getSettings } from "./settings.js";
import { currentUser } from "./auth.js";
import { isOwned } from "./ownership.js";

// Умная лента. В ленту попадают ВСЕ записи — ничего не отфильтровывается,
// меняется только порядок. Логика прозрачная, без чёрного ящика:
//
//   +1000  запись подписки или друга, ещё не прочитанная
//          — именно это держит их наверху даже когда они старые
//   +300   любая другая непрочитанная
//   +200   запись подписки или друга, уже прочитанная
//          (иначе канал утонул бы навсегда после первого прочтения)
//   ±400   похожесть на то, что ты лайкала — см. interests.js
//   +250   свежесть, затухает за неделю
//   -700   уже прочитано: уезжает вниз, но не исчезает
//
// Порядок пересчитывается только при загрузке страницы: если бы он менялся
// во время чтения, лента прыгала бы под пальцами.
// Сколько времени своя запись держится наверху. Час — чтобы успеть увидеть
// результат и первые отклики, но не заслонять ленту на весь день.
const OWN_BOOST_WINDOW = 60 * 60 * 1000;

const WEIGHTS = {
  ownFresh: 2000,         // свои записи — наверх, но только пока свежие
  followedUnseen: 1000,
  unseen: 300,
  followedBonus: 200,
  interest: 400,
  freshnessMax: 250,
  seenPenalty: -700
};

export function scorePost(post, subs, friends) {
  const seen = isSeen(post.id);
  const isMine = currentUser && post.authorUid === currentUser.uid;
  // «Свой» источник — это и канал из подписок, и друг: логика одна и та же
  const followed =
    (post.channelId && subs.includes(post.channelId)) ||
    (post.authorUid && friends.includes(post.authorUid));

  let score = 0;

  // Свою свежую запись поднимаем наверх: человек только что опубликовал и
  // хочет увидеть результат. Но только на время — постоянный вес означал бы,
  // что собственные записи навсегда заслоняют всё новое, и о чужих записях
  // просто не узнать.
  const mine = isMine || isOwned("post", post.id);
  if (mine) {
    const age = Date.now() - (post.createdAt?.toMillis?.() || 0);
    if (age < OWN_BOOST_WINDOW) score += WEIGHTS.ownFresh;
  }

  if (!seen && followed) score += WEIGHTS.followedUnseen;
  else if (!seen) score += WEIGHTS.unseen;
  if (seen) score += WEIGHTS.seenPenalty;
  if (followed) score += WEIGHTS.followedBonus;

  // Похожесть на понравившееся. Свои записи сюда не попадают: лайк собственной
  // записи иначе поднимал бы её выше только что опубликованных, что бессмысленно.
  if (!isMine && getSettings().recommendations !== "off") {
    score += interestScore(post) * WEIGHTS.interest;
  }

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
  const friends = getFriendsSync();
  return [...posts]
    .map(p => ({ post: p, score: scorePost(p, subs, friends) }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.post);
}
