#!/usr/bin/env python3
"""
Проверка проекта: ищет то, что не поймает ни синтаксический разбор,
ни глаз при чтении одного файла.

Запуск:  python3 tools/audit.py
"""
import re, os, json, sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = os.path.join(ROOT, "js")
problems = defaultdict(list)


def add(kind, msg):
    problems[kind].append(msg)


def js_files():
    return sorted(f for f in os.listdir(JS) if f.endswith(".js"))


def read(name):
    with open(os.path.join(JS, name), encoding="utf-8") as f:
        return f.read()


# ---------- 1. импорты и экспорты ----------
def check_imports():
    exports = {}
    for f in js_files():
        t = read(f)
        names = set()
        for m in re.finditer(r'export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)', t):
            names.add(m.group(1))
        for m in re.finditer(r'export\s*\{([^}]+)\}', t):
            for part in m.group(1).split(","):
                part = part.strip()
                if not part:
                    continue
                names.add(part.split(" as ")[-1].strip())
        exports[f] = names

    used = defaultdict(set)
    for f in js_files():
        t = read(f)

        # динамические импорты: const { a } = await import("./x.js")
        #                       import("./x.js").then(({ a }) => ...)
        for m in re.finditer(r'\{([^{}]+)\}\s*=\s*await\s+import\(["\']\./([\w-]+)\.js', t):
            for part in m.group(1).split(","):
                used[m.group(2) + ".js"].add(part.strip().split(":")[0].strip())
        for m in re.finditer(r'import\(["\']\./([\w-]+)\.js["\']\)\s*\.then\(\s*\(?\{([^}]+)\}', t):
            for part in m.group(2).split(","):
                used[m.group(1) + ".js"].add(part.strip().split(":")[0].strip())

        for m in re.finditer(r'import\s*\{([^}]+)\}\s*from\s*["\']\./([\w-]+)\.js["\']', t):
            target = m.group(2) + ".js"
            for part in m.group(1).split(","):
                name = part.strip().split(" as ")[0].strip()
                if not name:
                    continue
                used[target].add(name)
                if target in exports and name not in exports[target]:
                    add("Импорт несуществующего", f"{f}: {name} из {target}")

    # экспорты, которые никто не использует
    for f, names in exports.items():
        entry = f.endswith("-page.js") or f in ("shell.js", "router.js")
        for n in names:
            if entry or n in ("initPage", "destroyPage"):
                continue
            if n in used.get(f, set()):
                continue
            # Если имя встречается в своём же модуле, экспорт просто лишний —
            # это не ошибка, а повод прибраться. Разделяем, чтобы важное
            # не тонуло среди безобидного.
            body = read(f)
            inner = len(re.findall(rf'\b{n}\b', body)) > 1
            if inner:
                add("Лишний экспорт (используется внутри модуля)", f"{f}: {n}")
            else:
                add("Написано, но нигде не вызывается", f"{f}: {n}")


# ---------- 2. обращения к элементам ----------
def check_dom():
    for f in js_files():
        t = read(f)
        for m in re.finditer(r'document\.(getElementById\("(\w+)"\)|querySelector\("([^"]+)"\))\.(\w+)', t):
            prop = m.group(4)
            if prop in ("addEventListener", "classList", "value", "textContent", "innerHTML", "src", "checked"):
                line = t[:m.start()].count("\n") + 1
                add("Элемент без проверки", f"{f}:{line} — .{prop} у возможно отсутствующего элемента")


# ---------- 3. подстановка данных в разметку ----------
def check_injection():
    # шаблонные строки с ${...}, попадающие в innerHTML
    for f in js_files():
        t = read(f)
        for m in re.finditer(r'innerHTML\s*=\s*`([^`]*)`', t, re.S):
            body = m.group(1)
            for sub in re.finditer(r'\$\{([^}]+)\}', body):
                expr = sub.group(1).strip()
                safe = any(s in expr for s in (
                    "escapeHtml", "ICON", "SVG_ICON", "Html(", "avatarHtml", "kebabHtml",
                    "customSelect", "trackCardHtml", "paletteColor", "CHANNEL_COLOR",
                    "defaultAvatar", "defaultCover", "accessoryHtml", "nameHtml",
                    "badgeHtml", "formatDuration", "timeAgo", "gendered", "linkifyMentions",
                    "particleGlyph", "decorGlyph", "BUILD.", "row(", "group(", "select(",
                    "toggle(", ".length", ".map(", ".join(", "? ", "Math.", "JSON.",
                    "encodeURIComponent", "URL.createObjectURL", "paletteEntries",
                    "miniAvatarHtml", "imagesToHtml", "shapeClass", "shapePickerHtml"
                ))
                looks_like_data = re.search(r'\b(text|nickname|name|title|artist|message|description|bio|username|query|q)\b', expr, re.I)
                if not safe and looks_like_data:
                    line = t[:m.start()].count("\n") + 1
                    add("Данные в разметке без экранирования", f"{f}:{line} — ${{{expr[:60]}}}")


