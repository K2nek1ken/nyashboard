import { getSettings, setSetting } from "./settings.js";

// ============================================================
//  Уведомления браузера
//
//  Честная граница: показывать их можно только пока вкладка сайта открыта
//  (пусть и в фоне). Уведомления при полностью закрытом сайте требуют сервера,
//  который их рассылает — а это платный тариф, от которого мы отказались.
//
//  Поэтому здесь ровно то, что работает бесплатно: пока сайт открыт в соседней
//  вкладке, о новом сообщении или ответе придёт обычное системное уведомление.
// ============================================================

let swReady = null;

// На телефонах браузер запрещает показывать уведомления прямо со страницы и
// требует служебный сценарий — там уведомление показывает сам браузер.
// На компьютере работает и тот, и другой путь, поэтому используем один
// общий: он надёжнее.
export function registerNotifier() {
  if (swReady) return swReady;
  if (!("serviceWorker" in navigator)) return (swReady = Promise.resolve(null));
  swReady = navigator.serviceWorker.register("sw.js")
    .then(() => navigator.serviceWorker.ready)
    .catch(e => {
      console.warn("Служебный сценарий не зарегистрировался:", e.message);
      return null;
    });
  return swReady;
}

export function notificationsSupported() {
  return typeof Notification !== "undefined";
}

export function notificationsAllowed() {
  return notificationsSupported() && Notification.permission === "granted";
}

export async function requestNotifications() {
  if (!notificationsSupported()) throw new Error("браузер их не поддерживает");
  if (Notification.permission === "denied") {
    throw new Error("разрешение отключено в настройках браузера");
  }
  const result = await Notification.requestPermission();
  if (result !== "granted") throw new Error("разрешение не выдано");

  // Регистрируем сразу: если сценарий не поднимется, лучше узнать об этом
  // здесь, а не в момент, когда уведомление должно было прийти.
  const reg = await registerNotifier();
  if (!reg && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    throw new Error("на этом устройстве уведомления недоступны");
  }

  setSetting("webNotify", "on");
  return true;
}

// Показывает уведомление, если это разрешено и включено в настройках.
// Пока человек смотрит на вкладку — молчим: он и так всё видит.
export function notify(title, body, { tag = "nyash", onClick = null } = {}) {
  if (!notificationsAllowed()) return;
  if (getSettings().webNotify !== "on") return;
  if (!document.hidden) return;

  const options = {
    body,
    tag,                 // одинаковый тег заменяет прошлое, а не копит стопку
    icon: "assets/favicon.svg",
    badge: "assets/favicon.svg",
    data: { url: location.href }
  };

  registerNotifier().then(reg => {
    if (reg?.showNotification) {
      // основной путь: работает и на телефоне, и на компьютере
      reg.showNotification(title, options).catch(e =>
        console.warn("Уведомление не показалось:", e.message));
      return;
    }
    // запасной путь для браузеров без служебного сценария
    try {
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); onClick?.(); n.close(); };
    } catch (e) {
      console.warn("Уведомление не показалось:", e.message);
    }
  });
}
