import { currentUser, authReady } from "./auth.js";
import { askText, askConfirm } from "./dialog.js";
import {
  getChannel, isChannelCreator, updateChannel, changeChannelUsername,
  isSubscribedLocal, subscribeToChannel, unsubscribeFromChannel,
  isIdentifiedSubscriber, hideFromChannel, revealToChannel,
  listChannelSubscribers, addPersonToChannel, assignChannelAdmin, removeChannelAdmin,
  createChannelPost
} from "./channels.js";
import { loadSubscriptions } from "./subscriptions.js";
import { loadChannelWall, renderPostsInto } from "./feed.js";
import { uploadImage, uploadImages } from "./storage.js";
import { showToast, escapeHtml, gendered } from "./ui.js";
import { ICON } from "./icons.js";
import { defaultAvatar } from "./default-avatar.js";

function getChannelId() {
  return new URLSearchParams(location.search).get("id");
}

let channel = null;
let isCreator = false;
let isAdmin = false;
let composerImages = []; // File[]

export async function initChannelPage() {
  const channelId = getChannelId();
  const wallEl = document.getElementById("chWall");
  if (!channelId) { wallEl.innerHTML = `<div class="stub-note">Не указан канал (нет ?id= в ссылке)</div>`; return; }

  await authReady; // иначе роль (создатель/админ) определится неправильно на первой загрузке
  await loadSubscriptions();
  channel = await getChannel(channelId);
  if (!channel) { wallEl.innerHTML = `<div class="stub-note">Канал не найден</div>`; return; }

  document.title = `NyashBoard ♡ — ${channel.name}`;
  document.getElementById("chAvatar").src = channel.avatarUrl || defaultAvatar();
  document.getElementById("chName").textContent = channel.name;
  document.getElementById("chUsername").textContent = channel.username;
  document.getElementById("chNuid").textContent = channel.publicUid || "";
  document.getElementById("chDescription").textContent = channel.description || "";

  isAdmin = currentUser && (channel.adminUids || []).includes(currentUser.uid);
  isCreator = await isChannelCreator(channelId);

  if (isCreator || isAdmin) {
    document.getElementById("chManagePanel").classList.remove("hidden");
    if (isCreator) document.getElementById("chSettingsBtn").classList.remove("hidden");
    wireManagePanel(channelId);
  } else {
    document.getElementById("chSubscribeRow").classList.remove("hidden");
    await renderSubscribeRow(channelId);
  }

  await reloadWall(channelId);
}

async function reloadWall(channelId) {
  const wallEl = document.getElementById("chWall");
  try {
    const posts = await loadChannelWall(channelId);
    renderPostsInto(wallEl, posts, channel.name);
  } catch (e) {
    console.error(e);
    wallEl.innerHTML = `<div class="stub-note">Ошибка загрузки стены: ${escapeHtml(e.message)}</div>`;
  }
}

// ================== Подписка / скрытие (для НЕ-админов) ==================
async function renderSubscribeRow(channelId) {
  const subBtn = document.getElementById("chSubBtn");
  const hideBtn = document.getElementById("chHideBtn");

  const subscribedLocal = isSubscribedLocal(channelId);
  subBtn.textContent = subscribedLocal ? "Отписаться" : "Подписаться";
  subBtn.onclick = async () => {
    subBtn.disabled = true;
    try {
      if (isSubscribedLocal(channelId)) { await unsubscribeFromChannel(channelId); showToast(`Отписал${gendered("ся", "ась", "ся(ась)")}`); }
      else { await subscribeToChannel(channelId); showToast(`Подписал${gendered("ся", "ась", "ся(ась)")} ♡`); }
      await renderSubscribeRow(channelId);
    } catch (e) { console.error(e); showToast("Ошибка: " + e.message); }
    finally { subBtn.disabled = false; }
  };

  if (currentUser && subscribedLocal) {
    hideBtn.classList.remove("hidden");
    const identified = await isIdentifiedSubscriber(channelId);
    hideBtn.textContent = identified ? "Скрыться" : "Проявиться";
    hideBtn.onclick = async () => {
      hideBtn.disabled = true;
      try {
        if (await isIdentifiedSubscriber(channelId)) { await hideFromChannel(channelId); showToast("Теперь ты аноним для этого канала"); }
        else { await revealToChannel(channelId); showToast(`Снова вид${gendered("ен", "на", "ен(на)")} как подписчик`); }
        await renderSubscribeRow(channelId);
      } catch (e) { console.error(e); showToast("Ошибка: " + e.message); }
      finally { hideBtn.disabled = false; }
    };
  } else {
    hideBtn.classList.add("hidden");
  }
}

