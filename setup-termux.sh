#!/data/data/com.termux/files/usr/bin/env bash
# ============================================================
#  NyashBoard — первичная настройка Termux (запустить один раз)
#
#  Запуск:  bash setup-termux.sh https://github.com/USERNAME/nyashboard.git
# ============================================================
set -euo pipefail

REPO_URL="${1:-}"
REPO_DIR="$HOME/nyashboard"

echo "=== NyashBoard: настройка Termux ==="
echo

# 1. пакеты
echo "→ Ставлю пакеты (git, unzip, openssh)..."
pkg install -y git unzip openssh >/dev/null 2>&1 || pkg install -y git unzip openssh

# 2. доступ к памяти телефона (нужен, чтобы видеть папку загрузок)
if [ ! -d "$HOME/storage" ]; then
  echo "→ Запрашиваю доступ к памяти. Разреши во всплывающем окне Android."
  termux-setup-storage
  sleep 3
fi
[ -d "$HOME/storage/downloads" ] && echo "  ✓ загрузки видны" \
  || echo "  ! папка загрузок не появилась — проверь разрешение в настройках Android"

# 3. личные данные для git
if [ -z "$(git config --global user.name || true)" ]; then
  read -rp "Имя для коммитов: " gname
  git config --global user.name "$gname"
fi
if [ -z "$(git config --global user.email || true)" ]; then
  read -rp "Email для коммитов: " gmail
  git config --global user.email "$gmail"
fi

# токен спросится один раз и запомнится
git config --global credential.helper store
echo "  ✓ git настроен"

# 4. репозиторий — обязательно во внутренней памяти, не на /sdcard
if [ -d "$REPO_DIR/.git" ]; then
  echo "  ✓ репозиторий уже на месте: $REPO_DIR"
else
  if [ -z "$REPO_URL" ]; then
    echo
    echo "Не указан адрес репозитория. Запусти так:"
    echo "  bash setup-termux.sh https://github.com/USERNAME/nyashboard.git"
    exit 1
  fi
  echo "→ Клонирую $REPO_URL..."
  git clone "$REPO_URL" "$REPO_DIR"
  echo "  ✓ склонирован в $REPO_DIR"
fi

echo
echo "=== Готово ==="
echo
echo "Дальше при каждом обновлении:"
echo "  1. скачай архив со сборкой на телефон"
echo "  2. выполни:"
echo
echo "     bash \$HOME/nyashboard/deploy.sh \"что изменилось\""
echo
echo "При первом push вместо пароля вставь Personal Access Token"
echo "(GitHub → Settings → Developer settings → Personal access tokens →"
echo " Fine-grained, права Contents: Read and write). Он запомнится."
