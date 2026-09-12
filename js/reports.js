import { db, collection, addDoc, serverTimestamp } from "./firebase.js";
import { currentUser } from "./auth.js";
import { showToast, escapeHtml } from "./ui.js";
import { ICON } from "./icons.js";

// ============================================================
//  Жалобы
//
//  Единственный работающий способ модерации на площадке без серверной части:
//  проверить содержимое до публикации нечем, значит нужно узнавать о нарушениях
//  как можно быстрее.
//
//  Жалоба пишется в отдельную коллекцию, которую читает только владелец сайта.
//  Отправить может кто угодно, включая тех, кто не вошёл: требовать аккаунт
//  ради сообщения о запрещённом — плохая идея.
// ============================================================

const REASONS = {
  csam:      "Материалы с несовершеннолетними",
  violence:  "Насилие или призывы к нему",
  personal:  "Чужие личные данные",
  spam:      "Спам или мошенничество",
  copyright: "Чужая работа без разрешения",
  other:     "Другое"
};

export function openReportDialog({ kind, id, preview = "" }) {
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `
    <div class="modal-content" style="max-width:380px;">
      <button class="closeBtn modalClose" data-close><span class="nf">${ICON.close}</span></button>
      <h2 style="margin-top:0;font-size:17px;">Пожаловаться</h2>
      ${preview ? `<p class="muted" style="font-size:12px;margin-top:0;">${escapeHtml(preview.slice(0, 90))}</p>` : ""}

      <div class="report-reasons">
        ${Object.entries(REASONS).map(([key, label]) => `
          <button class="report-reason ${key === "csam" ? "urgent" : ""}" data-reason="${key}">
            ${label}
          </button>`).join("")}
      </div>

      <p class="muted" style="font-size:11px;margin-bottom:0;">
        О противоправных материалах можно сообщить напрямую в Роскомнадзор
        через форму на eais.rkn.gov.ru — это действеннее.
      </p>
    </div>`;
  document.body.appendChild(box);

  const close = () => box.remove();
  box.querySelector("[data-close]").addEventListener("click", close);
  box.addEventListener("click", (e) => { if (e.target === box) close(); });

  box.querySelectorAll("[data-reason]").forEach(btn => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await addDoc(collection(db, "reports"), {
          kind,                                  // post | message | artwork | track
          targetId: id,
          reason: btn.dataset.reason,
          // Кто пожаловался — только если вошёл. Анонимные жалобы тоже
          // принимаем: важнее узнать о нарушении, чем знать, кто сообщил.
          reporterUid: currentUser?.uid || null,
          preview: preview.slice(0, 200),
          createdAt: serverTimestamp()
        });
        close();
        showToast("Спасибо, я разберусь ♡");
      } catch (e) {
        console.error(e);
        showToast("Не отправилось: " + e.message);
        btn.disabled = false;
      }
    });
  });
}
