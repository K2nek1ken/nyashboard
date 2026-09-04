import { getSettings, setSetting, THEMES, ACCENTS, PARTICLES, EMOJI_SOURCES, TIME_FORMATS, TAB_LABELS, DEFAULTS } from "./settings.js";
import { showToast } from "./ui.js";

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
          ${Object.entries(ACCENTS).map(([k, v]) =>
            `<button class="accentOption accent-${k} ${s.accent === k ? "selected" : ""}" data-accent="${k}" title="${v}"></button>`).join("")}
        </div>`)}
      ${row("Падающие частицы", "лёгкая анимация на фоне", select("particles", PARTICLES, s.particles))}
      ${row("Эмодзи", "Noto тянется с Google Fonts и почти ничего не весит; Apple красивее, но это локальный файл на 8 МБ",
        select("emoji", EMOJI_SOURCES, s.emoji))}

      ${row("Формат времени", "как показывать время у постов и сообщений",
        select("timeFormat", TIME_FORMATS, s.timeFormat))}

      <div class="section-title">Вкладки</div>
      ${row("Вкладка «Друзья»", "личные чаты и список друзей", toggle("showFriends", s.showFriends === "on"))}
      <div class="muted" style="font-size:12px; margin-bottom:8px;">
        Порядок вкладок: на телефоне слева направо, на компьютере сверху вниз
      </div>
      <div id="tabOrderList" class="tab-order"></div>

      <div class="section-title">Лента</div>
      ${row("Умная лента", "подписки и непросмотренное поднимаются вверх; выключено — просто по времени",
        toggle("feedMode", s.feedMode === "smart"))}
      <button id="clearSeenBtn" class="secondaryBtn">Сбросить «просмотренное»</button>
      <p class="muted" style="font-size:12px;">Все посты снова станут новыми для умной ленты.</p>
    `;

    host.querySelectorAll("[data-select]").forEach(sel => {
      sel.addEventListener("change", () => {
        setSetting(sel.dataset.select, sel.value);
        if (sel.dataset.select === "particles") showToast("Обновится после перезагрузки страницы");
      });
    });

    host.querySelectorAll("[data-accent]").forEach(btn => {
      btn.addEventListener("click", () => { setSetting("accent", btn.dataset.accent); render(); });
    });

    host.querySelectorAll("[data-toggle]").forEach(btn => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.toggle;
        const isOn = btn.classList.contains("on");
        const values = { feedMode: ["smart", "new"], showFriends: ["on", "off"] };
        const [onVal, offVal] = values[key] || ["on", "off"];
        setSetting(key, isOn ? offVal : onVal);
        render();
      });
    });

    renderTabOrder();

    host.querySelector("#clearSeenBtn").addEventListener("click", () => {
      localStorage.removeItem("nyash_seen_posts");
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