// ================== Панель управления (создатель/админ) ==================
function wireManagePanel(channelId) {
  const composeBtn = document.getElementById("chComposeBtn");
  const composer = document.getElementById("chComposer");
  composeBtn.addEventListener("click", () => composer.classList.toggle("hidden"));

  wireComposer(channelId);
  wirePeopleModal(channelId);
  if (isCreator) wireSettingsModal(channelId);
}

function renderComposerStrip() {
  const strip = document.getElementById("chPostImageStrip");
  strip.innerHTML = composerImages.map((file, i) => `
    <div class="thumb" data-idx="${i}">
      <img src="${URL.createObjectURL(file)}">
      <button class="removeThumb" data-remove-idx="${i}"><span class="nf">${ICON.close}</span></button>
    </div>`).join("");
  strip.querySelectorAll("[data-remove-idx]").forEach(btn => {
    btn.addEventListener("click", () => {
      composerImages.splice(Number(btn.dataset.removeIdx), 1);
      renderComposerStrip();
    });
  });
}

function wireComposer(channelId) {
  const textArea = document.getElementById("chPostText");
  const imageInput = document.getElementById("chPostImageInput");
  const publishBtn = document.getElementById("chPublishBtn");

  imageInput.addEventListener("change", () => {
    const files = Array.from(imageInput.files || []);
    const room = 10 - composerImages.length;
    if (files.length > room) showToast(`Максимум 10 фото — добавила только ${room}`);
    files.slice(0, room).forEach(f => composerImages.push(f));
    imageInput.value = "";
    renderComposerStrip();
  });

  publishBtn.addEventListener("click", async () => {
    const text = textArea.value.trim();
    if (!text && !composerImages.length) { showToast("Пустой пост не отправить"); return; }
    publishBtn.disabled = true;
    try {
      const imageUrls = composerImages.length ? await uploadImages(composerImages) : [];
      if (imageUrls.some(u => !u)) {
        throw new Error("Одна из картинок не загрузилась — попробуй ещё раз");
      }
      await createChannelPost(channelId, text, imageUrls);
      textArea.value = "";
      composerImages = [];
      renderComposerStrip();
      document.getElementById("chComposer").classList.add("hidden");
      showToast("Опубликовано от имени канала ♡");
      await reloadWall(channelId);
    } catch (e) {
      console.error(e);
      showToast("Ошибка: " + e.message);
    } finally {
      publishBtn.disabled = false;
    }
  });
}

// ================== "Люди" ==================
function wirePeopleModal(channelId) {
  const modal = document.getElementById("peopleModal");
  const peopleBtn = document.getElementById("chPeopleBtn");
  const closeBtn = document.getElementById("closePeopleModal");
  const listEl = document.getElementById("subscribersList");

  peopleBtn.addEventListener("click", async () => {
    modal.classList.remove("hidden");
    listEl.innerHTML = `<div class="stub-note">Загружаю...</div>`;
    try {
      const subs = await listChannelSubscribers(channelId);
      listEl.innerHTML = subs.length
        ? subs.map(u => `
          <div class="person-row" style="cursor:default;">
            <img src="${u.avatarUrl || defaultAvatar()}">
            <div><div>${escapeHtml(u.nickname)}</div><div class="pmuted">@${escapeHtml(u.username)}</div></div>
          </div>`).join("")
        : `<div class="stub-note">Пока никто явно не подписан (или все скрылись)</div>`;
    } catch (e) {
      console.error(e);
      listEl.innerHTML = `<div class="stub-note">Ошибка: ${escapeHtml(e.message)}</div>`;
    }
  });
  closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

  document.getElementById("addPeopleBtn").addEventListener("click", async () => {
    const handle = await askText("Добавить человека", { placeholder: "@юзернейм или U1xxxxxx", hint: "Человек появится в списке подписчиков канала." });
    if (!handle) return;
    try {
      const user = await addPersonToChannel(channelId, handle);
      showToast(`Добавлен(а): ${user.nickname}`);
      peopleBtn.click();
    } catch (e) {
      console.error(e);
      showToast("Ошибка: " + e.message);
    }
  });

  document.getElementById("assignAdminBtn").addEventListener("click", async () => {
    const handle = await askText("Назначить управляющего", { placeholder: "@юзернейм или U1xxxxxx", hint: "Сможет публиковать от имени канала, но не менять его настройки." });
    if (!handle) return;
    try {
      const user = await assignChannelAdmin(channelId, handle);
      showToast(`Теперь админ: ${user.nickname}`);
    } catch (e) {
      console.error(e);
      showToast("Ошибка: " + e.message);
    }
  });
}

