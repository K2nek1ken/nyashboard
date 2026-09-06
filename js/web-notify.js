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
  setSetting("webNotify", "on");
  return true;
}

// Показывает уведомление, если это разрешено и включено в настройках.
// Пока человек смотрит на вкладку — молчим: он и так всё видит.
export function notify(title, body, { tag = "nyash", onClick = null } = {}) {
  if (!notificationsAllowed()) return;
  if (getSettings().webNotify !== "on") return;
  if (!document.hidden) return;

  try {
    const n = new Notification(title, {
      body,
      tag,                 // одинаковый тег заменяет прошлое, а не копит стопку
      icon: "assets/favicon.svg",
      silent: false
    });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch (e) {
    console.warn("Уведомление не показалось:", e.message);
  }
}
