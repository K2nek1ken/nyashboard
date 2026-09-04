// Отметки «видел». Хранятся локально: на сервере это была бы запись на каждый
// показ каждого поста каждым человеком — самый дорогой способ спалить бесплатный
// лимит Firestore. Локально же это бесплатно и мгновенно, а минус только один:
// на другом устройстве лента снова покажется свежей.
const KEY = "nyash_seen_posts";
const MAX = 800; // чтобы localStorage не рос бесконечно

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}
let cache = load();

export function isSeen(postId) {
  return Object.prototype.hasOwnProperty.call(cache, postId);
}

export function markSeen(postId) {
  if (isSeen(postId)) return;
  cache[postId] = Date.now();
  const keys = Object.keys(cache);
  if (keys.length > MAX) {
    // выкидываем самые старые отметки
    keys.sort((a, b) => cache[a] - cache[b]).slice(0, keys.length - MAX).forEach(k => delete cache[k]);
  }
  localStorage.setItem(KEY, JSON.stringify(cache));
}

export function clearSeen() {
  cache = {};
  localStorage.removeItem(KEY);
}

// Помечаем пост просмотренным, когда он реально побыл на экране пару секунд,
// а не просто пролетел мимо при быстром скролле.
let observer = null;
const timers = new WeakMap();

export function observeSeen(cardEl) {
  if (!("IntersectionObserver" in window)) return;
  if (!observer) {
    observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const el = entry.target;
        if (entry.isIntersecting) {
          if (!timers.has(el)) {
            timers.set(el, setTimeout(() => {
              markSeen(el.dataset.id);
              el.classList.add("was-seen");
              observer.unobserve(el);
              timers.delete(el);
            }, 1800));
          }
        } else {
          clearTimeout(timers.get(el));
          timers.delete(el);
        }
      });
    }, { threshold: 0.55 });
  }
  observer.observe(cardEl);
}
