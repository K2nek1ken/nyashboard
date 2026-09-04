#!/usr/bin/env python3
"""Статические проверки перед публикацией.

Ловит ровно те поломки, которые уже случались в этом проекте и которые
не видно ни глазами, ни синтаксической проверкой:

  1. импорт того, чего модуль не экспортирует;
  2. использование чужой функции БЕЗ импорта — именно так ensureUserDoc
     звала generateUniqueNuid, и создание любого нового аккаунта падало
     с ReferenceError уже в бою;
  3. циклические зависимости между модулями;
  4. баланс скобок в firestore.rules и style.css;
  5. id, которые ищет JS, но которых нет ни в разметке, ни в шаблонах.

Запуск:  python3 tools/check.py     (из корня репозитория)
Код возврата 1, если что-то найдено, — чтобы годилось для CI.
"""

import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS_DIR = os.path.join(ROOT, "js")

problems = []

# конструкции языка выглядят как вызовы, но ими не являются
KEYWORDS = {
    "if", "for", "while", "switch", "catch", "return", "typeof", "function",
    "await", "new", "delete", "void", "in", "of", "do", "else", "yield", "import",
}


def js_files():
    return sorted(f for f in os.listdir(JS_DIR) if f.endswith(".js"))


def read(name):
    with open(os.path.join(JS_DIR, name), encoding="utf-8") as fh:
        return fh.read()


# ---------- строки и комментарии мешают искать идентификаторы ----------
def strip_noise(src):
    src = re.sub(r"/\*.*?\*/", " ", src, flags=re.S)
    src = re.sub(r"//[^\n]*", " ", src)
    src = re.sub(r"`(?:\\.|[^`\\])*`", " ", src, flags=re.S)
    src = re.sub(r"'(?:\\.|[^'\\\n])*'", " ", src)
    src = re.sub(r'"(?:\\.|[^"\\\n])*"', " ", src)
    return src


def collect_exports(src):
    names = set()
    for m in re.finditer(
        r"^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)",
        src, re.M):
        names.add(m.group(1))
    for m in re.finditer(r"^export\s*\{([^}]*)\}", src, re.M):
        for part in m.group(1).split(","):
            part = part.strip()
            if part:
                names.add(part.split(" as ")[-1].strip())
    if re.search(r"^export\s+default", src, re.M):
        names.add("default")
    return names


def collect_imports(src):
    """-> [(модуль, [импортированные имена])], только локальные модули."""
    out = []
    for m in re.finditer(r"import\s+([^;]+?)\s+from\s+['\"]([^'\"]+)['\"]", src, re.S):
        clause, path = m.group(1), m.group(2)
        if not path.startswith("."):
            continue
        names = []
        braces = re.search(r"\{([^}]*)\}", clause)
        if braces:
            for part in braces.group(1).split(","):
                part = part.strip()
                if part:
                    names.append(part.split(" as ")[0].strip())
        default_part = re.sub(r"\{[^}]*\}", "", clause).replace(",", " ").strip()
        if default_part and not default_part.startswith("*"):
            names.append("default")
        out.append((os.path.basename(path), names))
    return out


def local_names(src):
    """Имена, объявленные в самом модуле или пришедшие в него по импорту."""
    names = set()
    for pattern in (
        r"\b(?:function|class)\s+([A-Za-z0-9_$]+)",
        r"\b(?:const|let|var)\s+([A-Za-z0-9_$]+)",
    ):
        names.update(m.group(1) for m in re.finditer(pattern, src))
    for m in re.finditer(r"import\s+([^;]+?)\s+from\s+['\"][^'\"]+['\"]", src, re.S):
        clause = m.group(1)
        braces = re.search(r"\{([^}]*)\}", clause)
        if braces:
            for part in braces.group(1).split(","):
                part = part.strip()
                if part:
                    names.add(part.split(" as ")[-1].strip())
        default_part = re.sub(r"\{[^}]*\}", "", clause).replace(",", " ").strip()
        if default_part and not default_part.startswith("*"):
            names.add(default_part)
        star = re.search(r"\*\s+as\s+([A-Za-z0-9_$]+)", clause)
        if star:
            names.add(star.group(1))
    # деструктуризация: const { a, b } = ... и параметры-объекты
    for m in re.finditer(r"\{([^{}]*)\}\s*=", src):
        for part in m.group(1).split(","):
            part = part.strip()
            if part:
                names.add(re.split(r"[:=]", part)[-1].strip())
    return names


