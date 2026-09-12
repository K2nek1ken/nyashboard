#!/data/data/com.termux/files/usr/bin/env bash
# ============================================================
#  NyashBoard — деплой с телефона через Termux
#
#  Запуск:  bash ~/nyashboard/deploy.sh "текст коммита"
#
#  Именно `bash script`, а не `./script`: если файл лежит на /sdcard
#  (загрузки, общая память), Android не даёт ставить бит исполнения,
#  и `./deploy.sh` падает с "permission denied" — chmod там бессилен.
# ============================================================
set -euo pipefail

# $HOME в Termux = /data/data/com.termux/files/home
# Папку определяем по расположению скрипта: репозиторий может лежать
# не только в $HOME, но и на общей памяти телефона.
REPO_DIR="${NYASH_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
ZIP_GLOB="NyashBoard*.zip"
MSG="${1:-update $(date '+%Y-%m-%d %H:%M')}"

die() { echo "✗ $1" >&2; exit 1; }

# ---------- проверки окружения ----------
command -v git >/dev/null 2>&1 || die "git не установлен. Выполни: pkg install git"
command -v unzip >/dev/null 2>&1 || die "unzip не установлен. Выполни: pkg install unzip"

# Git отказывается делать запись, пока не знает автора. Проверяем заранее:
# иначе ошибка вылезает в самом конце, после распаковки и всех правок.
git config user.name >/dev/null 2>&1 || die "Git не знает, кто ты. Выполни один раз:
    git config --global user.name \"твой-логин\"
    git config --global user.email \"твоя@почта\"
  Почта — та же, что на GitHub."
git config user.email >/dev/null 2>&1 || die "Не задана почта для Git. Выполни:
    git config --global user.email \"твоя@почта\""

[ -d "$REPO_DIR" ] || die "Нет папки $REPO_DIR
  Сначала склонируй репозиторий:
    cd \$HOME && git clone https://github.com/USERNAME/nyashboard.git"

[ -d "$REPO_DIR/.git" ] || die "$REPO_DIR — не git-репозиторий.
  Репозиторий должен лежать во внутренней памяти Termux (\$HOME),
  а не на /sdcard: на общей памяти git работает некорректно."

case "$REPO_DIR" in
  /sdcard/*|/storage/*)
    die "Репозиторий лежит на общей памяти ($REPO_DIR).
  Там нет нормальных прав доступа и git ломается.
  Перенеси его в \$HOME: mv \"$REPO_DIR\" \$HOME/nyashboard" ;;
esac

cd "$REPO_DIR"

# ---------- ищем архив в загрузках ----------
# termux-setup-storage создаёт ~/storage/downloads; если его нет,
# пробуем стандартные пути напрямую
CANDIDATE_DIRS=(
  "$HOME/storage/downloads"
  "$HOME/storage/shared/Download"
  "/sdcard/Download"
  "/storage/emulated/0/Download"
)

ZIP=""
for dir in "${CANDIDATE_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  found=$(ls -t "$dir"/$ZIP_GLOB 2>/dev/null | head -n1 || true)
  if [ -n "$found" ]; then ZIP="$found"; break; fi
done

if [ -z "$ZIP" ]; then
  echo "→ Архив $ZIP_GLOB в загрузках не найден."
  echo "  Проверенные папки:"
  printf '    %s\n' "${CANDIDATE_DIRS[@]}"
  echo "  Если доступа к памяти нет — выполни: termux-setup-storage"
  echo "→ Коммичу то, что уже лежит в репозитории."
else
  echo "→ Архив: $ZIP"

  # Показываем, что внутри: у файлов в загрузках похожие имена
  # (NyashBoard-3, NyashBoard-6), и выложить старый по ошибке проще простого.
  INCOMING=$(unzip -p "$ZIP" "*/js/version.js" 2>/dev/null | grep -oE 'name: "[^"]*"' || true)
  [ -n "$INCOMING" ] && echo "→ Сборка: ${INCOMING#name: }"

  # Сверяем с уже выложенной: совпадение почти всегда означает, что выбран
  # не тот файл.
  CURRENT=$(grep -oE 'name: "[^"]*"' "$REPO_DIR/js/version.js" 2>/dev/null || true)
  if [ -n "$CURRENT" ] && [ "$CURRENT" = "$INCOMING" ]; then
    echo
    echo "⚠ Такая сборка уже выложена."
    printf "  Всё равно продолжить? [y/N] "
    read -r same_answer
    case "$same_answer" in
      [yY]*) ;;
      *) echo "Отменено."; exit 0 ;;
    esac
  fi
  TMP=$(mktemp -d)
  trap 'rm -rf "$TMP"' EXIT

  unzip -q "$ZIP" -d "$TMP" || die "не смогла распаковать архив"

  # внутри архива папка nyashboard/ — берём её содержимое
  SRC="$TMP/nyashboard"
  [ -d "$SRC" ] || SRC="$TMP"
  [ -f "$SRC/index.html" ] || die "в архиве нет index.html — это точно сборка NyashBoard?"

  # config.js с твоими ключами не должен затираться содержимым архива
  KEEP_CONFIG=""
  if [ -f js/config.js ]; then
    KEEP_CONFIG="$TMP/config.keep.js"
    cp js/config.js "$KEEP_CONFIG"
  fi

  # чистим всё кроме .git и переносим новую сборку
  find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
  cp -r "$SRC"/. .

  if [ -n "$KEEP_CONFIG" ]; then
    cp "$KEEP_CONFIG" js/config.js
    echo "→ Твой js/config.js сохранён (ключи не затёрлись)"
  fi
fi

# ---------- штамп версии в адресах стилей и скриптов ----------
#
# GitHub Pages просит браузер хранить файлы десять минут, а браузеры держат их
# и дольше — после обновления сайт какое-то время показывает старую версию.
# Свежая метка в адресе делает файл «новым», и он перечитывается сразу.
STAMP=$(date +%Y%m%d%H%M)
for f in *.html; do
  [ -f "$f" ] || continue
  sed -i -E "s/(style\.css\?v=)[0-9]+/\1$STAMP/g; s/(js\/[a-z-]+\.js\?v=)[0-9]+/\1$STAMP/g; s/(favicon\.svg\?v=)[0-9]+/\1$STAMP/g" "$f"
done
echo "→ Версия ресурсов обновлена: $STAMP"

# ---------- коммит и пуш ----------
git add -A
if git diff --cached --quiet; then
  echo "→ Изменений нет, пушить нечего."
  exit 0
fi

git commit -m "$MSG"

echo "→ Пушу..."
if ! git push; then
  die "push не прошёл.
  Обычно это токен. Создай Personal Access Token на GitHub
  (Settings → Developer settings → Personal access tokens → Fine-grained,
   права Contents: Read and write) и введи его вместо пароля.
  Чтобы он запомнился: git config --global credential.helper store"
fi

echo "✓ Готово: $MSG"
echo "  GitHub Pages обновится примерно через минуту."

# ---------- правила Firestore, если менялись ----------
if command -v firebase >/dev/null 2>&1; then
  if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q 'firestore.rules'; then
    echo "→ firestore.rules изменились, деплою..."
    firebase deploy --only firestore:rules || echo "  (не вышло — задеплой вручную)"
  fi
fi

# Правила базы отправляются отдельно: git их только хранит, применяет Firebase.
# Напоминаем, если они изменились в этой выкладке.
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -q "firestore.rules"; then
  echo
  echo "⚠ Правила базы изменились. Их нужно применить отдельно:"
  echo "    bash "$REPO_DIR/deploy-rules.sh""
fi
