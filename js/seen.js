import { createSyncedStore } from "./synced-store.js";

// Отметки «прочитано». Привязаны к аккаунту, поэтому лента не «сбрасывается»
// при заходе с другого устройства. У гостей остаются только в браузере —
// им просто некуда синхронизировать.
//
// Запись отложенная (см. synced-store): сохранять каждый просмотр отдельным
// запросом было бы дорого, поэтому накопленное уходит пачкой.
const MAX = 800;   // потолок, чтобы документ не рос бесконечно

function empty() { return {}; }

// При входе объединяем: то, что прочитано гостем на этом устройстве,
// добавляется к прочитанному в аккаунте.
function mergeSeen(remote, local) {
  return { ...remote, ...local };
}

const store = createSyncedStore({
  localKey: "nyash_seen_posts",
  docName: "seen",
  empty,
  merge: mergeSeen
});

export const loadSeen = store.load;

export function isSeen(postId) {
  return Object.prototype.hasOwnProperty.call(store.get(), postId);
}

export function markSeen(postId) {
  if (isSeen(postId)) return;
  store.update(data => {
    data[postId] = Date.now();
    const keys = Object.keys(data);
    if (keys.length > MAX) {
      keys.sort((a, b) => data[a] - data[b])
          .slice(0, keys.length - MAX)
          .forEach(k => delete data[k]);
    }
  });
}

export function clearSeen() {
  store.reset();
}

// Помечаем запись прочитанной, когда она реально побыла на экране пару секунд,
// а не просто пролетела мимо при быстром скролле.
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
