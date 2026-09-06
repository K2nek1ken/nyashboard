import { currentUser, currentUserDoc, authPending, onAuthChange, patchCurrentUserDoc, logout, loginWithGoogle } from "./auth.js";
import { updateUserDoc, isUsernameTaken, changeUsername, getUserDoc } from "./data.js";
import { uploadImage } from "./storage.js";
import { showToast } from "./ui.js";
import { shapeClass, shapePickerHtml, openCropper, applyAvatar } from "./avatar.js";
import { openEmojiPicker } from "./emoji.js";
import { ACCESSORIES, accessoryHtml } from "./accessories.js";
import { paletteEntries, paletteColor } from "./palette.js";
import { ICON } from "./icons.js";
import { requestNuid, ensureNuidExists } from "./nuid.js";

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
  const logoutBtn = document.getElementById("logoutBtnPage");
  const shapeHost = document.getElementById("shapePickerHost");
  const statusBtn = document.getElementById("statusEmojiBtn");
  const statusPreview = document.getElementById("statusEmojiPreview");
  const nuidVisibility = document.getElementById("nuidVisibility");
  const repostVisibility = document.getElementById("repostVisibility");
  const genderSelect = document.getElementById("genderSelect");
  const listVisibility = document.getElementById("listVisibility");
  const musicVisibility = document.getElementById("musicVisibility");

  let pendingAvatarFile = null;
  let pendingShape = "circle";
  let pendingStatus = "";
  let pendingAccessory = "none";
  let pendingBorder = "pink";
  let pendingNickColor = "";

  const accessoryHost = document.getElementById("accessoryPickerHost");
  const colorHost = document.getElementById("colorPickerHost");
  const nickColorHost = document.getElementById("nickColorHost");

  // Живой предпросмотр: украшение и рамка сразу видны на аватарке сверху,
  // чтобы не приходилось сохранять ради проверки.
  function applyDecorPreview() {
    const wrap = pageAvatar.closest(".avatar-wrap");
    if (!wrap) return;
    pageAvatar.style.borderColor = paletteColor(pendingBorder);
    wrap.querySelector(".avatar-accessory")?.remove();
    const html = accessoryHtml(pendingAccessory, pendingBorder);
    if (html) pageAvatar.insertAdjacentHTML("afterend", html);
  }

  function renderAccessoryPicker() {
    accessoryHost.innerHTML = `<div class="accessory-picker">
      ${Object.entries(ACCESSORIES).map(([key, label]) => `
        <button type="button" class="accessoryOption ${key === pendingAccessory ? "selected" : ""}"
                data-accessory="${key}" title="${label}">
          ${key === "none" ? '<span class="none-label">нет</span>'
                           : accessoryHtml(key, pendingBorder).replace("avatar-accessory", "")}
        </button>`).join("")}
    </div>`;
    accessoryHost.querySelectorAll("[data-accessory]").forEach(btn => {
      btn.addEventListener("click", () => {
        pendingAccessory = btn.dataset.accessory;
        renderAccessoryPicker();
        applyDecorPreview();
      });
    });
  }

  // Цвет ника — отдельно от рамки: это разные части образа, и часто хочется
  // яркое имя при спокойной рамке. Пустой вариант = обычный цвет текста.
  function renderNickColorPicker() {
    nickColorHost.innerHTML = `<div class="color-picker">
      <button type="button" class="colorOption ${!pendingNickColor ? "selected" : ""}"
              data-nick-color="" title="Обычный"
              style="background:var(--text);"></button>
      ${paletteEntries().map(p => `
        <button type="button" class="colorOption ${p.key === pendingNickColor ? "selected" : ""}"
                data-nick-color="${p.key}" title="${p.label}"
                style="background:${p.color};"></button>`).join("")}
    </div>
    <div style="text-align:center; margin-top:8px;">
      <span class="person-name" style="${pendingNickColor ? `color:${paletteColor(pendingNickColor)}` : ""}">
        ${nicknameInput.value || "твой ник"}
      </span>
    </div>`;
    nickColorHost.querySelectorAll("[data-nick-color]").forEach(btn => {
      btn.addEventListener("click", () => {
        pendingNickColor = btn.dataset.nickColor;
        renderNickColorPicker();
      });
    });
  }

  function renderColorPicker() {
    colorHost.innerHTML = `<div class="color-picker">
      ${paletteEntries().map(p => `
        <button type="button" class="colorOption ${p.key === pendingBorder ? "selected" : ""}"
                data-color="${p.key}" title="${p.label}"
                style="background:${p.color};"></button>`).join("")}
    </div>`;
    colorHost.querySelectorAll("[data-color]").forEach(btn => {
      btn.addEventListener("click", () => {
        pendingBorder = btn.dataset.color;
        renderColorPicker();
        renderAccessoryPicker();   // украшения перекрашиваем вместе с рамкой
        applyDecorPreview();
      });
    });
  }

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
    // Пока Firebase восстанавливает сессию, currentUser ещё пуст — но это не
    // значит, что человек не вошёл. Раньше здесь на долю секунды показывалось
    // «ты не в аккаунте», что выглядело как самопроизвольный выход.
    if (authPending && !currentUser) {
      loggedOutNote.classList.remove("hidden");
      loggedOutNote.innerHTML = `
        <p class="muted"><span class="nf spin-slow">${ICON.refresh}</span> Секунду, обновляю данные…</p>`;
      form.classList.add("hidden");
      return;
    }
    if (currentUser && currentUserDoc) {
      loggedOutNote.classList.add("hidden");
      form.classList.remove("hidden");
      applyAvatar(pageAvatar, currentUserDoc, "neko");
      pageAvatar.style.width = pageAvatar.style.height = "88px";
      nicknameInput.value = currentUserDoc.nickname || "";
      usernameInput.value = currentUserDoc.username || "";
      bioInput.value = currentUserDoc.bio || "";
      // Свой идентификатор всегда доступен — правило разрешает читать самому себе.
      // Если его нет (не записался при регистрации), досоздаём молча.
      uidDisplay.textContent = "загружаю…";
      requestNuid(currentUser.uid)
        .then(n => n || ensureNuidExists(currentUser.uid))
        .then(n => { uidDisplay.textContent = n || "не записан — проверь правила базы"; });
      nuidVisibility.value = currentUserDoc.nuidVisibility || "friends";
      repostVisibility.value = currentUserDoc.repostVisibility || "everyone";
      genderSelect.value = currentUserDoc.gender || "x";
      listVisibility.value = currentUserDoc.hiddenFromList ? "hide" : "show";
      musicVisibility.value = currentUserDoc.musicVisibility || "everyone";
      pendingShape = currentUserDoc.avatarShape || "circle";
      pendingStatus = currentUserDoc.statusEmoji || "";
      pageStatus.textContent = pendingStatus;
      statusPreview.textContent = pendingStatus || "выбрать";
      pendingAccessory = currentUserDoc.accessory || "none";
      pendingBorder = currentUserDoc.avatarBorder || "pink";
      applyShapePreview();
      renderShapePicker();
      pendingNickColor = currentUserDoc.nickColor || "";
      renderAccessoryPicker();
      renderColorPicker();
      renderNickColorPicker();
      applyDecorPreview();
    } else {
      loggedOutNote.classList.remove("hidden");
      // возвращаем исходную разметку: её могла затереть заглушка загрузки
      loggedOutNote.innerHTML = `
        <p>Ты пока не в аккаунте</p>
        <button id="pageLoginBtn" class="primaryBtn" style="width:auto; padding:10px 22px;">Войти через Google</button>`;
      loggedOutNote.querySelector("#pageLoginBtn")?.addEventListener("click", loginWithGoogle);
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

  // Нажатие на идентификатор или юзернейм копирует их: чаще всего именно это
  // с ними и делают — отправляют кому-то.
  async function copyValue(text, label) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast(label + " скопирован");
    } catch {
      showToast(label + ": " + text);
    }
  }
  uidDisplay.style.cursor = "pointer";
  uidDisplay.title = "нажми, чтобы скопировать";
  uidDisplay.addEventListener("click", () => copyValue(uidDisplay.textContent, "NUID"));
  usernameInput.addEventListener("dblclick", () => copyValue("@" + usernameInput.value, "Юзернейм"));

  saveBtn.addEventListener("click", async () => {
    if (!currentUser) return;
    // Если профиль не загрузился, в форме лежат придуманные значения —
    // сохранять их означало бы затереть настоящие данные в базе.
    if (currentUserDoc?._incomplete) {
      showToast("Профиль не загружен, сохранять нечего. Ошибка: " + (currentUserDoc._error || "неизвестна"));
      return;
    }
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
        accessory: pendingAccessory,
        avatarBorder: pendingBorder,
        nickColor: pendingNickColor,
        nuidVisibility: nuidVisibility.value,
        repostVisibility: repostVisibility.value,
        gender: genderSelect.value,
        hiddenFromList: listVisibility.value === "hide",
        musicVisibility: musicVisibility.value
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

      // Проверяем, что запись реально долетела до сервера. Firestore применяет
      // изменения локально сразу, поэтому без перечитывания можно показать
      // «сохранено» там, где сервер на самом деле отказал.
      const saved = await getUserDoc(currentUser.uid);
      if (!saved || saved.nickname !== patch.nickname) {
        throw new Error("сервер не принял изменения — проверь правила базы");
      }
      patchCurrentUserDoc(patch);
      showToast("Профиль сохранён ♡");
    } catch (e) {
      console.error(e);
      showToast("Не сохранилось: " + e.message);
    } finally {
      saveBtn.disabled = false;
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await logout();
    location.href = "index.html";
  });
}
