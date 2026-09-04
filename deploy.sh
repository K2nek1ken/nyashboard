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
REPO_DIR="${NYASH_REPO:-$HOME/nyashboard}"
ZIP_GLOB="NyashBoard*.zip"
MSG="${1:-update $(date '+%Y-%m-%d %H:%M')}"

die() { echo "✗ $1" >&2; exit 1; }

# ---------- проверки окружения ----------
command -v git >/dev/null 2>&1 || die "git не установлен. Выполни: pkg install git"
command -v unzip >/dev/null 2>&1 || die "unzip не установлен. Выполни: pkg install unzip"

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
