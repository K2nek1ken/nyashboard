import { getSettings, setSetting, THEMES, PARTICLES, EMOJI_SOURCES, TIME_FORMATS, TAB_LABELS, GENDERS, TIMEZONES, QUOTE_DECOR, CHAT_IDENTITY, DM_NAMING, DEFAULTS,
  exportSettings, importSettings } from "./settings.js";
import { showToast } from "./ui.js";
import { refreshDefaultAvatars } from "./default-avatar.js";
import { applyFavicon } from "./favicon.js";
import { clearInterests, interestsSummary } from "./interests.js";
import { clearSeen } from "./seen.js";
import { paletteEntries } from "./palette.js";
import { customSelect, wireSelects } from "./select.js";
import { notificationsSupported, notificationsAllowed, requestNotifications } from "./web-notify.js";
import { BUILD } from "./version.js";
import { saveLogoSound, clearLogoSound, getLogoSound, playLogoSound } from "./logo-sound.js";
import { currentUser } from "./auth.js";
import { deleteMyAccount } from "./account.js";
import { askText, askConfirm } from "./dialog.js";

// Превью показывает ровно то, что будет на фоне, а не похожий символ.
// Звезда и лепесток рисуются формой (первая — на холсте, второй — из файла),
// поэтому и в превью идут формами. Клён и цветок сакуры — цветные эмодзи,
// нарисовать их одноцветной формой нельзя, так что остаются эмодзи.
const STAR_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" class="svg-ic" style="width:19px;height:19px;">
  <path d="M12 2.4l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.4l1.2-6.5L2.5 9.3l6.6-.9z"/></svg>`;

function particleGlyph(kind) {
  if (kind === "stars")  return STAR_SVG;
  if (kind === "petals") return `<span class="petal-preview"></span>`;
  return { flowers: "\u2740", leaves: "\uD83C\uDF41", sakura: "\uD83C\uDF38", off: "\u2014" }[kind] || STAR_SVG;
}

function decorGlyphPreview(kind) {
  if (kind === "stars")  return STAR_SVG;
  if (kind === "petals") return `<span class="petal-preview"></span>`;
  return { flowers: "\u2740", leaves: "\uD83C\uDF41", none: "\u2014" }[kind] || "\u2740";
}

// Настроек стало много, и сплошным списком в них уже не найти нужное.
// Группы свёрнуты по умолчанию, кроме первой: так видно всё разом, а раскрыть
// можно только то, что понадобилось.
function group(id, title, hint, contentHtml, open = false) {
  return `
    <details class="settings-group" ${open ? "open" : ""} data-group="${id}">
      <summary>
        <span class="settings-group-title">${title}</span>
        ${hint ? `<span class="muted settings-group-hint">${hint}</span>` : ""}
      </summary>
      <div class="settings-group-body">${contentHtml}</div>
    </details>`;
}

function row(label, hint, controlHtml) {
  return `
    <div class="setting-row">
      <div class="setting-label">
        <div>${label}</div>
        ${hint ? `<div class="muted" style="font-size:12px;">${hint}</div>` : ""}
      </div>
      ${controlHtml}
    </div>`;
}

function select(key, options, current) {
  return customSelect(key, options, current);
}

function toggle(key, on) {
  return `<button class="toggleSwitch ${on ? "on" : ""}" data-toggle="${key}" role="switch" aria-checked="${on}"><span></span></button>`;
}

export function initSettingsPage() {
  const host = document.getElementById("settingsHost");
  if (!host) return;

  function render() {
    const s = getSettings();
    host.innerHTML = `
      ${group("look", "Оформление", "темы, цвета, частицы", `
        ${row("Тема", "основная палитра фона", select("theme", THEMES, s.theme))}
        ${row("Акцентный цвет", "кнопки, ссылки, частицы",
          `<div class="accent-picker">
            ${paletteEntries().map(p =>
              `<button class="accentOption ${s.accent === p.key ? "selected" : ""}" data-accent="${p.key}"
                       title="${p.label}" style="background:linear-gradient(135deg, ${p.color}, ${p.soft});"></button>`).join("")}
          </div>`)}
        ${row("Падающие частицы", "лёгкая анимация на фоне",
          `<div style="display:flex; align-items:center;">
             ${select("particles", PARTICLES, s.particles)}
             <span class="particle-preview" id="particlePreview">${particleGlyph(s.particles)}</span>
           </div>`)}
        ${row("Узор на цитатах", "фон у ответа на сообщение в чате",
          `<div style="display:flex; align-items:center;">
             ${select("quoteDecor", QUOTE_DECOR, s.quoteDecor)}
             <span class="particle-preview" id="decorPreview">${decorGlyphPreview(s.quoteDecor)}</span>
           </div>`)}
        ${row("Эмодзи", "Noto тянется с CDN и почти ничего не весит; Apple красивее, но это файл на 8 МБ",
          select("emoji", EMOJI_SOURCES, s.emoji))}
      `, true)}

      ${group("text", "Текст и время", "как показываются подписи", `
        ${row("Формат времени", "как показывать время у записей и сообщений",
          select("timeFormat", TIME_FORMATS, s.timeFormat))}
        ${row("Часовой пояс", "для точного времени; «как на устройстве» берёт системный",
          select("timezone", TIMEZONES, s.timezone))}
        ${row("Обращение", "род окончаний в подписях; в аккаунте настраивается в профиле",
          select("gender", GENDERS, s.gender))}
      `)}

      ${group("tabs", "Вкладки", "какие показывать и в каком порядке", `
        ${row("Вкладка «Друзья»", "личные чаты и список друзей", toggle("showFriends", s.showFriends === "on"))}
        ${row("Вкладка «Возможности»", "описание функций сайта", toggle("showAbout", s.showAbout === "on"))}
        <div class="muted" style="font-size:12px; margin-bottom:8px;">
          Порядок: на телефоне слева направо, на компьютере сверху вниз
        </div>
        <div id="tabOrderList" class="tab-order"></div>
      `)}

      ${group("chat", "Чат", "личность и звуки", `
        ${row("Как писать в чат", "анонимный ник, аккаунт или и то, и другое",
          select("chatIdentity", CHAT_IDENTITY, s.chatIdentity))}
        ${row("Отзываться на «мяукнуть»", "звук и подсказка, когда кто-то мяукает",
          toggle("meowReaction", s.meowReaction === "on"))}
        ${row("Как подписывать собеседника", "в личных переписках",
          select("dmNaming", DM_NAMING, s.dmNaming))}
        ${s.dmNaming === "custom" ? row("Своё слово", "чем заменить имя собеседника",
          `<input class="settingSelect" id="dmCustomInput" maxlength="30"
                  value="${(s.dmCustomName || "").replace(/"/g, "&quot;")}" style="width:150px;">`) : ""}
        ${row("Уведомления браузера", "о новых сообщениях, пока сайт открыт в другой вкладке",
          `<button class="secondaryBtn" id="notifyBtn" style="width:auto; margin:0;"></button>`)}
      `)}

      ${group("feed", "Лента", "порядок записей и рекомендации", `
        ${row("Умная лента", "подписки и непрочитанное выше; выключено — просто по времени",
          toggle("feedMode", s.feedMode === "smart"))}
        ${row("Рекомендации", "поднимать записи, похожие на понравившееся",
          toggle("recommendations", s.recommendations === "on"))}
      `)}

      ${group("fun", "Мелочи", "логотип и звук", `
        ${row("Что говорит логотип", "показывается при нажатии на название сайта",
          `<input class="settingSelect" id="logoMessageInput" maxlength="40" value="${(s.logoMessage || "").replace(/"/g, "&quot;")}" style="width:150px;">`)}
        ${row("Звук логотипа", "mp3 или wav до мегабайта, хранится только на этом устройстве",
          `<div style="display:flex; gap:6px; align-items:center;">
             <button id="logoSoundPick" class="secondaryBtn" style="width:auto; margin:0; padding:7px 12px;">Выбрать</button>
             <input type="file" id="logoSoundInput" accept="audio/*" style="display:none;">
             <button class="linkBtn" id="logoSoundClear" style="width:auto;">убрать</button>
           </div>`)}
        <p class="muted" style="font-size:12px; margin-top:0;" id="logoSoundInfo"></p>
      `)}

      ${group("data", "Мои данные", "интересы и аккаунт", `
        <p class="muted" style="font-size:12px;" id="interestsInfo"></p>
        <button id="clearInterestsBtn" class="dangerBtn">Очистить интересы</button>
        <button id="clearSeenBtn" class="secondaryBtn">Сбросить «просмотренное»</button>
        ${currentUser ? `
          <p class="muted" style="font-size:12px;">
            Удаление аккаунта стирает профиль, юзернейм, идентификатор, подписки и друзей.
            Записи останутся, но перестанут быть связаны с аккаунтом.
          </p>
          <button id="deleteAccountBtn" class="dangerBtn">Удалить аккаунт</button>` : ""}
      `)}

      <!-- Перенос настроек стоит после всех групп, а не внутри одной из них:
           это действие над всем сразу, и прятать его в свёрнутый раздел
           означало бы, что о нём просто не узнают. -->
      <div class="settings-transfer">
        <div class="settings-transfer-title">Перенос настроек</div>
        <p class="muted" style="font-size:12px; margin-top:0;">
          Сохрани оформление в файл, чтобы вернуть его после чистки браузера или
          перенести на другое устройство. Данные аккаунта в файл не попадают.
        </p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button id="exportSettingsBtn" class="secondaryBtn" style="width:auto; margin:0;">Сохранить в файл</button>
          <button id="importSettingsBtn" class="secondaryBtn" style="width:auto; margin:0;">Восстановить из файла</button>
          <input type="file" id="importSettingsInput" style="display:none;">
        </div>
      </div>

      <p class="muted" style="font-size:11px; text-align:center; margin-top:22px;">
        Сборка от ${BUILD.date} — ${BUILD.name}
      </p>
    `;

    wireSelects(host, (key, value) => {
      setSetting(key, value);

      if (key === "particles") {
        const prev = host.querySelector("#particlePreview");
        if (prev) prev.innerHTML = particleGlyph(value);
        showToast("Обновится после перезагрузки страницы");
      }
      if (key === "quoteDecor") {
        const prev = host.querySelector("#decorPreview");
        if (prev) prev.innerHTML = decorGlyphPreview(value);
      }
      // при смене способа обращения появляется или исчезает поле своего слова
      if (key === "dmNaming") render();

      // Перекрашиваем ТОЛЬКО сгенерированные аватарки: у загруженных
      // пометки нет, иначе своя картинка подменялась бы анонимной.
      refreshDefaultAvatars();
      applyFavicon();
    });

    host.querySelectorAll("[data-accent]").forEach(btn => {
      btn.addEventListener("click", () => {
        setSetting("accent", btn.dataset.accent);
        refreshDefaultAvatars();
        applyFavicon();
        render();
      });
    });

    host.querySelectorAll("[data-toggle]").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.toggle;
        const isOn = btn.classList.contains("on");
        const values = { feedMode: ["smart", "new"], showFriends: ["on", "off"],
                         showAbout: ["on", "off"], recommendations: ["on", "off"],
                         meowReaction: ["on", "off"] };
        const [onVal, offVal] = values[key] || ["on", "off"];
        setSetting(key, isOn ? offVal : onVal);
        render();
      });
    });

    renderTabOrder();

    // звук логотипа
    const soundInput = host.querySelector("#logoSoundInput");
    host.querySelector("#logoSoundPick")?.addEventListener("click", () => soundInput.click());
    const soundInfo = host.querySelector("#logoSoundInfo");
    getLogoSound().then(rec => {
      soundInfo.textContent = rec ? `Выбран файл: ${rec.name}` : "Звук не выбран — логотип просто пишет сообщение.";
    });
    soundInput?.addEventListener("change", async () => {
      const file = soundInput.files[0];
      soundInput.value = "";
      if (!file) return;
      try {
        await saveLogoSound(file);
        soundInfo.textContent = `Выбран файл: ${file.name}`;
        playLogoSound();
        showToast("Звук сохранён ♡");
      } catch (e) { showToast(e.message); }
    });
    host.querySelector("#logoSoundClear")?.addEventListener("click", async () => {
      await clearLogoSound();
      soundInfo.textContent = "Звук не выбран — логотип просто пишет сообщение.";
      showToast("Звук убран");
    });

    // уведомления: сначала спрашиваем разрешение, потом включаем
    const notifyBtn = host.querySelector("#notifyBtn");
    if (notifyBtn) {
      const paintNotify = () => {
        if (!notificationsSupported()) { notifyBtn.textContent = "не поддерживается"; notifyBtn.disabled = true; return; }
        const on = notificationsAllowed() && getSettings().webNotify === "on";
        notifyBtn.textContent = on ? "Включены" : "Включить";
      };
      paintNotify();
      notifyBtn.addEventListener("click", async () => {
        if (notificationsAllowed() && getSettings().webNotify === "on") {
          setSetting("webNotify", "off");
          paintNotify();
          return;
        }
        try {
          await requestNotifications();
          showToast("Уведомления включены ♡");
        } catch (e) {
          showToast("Не вышло: " + e.message);
        }
        paintNotify();
      });
    }

    const dmCustom = host.querySelector("#dmCustomInput");
    dmCustom?.addEventListener("change", () => {
      setSetting("dmCustomName", dmCustom.value.trim());
      showToast("Сохранено ♡");
    });

    const logoInput = host.querySelector("#logoMessageInput");
    if (logoInput) {
      logoInput.addEventListener("change", () => {
        setSetting("logoMessage", logoInput.value.trim() || "мяу!");
        showToast(logoInput.value.trim() || "мяу!");
      });
    }

    host.querySelector("#exportSettingsBtn")?.addEventListener("click", () => {
      exportSettings();
      showToast("Файл настроек сохранён ♡");
    });

    // Фильтр по типу файла намеренно снят: на разных системах json
    // определяется по-разному, и файл просто не давало выбрать. Проверяем
    // содержимое сами — это надёжнее и не зависит от того, что решила система.
    // Восстановление настроек вынесено из перерисовки: обработчик вешается
    // на сам контейнер один раз и переживает любые обновления разметки.
    // Раньше он навешивался на поле внутри render, и после первой же
    // перерисовки терялся вместе со старой разметкой.
    if (!host.dataset.importWired) {
      host.dataset.importWired = "1";

      host.addEventListener("click", (e) => {
        if (!e.target.closest("#importSettingsBtn")) return;
        host.querySelector("#importSettingsInput")?.click();
      });

      host.addEventListener("change", async (e) => {
        const input = e.target.closest("#importSettingsInput");
        if (!input) return;

        const file = input.files[0];
        input.value = "";
        if (!file) { showToast("Файл не выбран"); return; }

        try {
          const count = await importSettings(file);
          showToast(`Восстановлено настроек: ${count}`);
          render();
          refreshDefaultAvatars();
          applyFavicon();
        } catch (err) {
          console.error("Настройки не восстановились:", err);
          showToast(`Не вышло: ${err.message} (файл «${file.name}»)`);
        }
      });
    }

    const sum = interestsSummary();
    const info = host.querySelector("#interestsInfo");
    info.textContent = sum.words || sum.tags
      ? `Накоплено: ${sum.words} слов, ${sum.tags} тегов, ${sum.authors} авторов.` +
        (sum.topTags.length ? ` Чаще всего: ${sum.topTags.join(", ")}.` : "") +
        " Всё хранится только на этом устройстве."
      : "Профиль интересов пока пуст — он наполняется лайками. Хранится только на этом устройстве.";

    host.querySelector("#clearInterestsBtn").addEventListener("click", async () => {
      // подтверждение: кнопка стоит рядом с остальными, промахнуться легко,
      // а восстановить накопленное потом уже нельзя
      const ok = await askConfirm("Очистить интересы?", {
        hint: "Будет удалён словарь слов, хештегов и авторов, собранный из твоих лайков. " +
              "Лента перестанет поднимать похожие записи, пока ты не налайкаешь заново. " +
              "Отменить нельзя.",
        okLabel: "Очистить", danger: true
      });
      if (!ok) return;
      clearInterests();
      showToast("Интересы очищены ♡");
      render();
    });

    host.querySelector("#deleteAccountBtn")?.addEventListener("click", async () => {
      const ok = await askConfirm("Удалить аккаунт?", {
        hint: "Будут стёрты профиль, юзернейм, идентификатор, подписки, друзья, интересы " +
              "и отметки прочитанного. Опубликованные записи останутся, но потеряют связь " +
              "с аккаунтом. Отменить нельзя.",
        okLabel: "Продолжить", danger: true
      });
      if (!ok) return;
      const word = await askText("Подтверждение", {
        placeholder: "удалить", hint: "Впиши слово «удалить», чтобы подтвердить.", okLabel: "Удалить аккаунт"
      });
      if (word !== "удалить") { showToast("Отменено"); return; }
      try {
        await deleteMyAccount();
        showToast("Аккаунт удалён");
        setTimeout(() => { location.href = "index.html"; }, 900);
      } catch (e) {
        showToast("Не вышло: " + e.message);
      }
    });

    host.querySelector("#clearSeenBtn").addEventListener("click", async () => {
      if (!await askConfirm("Сбросить «просмотрено»?", {
        hint: "Все записи снова станут непрочитанными и поднимутся в ленте.",
        okLabel: "Сбросить"
      })) return;
      clearSeen();
      showToast("Сброшено ♡");
    });
  }

  function renderTabOrder() {
    const listEl = host.querySelector("#tabOrderList");
    if (!listEl) return;
    const s = getSettings();
    // порядок из настроек + вкладки, добавленные позже (чтобы новые не терялись)
    const order = [
      ...s.tabOrder.filter(k => TAB_LABELS[k]),
      ...Object.keys(TAB_LABELS).filter(k => !s.tabOrder.includes(k))
    ];

    listEl.innerHTML = order.map((key, i) => `
      <div class="tab-order-row">
        <span class="tab-order-name">${TAB_LABELS[key]}</span>
        ${key === "friends" && s.showFriends !== "on" ? '<span class="muted" style="font-size:11px;">скрыта</span>' : ""}
        <button class="tabMoveBtn" data-move="${key}" data-dir="-1" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="tabMoveBtn" data-move="${key}" data-dir="1" ${i === order.length - 1 ? "disabled" : ""}>↓</button>
      </div>`).join("");

    listEl.querySelectorAll("[data-move]").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.move;
        const dir = Number(btn.dataset.dir);
        const next = [...order];
        const idx = next.indexOf(key);
        const target = idx + dir;
        if (target < 0 || target >= next.length) return;
        [next[idx], next[target]] = [next[target], next[idx]];
        setSetting("tabOrder", next);
        renderTabOrder();
        showToast("Порядок обновится после перехода на другую страницу");
      });
    });
  }

  render();
}
