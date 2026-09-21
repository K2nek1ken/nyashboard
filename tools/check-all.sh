#!/usr/bin/env bash
# Все проверки разом — прогнать перед сборкой.
#
#   bash tools/check-all.sh
#
# Что смотрит:
#   разбор       — каждый файл читается как программа
#   импорты      — то, что берут, существует
#   родня        — одна возможность не отстала в соседнем месте
#   скобки       — стили и правила базы не оборваны
#   разметка     — теги закрыты
#   аудит        — остальное, подробным списком

cd "$(dirname "$0")/.." || exit 1
FAIL=0

echo "→ Разбор файлов"
cd js || exit 1
for f in *.js modules/*.js; do
  node --input-type=module --check < "$f" 2>/dev/null || { echo "   ✗ $f"; FAIL=1; }
done
cd ..
[ "$FAIL" = "0" ] && echo "   всё читается"

echo "→ Импорты"
(cd js && python3 ../tools/check-imports.py) || FAIL=1

echo "→ Родственные места"
python3 tools/check-pairs.py || FAIL=1

echo "→ Скобки"
python3 - <<'PY' || FAIL=1
import sys
ok = True
for name in ("style.css", "firestore.rules"):
    s = open(name, encoding="utf-8").read()
    if s.count("{") != s.count("}"):
        print(f"   ✗ {name}: {s.count('{')} и {s.count('}')}")
        ok = False
print("   сходятся" if ok else "")
sys.exit(0 if ok else 1)
PY

echo "→ Разметка"
python3 - <<'PY' || FAIL=1
import glob, sys
from html.parser import HTMLParser

class Check(HTMLParser):
    VOID = {"input", "img", "br", "hr", "link", "meta", "source"}
    def __init__(self):
        super().__init__()
        self.stack, self.bad = [], []
    def handle_starttag(self, tag, attrs):
        if tag not in self.VOID:
            self.stack.append(tag)
    def handle_endtag(self, tag):
        if not self.stack:
            self.bad.append(f"лишний </{tag}>")
        elif self.stack[-1] != tag:
            self.bad.append(f"<{self.stack[-1]}> закрыт как </{tag}>")
        else:
            self.stack.pop()

problems = []
for f in sorted(glob.glob("*.html")):
    c = Check()
    c.feed(open(f, encoding="utf-8").read())
    if c.bad or c.stack:
        problems.append(f"   ✗ {f}: {', '.join(c.bad) or 'не закрыт ' + c.stack[-1]}")

print("\n".join(problems) if problems else "   всё закрыто")
sys.exit(1 if problems else 0)
PY

echo "→ Чат собирается вживую"
node tools/smoke-chat.mjs || FAIL=1

echo "→ Лента собирается вживую"
node tools/smoke-feed.mjs || FAIL=1

echo "→ Неподключённые имена"
node tools/check-unbound.mjs || FAIL=1

echo "→ Вызовы несуществующих функций"
# Это не замечание, а поломка: код падает при запуске. Известные ложные
# срабатывания (объявления ниже по файлу, методы объектов) перечислены —
# всё новое останавливает сборку.
python3 - <<'PY' || FAIL=1
import subprocess, re, sys
out = subprocess.run(["python3", "tools/audit.py"], capture_output=True, text=True).stdout
block = re.search(r"\[Вызов несуществующей функции\][^\n]*\n((?:    .*\n)+)", out)
lines = [l.strip() for l in block.group(1).splitlines()] if block else []

KNOWN = {"markup.js — applySizes()", "storage.js — createImageBitmap()",
         "storage.js — XMLHttpRequest()", "storage.js — imgbb()",
         "storage.js — catbox()", "storage.js — uguu()"}
fresh = [l for l in lines if re.sub(r":\d+", "", l) not in KNOWN]
if fresh:
    print("   ✗ " + "\n   ✗ ".join(fresh))
    sys.exit(1)
print("   новых нет")
PY

echo "→ Аудит"
python3 tools/audit.py 2>&1 | grep -E "^Найдено|^\[" | sed 's/^/   /'

echo
[ "$FAIL" = "0" ] && echo "✓ Готово к сборке" || echo "✗ Есть нерешённое"
exit $FAIL
