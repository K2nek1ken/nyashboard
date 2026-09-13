#!/data/data/com.termux/files/usr/bin/env bash
# ============================================================
#  Публикация правил Firestore с телефона
#
#  Запуск:  bash ~/nyashboard/deploy-rules.sh
#
#  Правила нельзя перенести копированием: они длинные, и буфер обмена их
#  обрезает. Здесь они отправляются прямо из файла в репозитории.
#
#  Первый раз понадобится установить инструменты и войти — скрипт скажет,
#  что именно сделать.
# ============================================================
set -euo pipefail

# Папку берём по расположению самого скрипта, а не по $HOME: репозиторий
# может лежать и на общей памяти телефона, и где угодно ещё.
REPO_DIR="${NYASH_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
RULES="$REPO_DIR/firestore.rules"

die() { echo "✗ $1" >&2; exit 1; }

[ -f "$RULES" ] || die "Не нашла $RULES"

# ---------- проверка инструментов ----------
if ! command -v node >/dev/null 2>&1; then
  die "Нужен Node. Выполни один раз:
    pkg install nodejs"
fi

if ! command -v firebase >/dev/null 2>&1; then
  die "Нужен инструмент Firebase. Выполни один раз:
    npm install -g firebase-tools
  Установка занимает пару минут."
fi

cd "$REPO_DIR"

# ---------- вход ----------
# На телефоне обычный вход не работает: он поднимает локальный сервер и ждёт
# возврата из браузера. Ключ --no-localhost показывает код, который нужно
# вставить обратно в Termux.
if ! firebase projects:list >/dev/null 2>&1; then
  echo "→ Сначала войди в Firebase."
  echo "  Откроется ссылка, после входа скопируй код обратно сюда."
  echo
  firebase login --no-localhost
fi

# ---------- проверка перед отправкой ----------
# Считаем скобки: несбалансированный файл база отвергнет, но лучше узнать
# об этом здесь, чем после отправки.
open_count=$(tr -cd '{' < "$RULES" | wc -c)
close_count=$(tr -cd '}' < "$RULES" | wc -c)
[ "$open_count" = "$close_count" ] || die "В правилах не сходятся скобки: $open_count открывающих, $close_count закрывающих"

# Проект указываем явно: без этого Firebase не знает, куда отправлять,
# и падает с «No currently active project». Идентификатор берём из настроек
# сайта — он там уже есть, и дублировать его вручную незачем.
PROJECT="${FIREBASE_PROJECT:-}"
if [ -z "$PROJECT" ] && [ -f "$REPO_DIR/js/config.js" ]; then
  PROJECT=$(grep -o 'projectId:[[:space:]]*"[^"]*"' "$REPO_DIR/js/config.js" | head -1 | cut -d'"' -f2)
fi
[ -n "$PROJECT" ] || die "Не нашла идентификатор проекта в js/config.js.
  Укажи его вручную:
    FIREBASE_PROJECT=имя-проекта bash $0"

# Показываем и репозиторий: правила у стабильной и тестовой версии свои,
# и отправить их не в тот проект — быстрый способ сломать рабочий сайт.
REMOTE=$(git -C "$REPO_DIR" remote get-url origin 2>/dev/null || echo "не задан")
echo "→ Репозиторий: ${REMOTE##*/}"
echo "→ Отправляю правила в проект «$PROJECT»..."
firebase deploy --only firestore:rules --project "$PROJECT"

echo
echo "✓ Правила обновлены"
echo "  Проверить можно в консоли: Firestore Database → Rules"
