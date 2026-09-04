import { currentUser, currentUserDoc, onAuthChange, patchCurrentUserDoc, logout, loginWithGoogle } from "./auth.js";
import { updateUserDoc, isUsernameTaken, changeUsername } from "./data.js";
import { uploadImage, exportLocalBackup } from "./storage.js";
import { showToast } from "./ui.js";
import { shapeClass, shapePickerHtml, openCropper, applyAvatar } from "./avatar.js";
import { openEmojiPicker } from "./emoji.js";
import { requestNuid } from "./nuid.js";

export function initProfilePageForm() {
  const loggedOutNote = document.getElementById("profileLoggedOutNote");
  const form = document.getElementById("profileForm");
  const pageAvatar = document.getElementById("pageAvatar");
  const pageStatus = document.getElementById("pageStatus");
  const avatarInput = document.getElementById("avatarInput");
  const nicknameInput = document.getElementById("nicknameInput");
  const usernameInput = document.getElementById("usernameInput");
  const bioInput = document.getElementById("bioInput");
  const uidDisplay = document.getElementById("uidDisplay");
  const saveBtn = document.getElementById("saveProfileBtn");
  const exportBtn = document.getElementById("exportLocalBtn");
  const logoutBtn = document.getElementById("logoutBtnPage");
  const shapeHost = document.getElementById("shapePickerHost");
  const statusBtn = document.getElementById("statusEmojiBtn");
  const statusPreview = document.getElementById("statusEmojiPreview");
  const nuidVisibility = document.getElementById("nuidVisibility");
  const repostVisibility = document.getElementById("repostVisibility");

  let pendingAvatarFile = null;
  let pendingShape = "circle";
  let pendingStatus = "";

  function applyShapePreview() {
    pageAvatar.className = `avatar-shaped ${shapeClass(pendingShape)}`;
  }

  function renderShapePicker() {
    shapeHost.innerHTML = shapePickerHtml(pendingShape);
    shapeHost.querySelectorAll("[data-shape]").forEach(btn => {
      btn.addEventListener("click", () => {
        pendingShape = btn.dataset.shape;
        applyShapePreview();
        renderShapePicker();
      });
    });
  }

  function render() {
    if (currentUser && currentUserDoc) {
      loggedOutNote.classList.add("hidden");
      form.classList.remove("hidden");
      applyAvatar(pageAvatar, currentUserDoc, "neko");
      pageAvatar.style.width = pageAvatar.style.height = "88px";
      nicknameInput.value = currentUserDoc.nickname || "";
      usernameInput.value = currentUserDoc.username || "";
      bioInput.value = currentUserDoc.bio || "";
      // свой идентификатор всегда доступен — правило разрешает читать самому себе
      uidDisplay.textContent = "загружаю…";
      requestNuid(currentUser.uid).then(n => { uidDisplay.textContent = n || "—"; });
      nuidVisibility.value = currentUserDoc.nuidVisibility || "friends";
      repostVisibility.value = currentUserDoc.repostVisibility || "everyone";
      pendingShape = currentUserDoc.avatarShape || "circle";
      pendingStatus = currentUserDoc.statusEmoji || "";
      pageStatus.textContent = pendingStatus;
      statusPreview.textContent = pendingStatus || "выбрать";
      applyShapePreview();
      renderShapePicker();
    } else {
      loggedOutNote.classList.remove("hidden");
      form.classList.add("hidden");
    }
  }
  render();
  onAuthChange(render);

  document.getElementById("pageLoginBtn")?.addEventListener("click", loginWithGoogle);

  // клик прямо по аватарке открывает выбор файла, дальше — кадрирование
  pageAvatar.addEventListener("click", () => avatarInput.click());
  avatarInput.addEventListener("change", () => {
    const file = avatarInput.files[0];
    avatarInput.value = "";
    if (!file) return;
    openCropper(file, (cropped) => {
      pendingAvatarFile = cropped;
      pageAvatar.src = URL.createObjectURL(cropped);
    });
  });

  statusBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEmojiPicker(statusBtn.parentElement, (emoji) => {
      pendingStatus = emoji;
      pageStatus.textContent = emoji;
      statusPreview.textContent = emoji;
    });
  });

  document.getElementById("clearStatusBtn").addEventListener("click", () => {
    pendingStatus = "";
    pageStatus.textContent = "";
    statusPreview.textContent = "выбрать";
  });

  saveBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    const newUsername = usernameInput.value.trim().replace(/^@/, "");
    const newNickname = nicknameInput.value.trim();
    if (!newUsername || !/^[a-zA-Z0-9_]{3,20}$/.test(newUsername)) {
      showToast("Юзернейм: 3-20 символов, латиница/цифры/_");
      return;
    }
    if (/^ch_/i.test(newUsername)) {
      showToast("Префикс ch_ зарезервирован за каналами");
      return;
    }
    saveBtn.disabled = true;
    try {
      const usernameChanged = newUsername !== currentUserDoc.username;
      if (usernameChanged) {
        if (await isUsernameTaken(newUsername)) { showToast("Этот username уже занят"); return; }
      }
      const patch = {
        nickname: newNickname || currentUserDoc.nickname,
        bio: bioInput.value.trim(),
        avatarShape: pendingShape,
        statusEmoji: pendingStatus,
        nuidVisibility: nuidVisibility.value,
        repostVisibility: repostVisibility.value
      };
      if (pendingAvatarFile) {
        showToast("Загружаю аватарку...");
        patch.avatarUrl = await uploadImage(pendingAvatarFile);
        pendingAvatarFile = null;
      }
      if (usernameChanged) {
        await changeUsername(currentUser.uid, currentUserDoc.username, newUsername, "user");
        patch.username = newUsername;
      }
      await updateUserDoc(currentUser.uid, patch);
      patchCurrentUserDoc(patch);
      showToast("Профиль сохранён ♡");
    } catch (e) {
      console.error(e);
      showToast("Не сохранилось: " + e.message);
    } finally {
      saveBtn.disabled = false;
    }
  });

  exportBtn.addEventListener("click", () => {
    exportLocalBackup({ user: currentUserDoc, exportedAt: new Date().toISOString() });
    showToast("Бэкап скачан");
  });

  logoutBtn.addEventListener("click", async () => {
    await logout();
    location.href = "index.html";
  });
}