// ================== Настройки канала (создатель) ==================
function wireSettingsModal(channelId) {
  const modal = document.getElementById("channelSettingsModal");
  const openBtn = document.getElementById("chSettingsBtn");
  const closeBtn = document.getElementById("closeSettingsModal");
  const avatarImg = document.getElementById("csAvatar");
  const avatarInput = document.getElementById("csAvatarInput");
  const nameInput = document.getElementById("csName");
  const usernameInput = document.getElementById("csUsername");
  const descInput = document.getElementById("csDescription");
  const saveBtn = document.getElementById("csSaveBtn");
  const adminsList = document.getElementById("csAdminsList");
  let pendingAvatarFile = null;

  async function renderAdmins() {
    const fresh = await getChannel(channelId);
    channel = fresh;
    if (!fresh.adminUids.length) { adminsList.innerHTML = `<div class="stub-note">Админов пока нет</div>`; return; }
    adminsList.innerHTML = fresh.adminUids.map(uid => `
      <div class="person-row" style="cursor:default;">
        <div style="flex:1;"><code style="font-size:11px;">${uid.slice(0, 10)}...</code></div>
        <button class="dangerBtn" style="width:auto; margin:0;" data-remove-admin="${uid}">убрать</button>
      </div>`).join("");
    adminsList.querySelectorAll("[data-remove-admin]").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await removeChannelAdmin(channelId, btn.dataset.removeAdmin);
          showToast("Админ снят");
          renderAdmins();
        } catch (e) { console.error(e); showToast("Ошибка: " + e.message); }
      });
    });
  }

  openBtn.addEventListener("click", async () => {
    avatarImg.src = channel.avatarUrl || defaultAvatar();
    nameInput.value = channel.name;
    usernameInput.value = (channel.username || "").replace(/^ch_/, "");
    descInput.value = channel.description || "";
    pendingAvatarFile = null;
    modal.classList.remove("hidden");
    renderAdmins();
  });
  closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files[0];
    if (!file) return;
    pendingAvatarFile = file;
    avatarImg.src = URL.createObjectURL(file);
  });

  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const usernameSuffix = usernameInput.value.trim().replace(/^ch_/, "");
    if (!name) { showToast("Название не может быть пустым"); return; }
    if (!/^[a-zA-Z0-9_]{2,17}$/.test(usernameSuffix)) { showToast("Юзернейм: 2-17 символов после ch_"); return; }
    saveBtn.disabled = true;
    try {
      const patch = { name, description: descInput.value.trim() };
      if (pendingAvatarFile) {
        showToast("Загружаю аватарку...");
        patch.avatarUrl = await uploadImage(pendingAvatarFile);
        pendingAvatarFile = null;
      }
      await updateChannel(channelId, patch);
      const newUsername = "ch_" + usernameSuffix;
      if (newUsername !== channel.username) {
        await changeChannelUsername(channelId, channel.username, usernameSuffix);
      }
      channel = await getChannel(channelId);
      document.getElementById("chAvatar").src = channel.avatarUrl || defaultAvatar();
      document.getElementById("chName").textContent = channel.name;
      document.getElementById("chUsername").textContent = channel.username;
      document.getElementById("chDescription").textContent = channel.description || "";
      showToast("Сохранено ♡");
      modal.classList.add("hidden");
    } catch (e) {
      console.error(e);
      showToast("Ошибка: " + e.message);
    } finally {
      saveBtn.disabled = false;
    }
  });
}
