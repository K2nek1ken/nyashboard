// Служебный сценарий сайта.
//
// Нужен ради уведомлений: на телефонах браузер не даёт показывать их напрямую
// со страницы и требует именно этот путь — там уведомление показывает сам
// браузер, а не вкладка. Без него на Android уведомления просто не появлялись.
//
// Ничего не кэшируем: сайт и так лёгкий, а устаревший кэш приносит больше
// хлопот, чем пользы.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Нажатие по уведомлению возвращает к уже открытой вкладке, а не плодит новые.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "./";

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      if ("focus" in client) {
        await client.focus();
        if (client.navigate && target !== "./") await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
