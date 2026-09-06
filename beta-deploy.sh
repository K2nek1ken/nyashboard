#!/data/data/com.termux/files/usr/bin/env bash
# ============================================================
#  Публикация тестовой сборки в подпапку /beta
#
#  Запуск:  bash ~/nyashboard/beta-deploy.sh
#
#  Почему подпапка, а не отдельная ветка: GitHub Pages публикует только одну
#  ветку. Отдельную ветку пришлось бы собирать через Actions в ту же ветку —
#  лишняя сложность ради того же результата.
#
#  Подпапка даёт ровно то, что нужно: тот же домен, а значит те же данные
#  Firebase и уже разрешённый вход через Google. Настраивать ничего не надо.
#
#  Итог:  обычная версия — /nyashboard/
#         тестовая      — /nyashboard/beta/
# ============================================================
set -euo pipefail

# Заметное предупреждение: этот скрипт кладёт сборку в ПОДПАПКУ /beta/,
# а не в основную версию сайта. Их легко перепутать и потом искать, почему
# изменения «не появились».
echo
echo "  ВНИМАНИЕ: это публикация в ТЕСТОВУЮ подпапку /beta/"
echo "  Основная версия сайта при этом не меняется."
echo "  Для обычной публикации используй deploy.sh"
echo
printf "  Продолжить? [y/N] "
read -r answer
case "$answer" in
  [yY]*) ;;
  *) echo "Отменено."; exit 0 ;;
esac

REPO_DIR="${NYASH_REPO:-$HOME/nyashboard}"
ZIP_GLOB="NyashBoard*.zip"

cd "$REPO_DIR"

CANDIDATE_DIRS=("$HOME/storage/downloads" "$HOME/storage/shared/Download"
                "/sdcard/Download" "/storage/emulated/0/Download")
ZIP=""
for dir in "${CANDIDATE_DIRS[@]}"; do
  [ -d "$dir" ] || continue
  found=$(ls -t "$dir"/$ZIP_GLOB 2>/dev/null | head -n1 || true)
  if [ -n "$found" ]; then ZIP="$found"; break; fi
done
[ -n "$ZIP" ] || { echo "✗ Архив в загрузках не найден"; exit 1; }

echo "→ Архив: $(basename "$ZIP")"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
unzip -q "$ZIP" -d "$TMP"
SRC="$TMP/nyashboard"; [ -d "$SRC" ] || SRC="$TMP"

# Ключи берём из рабочей версии: тестовая сборка ходит в ту же базу,
# поэтому данные, аккаунты и записи у них общие.
mkdir -p beta
[ -f js/config.js ] && cp js/config.js "$TMP/config.keep.js"
rm -rf beta/*
cp -r "$SRC"/. beta/
rm -rf beta/.github beta/deploy.sh beta/beta-deploy.sh beta/setup-termux.sh beta/tools
[ -f "$TMP/config.keep.js" ] && cp "$TMP/config.keep.js" beta/js/config.js

# своя метка версии, чтобы бета не подхватывала кэш обычной версии
STAMP=$(date +%Y%m%d%H%M)
for f in beta/*.html; do
  sed -i -E "s/(style\.css\?v=)[0-9]+/\1$STAMP/g; s/(js\/[a-z-]+\.js\?v=)[0-9]+/\1$STAMP/g" "$f"
done

# заметная пометка, чтобы не перепутать вкладки
for f in beta/*.html; do
  sed -i 's|<title>NyashBoard ♡|<title>[БЕТА] NyashBoard ♡|' "$f"
done

git add -A
git commit -m "beta: тестовая сборка $STAMP" || { echo "→ Изменений нет"; exit 0; }
git push
echo "✓ Тестовая версия: https://ТВОЙ-ЛОГИН.github.io/nyashboard/beta/"