# ---------- 4. циклические зависимости ----------
def check_cycles():
    graph = {}
    for f in js_files():
        t = read(f)
        graph[f] = {m.group(1) + ".js" for m in re.finditer(r'import\s*\{[^}]+\}\s*from\s*["\']\./([\w-]+)\.js["\']', t)}
    color, found = {}, []

    def dfs(node, stack):
        color[node] = 1
        for dep in sorted(graph.get(node, ())):
            if color.get(dep) == 1:
                found.append(" -> ".join(stack[stack.index(dep):] + [dep]) if dep in stack else f"{node} -> {dep}")
            elif color.get(dep, 0) == 0:
                dfs(dep, stack + [dep])
        color[node] = 2

    for n in sorted(graph):
        if color.get(n, 0) == 0:
            dfs(n, [n])
    for c in found:
        add("Циклическая зависимость", c)


# ---------- 5. разметка ----------
def check_html():
    seen_ids = defaultdict(list)
    for f in sorted(os.listdir(ROOT)):
        if not f.endswith(".html"):
            continue
        t = open(os.path.join(ROOT, f), encoding="utf-8").read()

        ids = re.findall(r'\sid="([^"]+)"', t)
        dupes = {i for i in ids if ids.count(i) > 1}
        for d in dupes:
            add("Повторяющийся id", f"{f}: {d}")

        # ссылки на скрипты и стили
        for m in re.finditer(r'(?:src|href)="((?:js|assets)/[^"?]+)', t):
            path = os.path.join(ROOT, m.group(1))
            if not os.path.exists(path):
                add("Файл не найден", f"{f}: {m.group(1)}")

        # элементы, к которым обращается код этой страницы
        script = re.search(r'src="js/([\w-]+\.js)', t)
        if script and os.path.exists(os.path.join(JS, script.group(1))):
            page_ids = set(ids)
            seen_ids[f] = page_ids


# ---------- 6. правила базы ----------
def check_rules():
    path = os.path.join(ROOT, "firestore.rules")
    rules = open(path, encoding="utf-8").read()
    collections = set(re.findall(r'match /(\w+)/\{', rules))

    used = set()
    for f in js_files():
        t = read(f)
        for m in re.finditer(r'collection\(db,\s*"(\w+)"', t):
            used.add(m.group(1))
        for m in re.finditer(r'doc\(db,\s*"(\w+)"', t):
            used.add(m.group(1))

    for c in sorted(used - collections):
        add("Коллекция без правил", c)


# ---------- 7. асинхронность без обработки ----------
def check_promises():
    for f in js_files():
        t = read(f)
        for m in re.finditer(r'^\s*(\w+)\([^)]*\)\.then\(', t, re.M):
            tail = t[m.start():m.start() + 400]
            if ".catch(" not in tail:
                line = t[:m.start()].count("\n") + 1
                add("Обещание без обработки ошибки", f"{f}:{line} — {m.group(1)}(...)")


# ---------- вывод ----------
def main():
    check_imports()
    check_dom()
    check_injection()
    check_cycles()
    check_html()
    check_rules()
    check_promises()

    if not problems:
        print("Замечаний нет.")
        return 0

    total = sum(len(v) for v in problems.values())
    print(f"Найдено замечаний: {total}\n")
    for kind in sorted(problems):
        items = problems[kind]
        print(f"[{kind}] — {len(items)}")
        for i in items[:12]:
            print("   ", i)
        if len(items) > 12:
            print(f"    ... и ещё {len(items) - 12}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
