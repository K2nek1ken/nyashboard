import { currentUser, currentUserDoc, authReady } from "./auth.js";
import { remember, recall } from "./session-state.js";
import { avatarHtml } from "./avatar.js";
import { CHANNEL_COLOR } from "./palette.js";
import { escapeHtml, showToast } from "./ui.js";
import { ICON } from "./icons.js";

// ============================================================
//  От чьего имени публиковать
//
//  Раньше был чекбокс «анонимно» — двух состояний перестало хватать, когда
//  появились каналы. Теперь выбор из трёх:
//
//    аноним   — имя не показывается вовсе
//    я        — от своего аккаунта
//    канал    — от имени канала, которым ты управляешь
//
//  Каналов может быть много: до трёх показываем прямо в списке, дальше —
//  отдельным окном с прокруткой, иначе список разрастается.
//
//  Выбор запоминается на время сессии: обычно подряд публикуют в одно и то же
//  место, и переставлять каждый раз утомительно.
// ============================================================

// Сколько каналов показывать прямо в строке. На компьютере места больше,
// поэтому и предел выше: до пяти влезает без тесноты.
function inlineLimit() {
  return window.matchMedia("(min-width: 900px)").matches ? 5 : 3;
}

let channels = [];
let choice = { kind: "self", channelId: null };

export async function initPostIdentity(host, onChange) {
  if (!host) return;
  await authReady;

  if (!currentUser) {
    // Гость публикует только анонимно — выбирать не из чего.
    choice = { kind: "anon", channelId: null };
    host.innerHTML = "";
    return;
  }

  // Сначала рисуем то, что доступно всегда: анонимно и от себя. Каналы
  // подгружаются следом и добавляются к списку — иначе сбой при их загрузке
  // оставлял бы человека вовсе без выбора.
  render(host, onChange);

  try {
    const { fetchManagedChannels } = await import("./channels.js");
    const { created, admin } = await fetchManagedChannels();
    const seen = new Set();
    channels = [...created, ...admin].filter(c => {
      if (!c || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  } catch (e) {
    console.warn("Каналы для публикации не загрузились:", e.message);
    channels = [];
  }

  // восстанавливаем прошлый выбор, если он ещё имеет смысл
  const saved = recall("postIdentity", null);
  if (saved && (saved.kind !== "channel" || channels.some(c => c.id === saved.channelId))) {
    choice = saved;
  }

  render(host, onChange);
}

function render(host, onChange) {
  const options = [
    { kind: "anon", label: "Анонимно", icon: ICON.hidden || ICON.user },
    { kind: "self", label: currentUserDoc?.nickname || "От себя", icon: ICON.user }
  ];

  // Мало каналов — показываем прямо в списке. Много — одной строкой,
  // за которой откроется окно выбора.
  const limit = inlineLimit();
  if (channels.length && channels.length <= limit) {
    channels.forEach(c => options.push({ kind: "channel", channelId: c.id, label: c.name, channel: c }));
  } else if (channels.length) {
    options.push({ kind: "pick", label: currentChannelName() || "От имени канала", icon: ICON.hash });
  }

  host.innerHTML = `<div class="identity-row">
    ${options.map(o => `
      <button class="identity-option ${isActive(o) ? "active" : ""}"
              data-kind="${o.kind}" ${o.channelId ? `data-channel="${o.channelId}"` : ""}>
        ${o.channel
          ? avatarHtml({ avatarUrl: o.channel.avatarUrl, avatarShape: o.channel.avatarShape }, 18)
          : `<span class="nf">${o.icon}</span>`}
        <span style="${o.kind === "channel" || o.kind === "pick" ? `color:${CHANNEL_COLOR}` : ""}">${escapeHtml(o.label)}</span>
      </button>`).join("")}
  </div>`;

  host.querySelectorAll("[data-kind]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.kind === "pick") {
        const picked = await pickChannel();
        if (!picked) return;
        choice = { kind: "channel", channelId: picked };
      } else {
        choice = { kind: btn.dataset.kind, channelId: btn.dataset.channel || null };
      }
      remember("postIdentity", choice);
      render(host, onChange);
      onChange?.(choice);
    });
  });
}

function isActive(o) {
  if (o.kind === "channel") return choice.kind === "channel" && choice.channelId === o.channelId;
  if (o.kind === "pick") return choice.kind === "channel";
  return choice.kind === o.kind;
}

function currentChannelName() {
  if (choice.kind !== "channel") return null;
  return channels.find(c => c.id === choice.channelId)?.name || null;
}

// Окно выбора канала — когда их больше трёх и в строку они не влезают.
function pickChannel() {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `
      <div class="modal-content" style="max-width:340px;">
        <button class="closeBtn modalClose" data-close><span class="nf">${ICON.close}</span></button>
        <h2 style="margin-top:0;font-size:17px;">От имени какого канала?</h2>
        <div class="picker-list">
          ${channels.map(c => `
            <button class="picker-item" data-pick="${c.id}">
              ${avatarHtml({ avatarUrl: c.avatarUrl, avatarShape: c.avatarShape }, 26)}
              <span class="picker-name" style="color:${CHANNEL_COLOR}">${escapeHtml(c.name)}</span>
            </button>`).join("")}
        </div>
      </div>`;
    document.body.appendChild(box);

    const done = (value) => { box.remove(); resolve(value); };
    box.querySelector("[data-close]").addEventListener("click", () => done(null));
    box.addEventListener("click", (e) => { if (e.target === box) done(null); });
    box.querySelectorAll("[data-pick]").forEach(btn =>
      btn.addEventListener("click", () => done(btn.dataset.pick)));
  });
}

// Поля записи под выбранное имя — чтобы не собирать их в трёх местах.
export function identityFields() {
  if (choice.kind === "channel") {
    const c = channels.find(x => x.id === choice.channelId);
    if (!c) return identityFieldsSelf();
    return {
      channelId: c.id,
      channelName: c.name,
      channelAvatar: c.avatarUrl || null,
      channelShape: c.avatarShape || "circle",
      channelAccessory: c.accessory || "none",
      channelBorder: c.avatarBorder || "teal",
      isAnonymous: false,
      // Автор у записи канала не указывается: она публикуется от канала,
      // а не от человека. Право писать сервер проверяет по тому, кто
      // отправил запрос, — подставлять себя в запись не нужно и нельзя.
      authorUid: null,
      authorNickname: null, authorAvatar: null
    };
  }
  if (choice.kind === "anon") {
    return {
      channelId: null, isAnonymous: true,
      // Идентификатор автора в анонимной записи не хранится вовсе: запись
      // читают все, и он выдал бы человека с головой — анонимность была бы
      // только на вид. Право удалить и изменить свою запись остаётся: оно
      // держится на отдельной записи о владении, которую видит только сервер.
      authorUid: null,
      authorNickname: null, authorAvatar: null,
      authorShape: null, authorStatus: null,
      authorAccessory: null, authorBorder: null, authorNickColor: null
    };
  }
  return identityFieldsSelf();
}

function identityFieldsSelf() {
  return {
    channelId: null, isAnonymous: false,
    authorUid: currentUser?.uid || null,
    authorNickname: currentUserDoc?.nickname || "",
    authorAvatar: currentUserDoc?.avatarUrl || "",
    authorShape: currentUserDoc?.avatarShape || "circle",
    authorStatus: currentUserDoc?.statusEmoji || "",
    authorAccessory: currentUserDoc?.accessory || "none",
    authorBorder: currentUserDoc?.avatarBorder || "pink",
    authorNickColor: currentUserDoc?.nickColor || ""
  };
}

export function getPostIdentity() { return choice; }