def main():
    files = js_files()
    sources = {f: read(f) for f in files}
    exports = {f: collect_exports(s) for f, s in sources.items()}
    imports = {f: collect_imports(s) for f, s in sources.items()}

    # 1. импорт того, чего нет
    for f, entries in imports.items():
        for target, names in entries:
            if target not in exports:
                problems.append(f"{f}: импортирует из неизвестного модуля {target}")
                continue
            for n in names:
                if n not in exports[target]:
                    problems.append(f"{f}: импортирует {n} из {target}, но там такого экспорта нет")

    # 2. использование чужого экспорта без импорта
    owners = defaultdict(set)
    for f, names in exports.items():
        for n in names:
            if n != "default":
                owners[n].add(f)
    for f, src in sources.items():
        clean = strip_noise(src)
        known = local_names(src)
        # (?<![.\w$]) — чтобы не считать вызовом метода: m.getUserDoc() берётся
        # из объекта модуля при динамическом import() и импорта не требует
        used = {m.group(1) for m in re.finditer(r"(?<![.\w$])([A-Za-z0-9_$]+)\s*\(", clean)}
        used -= KEYWORDS
        for name in sorted(used - known):
            homes = owners.get(name, set()) - {f}
            if homes:
                problems.append(
                    f"{f}: зовёт {name}() без импорта — экспортируется из {', '.join(sorted(homes))}")

    # 3. циклы
    graph = {f: {t for t, _ in imports[f]} for f in files}
    stack, done, seen_cycles = [], set(), set()
    def walk(node):
        if node in stack:
            cycle = stack[stack.index(node):] + [node]
            key = " -> ".join(cycle)
            if key not in seen_cycles:
                seen_cycles.add(key)
                problems.append("циклическая зависимость: " + key)
            return
        if node in done:
            return
        stack.append(node)
        for nxt in sorted(graph.get(node, ())):
            walk(nxt)
        stack.pop()
        done.add(node)
    for f in files:
        walk(f)

    # 4. баланс скобок
    for name in ("firestore.rules", "style.css"):
        path = os.path.join(ROOT, name)
        if os.path.exists(path):
            text = open(path, encoding="utf-8").read()
            if text.count("{") != text.count("}"):
                problems.append(f"{name}: не сходится баланс фигурных скобок")

    # 5. id, которых нет в разметке
    ids = set()
    for name in os.listdir(ROOT):
        if name.endswith(".html"):
            ids.update(re.findall(r'id="([^"]+)"',
                                  open(os.path.join(ROOT, name), encoding="utf-8").read()))
    for src in sources.values():   # id, которые создаёт сам JS
        ids.update(re.findall(r'\.id\s*=\s*"([^"]+)"', src))
        ids.update(re.findall(r'id="([^"${}]+)"', src))
    for f, src in sources.items():
        wanted = set(re.findall(r'getElementById\(\s*"([^"]+)"', src))
        wanted |= set(re.findall(r'querySelector\(\s*"#([A-Za-z0-9_-]+)"', src))
        for i in sorted(wanted - ids):
            problems.append(f"{f}: ищет #{i}, но такого id нет ни в разметке, ни в шаблонах")

    if problems:
        print("Найдено проблем:", len(problems))
        for p in problems:
            print("  •", p)
        return 1
    print("Всё чисто ♡")
    return 0


if __name__ == "__main__":
    sys.exit(main())
