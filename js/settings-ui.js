import { getSettings, setSetting, THEMES, PARTICLES, EMOJI_SOURCES, TIME_FORMATS, TAB_LABELS, GENDERS, TIMEZONES, QUOTE_DECOR, DEFAULTS,
  exportSettings, importSettings } from "./settings.js";
import { showToast } from "./ui.js";
import { refreshDefaultAvatars } from "./default-avatar.js";
import { applyFavicon } from "./favicon.js";
import { clearInterests, interestsSummary } from "./interests.js";
import { clearSeen } from "./seen.js";
import { paletteEntries } from "./palette.js";
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
  return `<select class="settingSelect" data-select="${key}">
    ${Object.entries(options).map(([k, v]) =>
      `<option value="${k}" ${current === k ? "selected" : ""}>${v}</option>`).join("")}
  </select>`;
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
      <div class="section-title" style="margin-top:0;">Оформление</div>
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
      ${row("Эмодзи", "Noto тянется с Google Fonts и почти ничего не весит; Apple красивее, но это локальный файл на 8 МБ",
        select("emoji", EMOJI_SOURCES, s.emoji))}

      ${row("Формат времени", "как показывать время у постов и сообщений",
        select("timeFormat", TIME_FORMATS, s.timeFormat))}
      ${row("Часовой пояс", "для точного времени; «как на устройстве» берёт системный",
        select("timezone", TIMEZONES, s.timezone))}
      ${row("Обращение", "род окончаний в подписях интерфейса; в аккаунте настраивается в профиле",
        select("gender", GENDERS, s.gender))}
      ${row("Что говорит логотип", "показывается при нажатии на название сайта",
        `<input class="settingSelect" id="logoMessageInput" maxlength="40" value="${(s.logoMessage || "").replace(/"/g, "&quot;")}" style="width:150px;">`)}
      ${row("Звук логотипа", "mp3 или wav до мегабайта, хранится только на этом устройстве",
        `<div style="display:flex; gap:6px; align-items:center;">
           <label class="secondaryBtn" for="logoSoundInput" style="width:auto; margin:0; padding:7px 12px; cursor:pointer;">Выбрать</label>
           <input type="file" id="logoSoundInput" accept="audio/mpeg,audio/wav,audio/*" hidden>
           <button class="linkBtn" id="logoSoundClear" style="width:auto;">убрать</button>
         </div>`)}
      <p class="muted" style="font-size:12px; margin-top:0;" id="logoSoundInfo"></p>

      <div class="section-title">Вкладки</div>
      ${row("Вкладка «Друзья»", "личные чаты и список друзей", toggle("showFriends", s.showFriends === "on"))}
      ${row("Вкладка «Возможности»", "описание функций сайта", toggle("showAbout", s.showAbout === "on"))}
      <div class="muted" style="font-size:12px; margin-bottom:8px;">
        Порядок вкладок: на телефоне слева направо, на компьютере сверху вниз
      </div>
      <div id="tabOrderList" class="tab-order"></div>

      <div class="section-title">Лента</div>
      ${row("Умная лента", "подписки и непросмотренное поднимаются вверх; выключено — просто по времени",
        toggle("feedMode", s.feedMode === "smart"))}
      ${row("Рекомендации", "поднимать записи, похожие на то, что ты лайкала",
        toggle("recommendations", s.recommendations === "on"))}
      <div class="section-title">Перенос настроек</div>
      <p class="muted" style="font-size:12px; margin-top:0;">
        Сохрани оформление в файл, чтобы вернуть его после чистки браузера или
        перенести на другое устройство. Данные аккаунта в файл не попадают —
        они и так хранятся в аккаунте.
      </p>
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button id="exportSettingsBtn" class="secondaryBtn" style="width:auto; margin:0;">Сохранить в файл</button>
        <label class="secondaryBtn" for="importSettingsInput" style="width:auto; margin:0; cursor:pointer;">Восстановить из файла</label>
        <input type="file" id="importSettingsInput" accept="application/json,.json" hidden>
      </div>

      <div class="section-title">Мои данные</div>
      <p class="muted" style="font-size:12px; margin-top:0;">
        Интересы — это словарь слов, хештегов и авторов, который наполняется твоими
        лайками и дизлайками. По нему лента поднимает похожие записи наверх.
        Данные привязаны к аккаунту, поэтому одинаковы на всех твоих устройствах.
      </p>
      <p class="muted" style="font-size:12px;" id="interestsInfo"></p>
      <button id="clearInterestsBtn" class="dangerBtn">Очистить интересы</button>
      <button id="clearSeenBtn" class="secondaryBtn">Сбросить «просмотренное»</button>
      <p class="muted" style="font-size:11px; text-align:center; margin-top:22px;">
        Сборка от ${BUILD.date} — ${BUILD.name}
      </p>
      ${currentUser ? `
        <div class="section-title">Аккаунт</div>
        <p class="muted" style="font-size:12px; margin-top:0;">
          Удаление стирает профиль, юзернейм, идентификатор, подписки, друзей и личные данные.
          Записи и сообщения останутся, но перестанут быть связаны с аккаунтом.
        </p>
        <button id="deleteAccountBtn" class="dangerBtn">Удалить аккаунт</button>` : ""}
      <p class="muted" style="font-size:12px;">
        После сброса «просмотренного» все записи снова считаются непрочитанными
        и поднимаются в ленте.
      </p>
    `;

    host.querySelectorAll("[data-select]").forEach(sel => {
      sel.addEventListener("change", () => {
        setSetting(sel.dataset.select, sel.value);
        if (sel.dataset.select === "particles") {
          const prev = host.querySelector("#particlePreview");
          if (prev) prev.innerHTML = particleGlyph(sel.value);
        }
        if (sel.dataset.select === "quoteDecor") {
          const prev = host.querySelector("#decorPreview");
          if (prev) prev.innerHTML = decorGlyphPreview(sel.value);
        }
        // Перекрашиваем ТОЛЬКО сгенерированные аватарки. Раньше сюда попадали и
        // загруженные пользователем: у них подменялся src, и вместо своей
        // картинки появлялся стандартный аноним.
        refreshDefaultAvatars();
        applyFavicon();
        if (sel.dataset.select === "particles") showToast("Обновится после перезагрузки страницы");
      });
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
                         showAbout: ["on", "off"], recommendations: ["on", "off"] };
        const [onVal, offVal] = values[key] || ["on", "off"];
        setSetting(key, isOn ? offVal : onVal);
        render();
      });
    });

    renderTabOrder();

    // звук логотипа
    const soundInput = host.querySelector("#logoSoundInput");
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

    const importInput = host.querySelector("#importSettingsInput");
    importInput?.addEventListener("change", async () => {
      const file = importInput.files[0];
      importInput.value = "";
      if (!file) return;
      try {
        const count = await importSettings(file);
        showToast(`Восстановлено настроек: ${count}`);
        render();
        refreshDefaultAvatars();
        applyFavicon();
      } catch (e) {
        showToast("Не вышло: " + e.message);
      }
    });

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
