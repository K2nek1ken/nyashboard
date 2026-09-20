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


# ---------- 8. осиротевшие имена после разделения файлов ----------
def check_orphans():
    """
    Когда часть файла выносят в отдельный модуль, легко забыть переменную
    или константу, которой он пользовался: синтаксис остаётся верным,
    импорты сходятся, а при запуске — «is not defined».

    Ищем имена, объявленные в одном файле и используемые в другом
    без импорта.
    """
    declared = {}
    for f in js_files():
        t = read(f)
        # Считаем и переменные, и функции: при выносе части файла забыть
        # можно и то, и другое, а падает одинаково — «is not defined».
        for m in re.finditer(r'^(?:export\s+)?(?:let|const)\s+([A-Za-z_]\w*)\s*=', t, re.M):
            declared.setdefault(m.group(1), set()).add(f)
        for m in re.finditer(r'^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_]\w*)', t, re.M):
            declared.setdefault(m.group(1), set()).add(f)

    for f in js_files():
        t = read(f)

        # Пути импортов и строки убираем: «./channels.js» иначе читается как
        # использование переменной channels, и таких совпадений больше,
        # чем настоящих находок.
        t = re.sub(r'["\'][^"\'\n]*["\']', '""', t)
        # Шаблонные строки тоже: в них лежит разметка, и «data-select» оттуда
        # читалось как использование переменной select.
        t = re.sub(r'`[^`]*`', '""', t)

        local = {m.group(1) for m in re.finditer(r'(?:let|const|var|function|class)\s+([A-Za-z_]\w*)', t)}

        # Имена параметров — тоже свои: без них почти каждый файл выглядел бы
        # как использующий чужие переменные, и настоящие пропажи терялись
        # среди сотни ложных.
        for m in re.finditer(r'(?:function\s*\w*|\))\s*\(([^()]{0,200})\)\s*(?:\{|=>)', t):
            for part in m.group(1).split(","):
                local.add(part.strip().split("=")[0].strip().strip("{}[]. "))
        for m in re.finditer(r'\(([^()]{0,200})\)\s*=>', t):
            for part in m.group(1).split(","):
                local.add(part.strip().split("=")[0].strip().strip("{}[]. "))
        for m in re.finditer(r'\b([a-z]\w*)\s*=>', t):
            local.add(m.group(1))
        for m in re.finditer(r'\{([^{}]{0,200})\}\s*=(?!=)', t):
            for part in m.group(1).split(","):
                local.add(part.strip().split(":")[-1].strip())
        for m in re.finditer(r'catch\s*\((\w+)\)', t):
            local.add(m.group(1))

        # Деструктуризация из списка: const [{ a }, { b }] = await Promise.all(...)
        for m in re.finditer(r'\[([^\[\]]*\{[^\[\]]*\}[^\[\]]*)\]\s*=', t):
            for inner in re.findall(r'\{([^{}]+)\}', m.group(1)):
                for part in inner.split(","):
                    local.add(part.strip().split(":")[-1].strip())
        imported = set()
        for m in re.finditer(r'import\s*\{([^}]+)\}', t):
            for part in m.group(1).split(","):
                imported.add(part.strip().split(" as ")[-1].strip())

        for name, owners in declared.items():
            if f in owners or name in local or name in imported:
                continue
            # используется как самостоятельное имя, а не как свойство
            if re.search(rf'(?<![.\w$"\'])\b{re.escape(name)}\b\s*[(.\[=]', t):
                add("Имя из другого файла без импорта", f"{f}: {name} (объявлено в {', '.join(sorted(owners))})")


# ---------- 9. вызов несуществующей функции ----------
def check_missing_calls():
    """
    Самое коварное: функция вызывается, но её нет — ни своей, ни импортированной.
    Проверка синтаксиса это пропускает, импорты сходятся, а при запуске код
    падает. Если это происходит внутри подписки на данные, ошибку никто
    не видит: страница просто остаётся пустой.
    """
    builtins = {
        "if", "for", "while", "switch", "catch", "return", "typeof", "await", "new",
        "delete", "void", "in", "of", "else", "try", "do", "case", "function", "class",
        "const", "let", "var", "this", "null", "true", "false", "async", "import",
        "export", "yield", "super", "instanceof",
        "Set", "Map", "Math", "Date", "String", "Number", "Object", "Array", "JSON",
        "RegExp", "Promise", "Error", "Boolean", "Image", "Audio", "Blob", "File",
        "FileReader", "FormData", "URL", "Event", "CustomEvent", "DOMParser",
        "TextEncoder", "TextDecoder", "Response", "Request", "Headers", "AbortController",
        "IntersectionObserver", "ResizeObserver", "MutationObserver", "DecompressionStream",
        "HTMLCanvasElement", "Notification", "WeakMap", "WeakSet", "Proxy", "Reflect",
        "BigInt", "Symbol", "Intl", "structuredClone", "queueMicrotask",
        # функции окружения, доступные без объявления
        "setTimeout", "setInterval", "clearTimeout", "clearInterval",
        "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle",
        "matchMedia", "fetch", "parseInt", "parseFloat", "isNaN", "isFinite",
        "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
        "alert", "confirm", "prompt", "atob", "btoa",
        "Uint8Array", "Uint16Array", "Uint32Array", "Int8Array", "Int16Array",
        "Int32Array", "Float32Array", "Float64Array", "ArrayBuffer", "DataView",
        "URLSearchParams", "AudioContext", "MediaMetadata", "Worker",
        "IDBKeyRange", "indexedDB", "crypto", "performance",
    }

    for f in js_files():
        t = read(f)
        code = re.sub(r'//[^\n]*', '', t)
        code = re.sub(r'/\*[\s\S]*?\*/', '', code)
        code = re.sub(r'`[^`]*`', '""', code)
        code = re.sub(r'["\'][^"\'\n]*["\']', '""', code)

        known = set()
        for m in re.finditer(r'import\s*\{([^}]+)\}', code):
            for part in m.group(1).split(","):
                known.add(part.strip().split(" as ")[-1].strip())
        for m in re.finditer(r'\{([^{}]+)\}\s*=\s*await\s+import', code):
            for part in m.group(1).split(","):
                known.add(part.strip())
        for m in re.finditer(r'import\([^)]+\)\s*\.then\(\s*\(?\{([^}]+)\}', code):
            for part in m.group(1).split(","):
                known.add(part.strip())
        for m in re.finditer(r'\[([^\[\]]*\{[^\[\]]*\}[^\[\]]*)\]\s*=', code):
            for inner in re.findall(r'\{([^{}]+)\}', m.group(1)):
                for part in inner.split(","):
                    known.add(part.strip().split(":")[-1].strip())

        for m in re.finditer(r'(?:function|class)\s+([A-Za-z_]\w*)', code):
            known.add(m.group(1))
        for m in re.finditer(r'(?:const|let|var)\s+([A-Za-z_]\w*)', code):
            known.add(m.group(1))
        # параметры и деструктуризация
        for m in re.finditer(r'\(([^()]{0,200})\)\s*(?:=>|\{)', code):
            for part in m.group(1).split(","):
                known.add(part.strip().split("=")[0].strip().strip("{}[]. "))
        for m in re.finditer(r'\b([a-z]\w*)\s*=>', code):
            known.add(m.group(1))
        for m in re.finditer(r'\{([^{}]{0,200})\}\s*=(?!=)', code):
            for part in m.group(1).split(","):
                known.add(part.strip().split(":")[-1].strip())

        for m in re.finditer(r'(?<![.\w$])([a-zA-Z_]\w{2,})\s*\(', code):
            name = m.group(1)
            if name in known or name in builtins:
                continue
            line = code[:m.start()].count("\n") + 1
            add("Вызов несуществующей функции", f"{f}:{line} — {name}()")


