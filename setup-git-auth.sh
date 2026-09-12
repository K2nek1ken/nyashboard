#!/data/data/com.termux/files/usr/bin/env bash
# ============================================================
#  Разовая настройка входа в GitHub
#
#  Запуск:  bash setup-git-auth.sh
#
#  После неё git перестаёт спрашивать логин и пароль при каждой отправке.
#
#  Почему не вписать токен прямо в скрипт: скрипты лежат в репозитории,
#  а он открыт всему интернету. Токен оттуда сразу же подберут — им можно
#  менять код, удалять ветки и всё остальное от твоего имени.
#
#  Здесь он сохраняется в домашнюю папку Termux, куда репозиторий не заглядывает.
# ============================================================
set -euo pipefail

STORE="$HOME/.git-credentials"

echo "Настройка входа в GitHub"
echo

read -rp "  Логин GitHub: " USERNAME
[ -n "$USERNAME" ] || { echo "✗ Логин не может быть пустым"; exit 1; }

echo
echo "  Нужен токен доступа, а не пароль от аккаунта."
echo "  Где взять: github.com → Settings → Developer settings →"
echo "             Personal access tokens → Fine-grained tokens"
echo "  Права: доступ к репозиторию nyashboard, Contents: Read and write"
echo
read -rsp "  Токен (не отображается при вводе): " TOKEN
echo
[ -n "$TOKEN" ] || { echo "✗ Токен не может быть пустым"; exit 1; }

# Учётные данные хранит сам git, отдельно от проекта
git config --global credential.helper store
printf 'https://%s:%s@github.com\n' "$USERNAME" "$TOKEN" > "$STORE"
chmod 600 "$STORE"       # читать может только владелец

# Заодно имя автора для записей, если его ещё нет
git config --global user.name >/dev/null 2>&1 || git config --global user.name "$USERNAME"
if ! git config --global user.email >/dev/null 2>&1; then
  echo
  read -rp "  Почта для подписи коммитов: " EMAIL
  [ -n "$EMAIL" ] && git config --global user.email "$EMAIL"
fi

echo
echo "✓ Готово. Логин и токен больше спрашиваться не будут."
echo "  Хранятся в $STORE — эта папка вне репозитория и на GitHub не попадёт."
echo
echo "  Если токен когда-нибудь утечёт: отзови его на GitHub и запусти этот скрипт заново."
