// ============================================================
//  Служебный работник: то, что делает сайт приложением
//
//  Держит у себя оболочку — разметку, стили, скрипты, шрифт — и отдаёт
//  её мгновенно, не дожидаясь сети. Записи, сообщения и музыка идут
//  как обычно, из базы.
//
//  ---- как он обновляется ----
//
//  При каждой выкладке меняется VERSION (это делает deploy.sh). Работник
//  видит новую версию, скачивает оболочку заново и заменяет старую.
//  Человеку ничего делать не нужно — разве что закрыть и открыть
//  приложение.
//
//  ---- почему так, а не иначе ----
//
//  Оболочку берём из сети, а память держим на случай, когда связи нет.
//  Для сайта, который меняется каждый день, это важнее мгновенного
//  запуска: иначе исправления просто не доезжают.
// ============================================================

// Меняется при каждой выкладке (это делает deploy.sh). Новая версия —
// значит вся прежняя память очищается, и человек получает свежее.
const VERSION = "nyash-202609250041";

// Что держим у себя. Список небольшой: только то, без чего сайт
// не откроется вообще.
const SHELL = [
  "./",
  "./index.html",
  "./chat.html",
  "./content.html",
  "./people.html",
  "./friends.html",
  "./about.html",
  "./style.css",
  "./manifest.json",
  "./assets/fonts/MonaspaceNeonNF-Regular.otf"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // Не падаем, если какой-то файл не скачался: приложение должно
      // установиться даже при дрянной связи, остальное доберёт потом.
      .then(cache => Promise.allSettled(SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names.filter(n => n !== VERSION).map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Чужое не трогаем вовсе: база, хранилище картинок и музыки должны
  // ходить напрямую, иначе сломается и загрузка, и живые обновления.
  if (request.method !== "GET") return;
  if (!request.url.startsWith(self.location.origin)) return;

  const isShell = /\.(html|css|js|otf|ttf|woff2?|png|svg|ico)$/i.test(
    new URL(request.url).pathname
  ) || request.mode === "navigate";

  if (!isShell) return;

  // Сначала сеть, сохранённое — только если её нет.
  //
  // Сперва было наоборот: отдавали из памяти, а обновляли в фоне. Для
  // готового приложения это верно — открывается мгновенно. Но сайт
  // меняется каждый день, и выходило, что правки не доезжают: работник
  // упорно отдавал вчерашние скрипты, и починенное «иногда проскальзывало»
  // лишь когда сеть случайно опережала.
  //
  // Теперь наоборот: свежее всегда, а память — запасной выход на случай
  // пропавшей связи. Разница в скорости небольшая, зато нет самой
  // неприятной вещи — когда исправил, а ничего не изменилось.
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(VERSION).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then(cached => cached || offlineAnswer(request)))
  );
});

// Что показать, если ни памяти, ни связи.
function offlineAnswer(request) {
  if (request.mode === "navigate") {
    return caches.match("./index.html").then(page => page || plainOffline());
  }
  return plainOffline();
}

function plainOffline() {
  return new Response(
    "<h1>Нет связи</h1><p>Открой приложение, когда появится интернет.</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}