# ---------- 10. повторяющиеся действия в скриптах ----------
def check_script_dupes():
    """
    В скриптах публикации легко оставить два блока, делающих одно и то же:
    один дописали сверху, второй остался снизу. На глаз это незаметно,
    а выполняется дважды.
    """
    import glob
    for path in sorted(glob.glob(os.path.join(ROOT, "*.sh"))):
        name = os.path.basename(path)
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()

        # команды, которые не должны встречаться дважды
        # Только то, что осмысленно делать один раз за запуск. Распаковку
        # и чтение из архива сюда не берём: их бывает несколько, и это
        # нормально — заглянуть в архив, потом распаковать.
        watched = ["firebase deploy", "git push", "git commit -m"]
        for cmd in watched:
            hits = [i + 1 for i, l in enumerate(lines)
                    if cmd in l and not l.strip().startswith("#")]
            if len(hits) > 1:
                add("Повтор действия в скрипте",
                    f"{name}: «{cmd}» на строках {', '.join(map(str, hits))}")


# ---------- 11. описание возможностей отстало от проекта ----------
def check_about():
    """
    Вкладка «Возможности» — единственное место, где человек узнаёт, что
    умеет сайт. Она легко отстаёт: возможность добавили, а написать о ней
    забыли, и заметить это может только тот, кто помнит весь проект.

    Проверяем две вещи, которые ловятся надёжно:
      — появился целый модуль, а в описании о нём ни слова;
      — добавилась команда бота, обращающаяся к базе (то есть заметная),
        и о ней тоже молчок.

    Остальное — тексты, и проверить их машиной не выйдет.
    """
    about_path = os.path.join(ROOT, "js", "about-page.js")
    if not os.path.exists(about_path):
        return
    with open(about_path, encoding="utf-8") as fh:
        about = fh.read().lower()

    # Слева файл, справа — что должно встретиться в описании, если он есть.
    NOTABLE = {
        "casino.js":          ["казик", "казино", "монет"],
        "casino-round.js":    ["ставка", "круг"],
        "roulette-wheel.js":  ["колесо", "рулетк"],
        "custom-commands.js": ["+бот", "свою команду", "свои команды"],
        "video-player.js":    ["видео"],
        "backup.js":          ["архив", "перенос"],
        "reports.js":         ["жалоб"],
        "terms.js":           ["правил"],
        "post-composer.js":   ["редактор", "разметк"],
        "confetti.js":        ["конфетти"],
    }
    for fname, words in NOTABLE.items():
        if not os.path.exists(os.path.join(ROOT, "js", fname)):
            continue
        if not any(w in about for w in words):
            add("Описание: не упомянуто",
                f"{fname} есть в проекте, но в «Возможностях» о нём ни слова")

    # Команды с обращением к базе — это заметные возможности, а не мелочь:
    # кошелёк, игра, история. О таких стоит рассказать.
    cmd_path = os.path.join(ROOT, "js", "modules", "bot-commands.js")
    if os.path.exists(cmd_path):
        with open(cmd_path, encoding="utf-8") as fh:
            cmds_src = fh.read()

        for m in re.finditer(r'cmd:\s*\[([^\]]+)\][^}]*runs:', cmds_src):
            names = [p.strip().strip('"\'') for p in m.group(1).split(",")]
            if not any(n.lower() in about for n in names):
                add("Описание: команда не упомянута",
                    f"«{names[0]}» работает, но в «Возможностях» её нет")


# ---------- вывод ----------
def main():
    check_imports()
    check_dom()
    check_injection()
    check_cycles()
    check_html()
    check_rules()
    check_promises()
    check_orphans()
    check_missing_calls()
    check_script_dupes()
    check_about()

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
