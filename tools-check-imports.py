import re, os

files = sorted(f for f in os.listdir('.') if f.endswith('.js'))

# что каждый модуль экспортирует
exports = {}
for f in files:
    t = open(f, encoding='utf-8').read()
    n = set()
    for m in re.finditer(r'export\s+(?:async\s+)?function\s+(\w+)', t): n.add(m.group(1))
    for m in re.finditer(r'export\s+(?:const|let|var)\s+(\w+)', t): n.add(m.group(1))
    for m in re.finditer(r'export\s*\{([^}]+)\}', t):
        for x in m.group(1).split(','):
            p = [y.strip() for y in x.split(' as ')]
            nm = p[-1] if len(p) > 1 else p[0]
            if nm: n.add(nm)
    exports[f] = n

# карта: имя -> откуда его можно импортировать
owner = {}
for f, names in exports.items():
    for n in names:
        owner.setdefault(n, []).append(f)

BUILTINS = set('''console document window localStorage sessionStorage location navigator
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame
Promise Object Array String Number Boolean Math JSON Date Set Map WeakMap Error RegExp
fetch FormData FileReader File Blob URL Image Audio Intl parseInt parseFloat isNaN
IntersectionObserver MutationObserver CustomEvent Event indexedDB structuredClone
encodeURIComponent decodeURIComponent alert confirm prompt getComputedStyle
createImageBitmap AbortController TextEncoder TextDecoder crypto performance'''.split())

problems = []
for f in files:
    t = open(f, encoding='utf-8').read()

    # что импортировано в этом файле
    imported = set()
    for m in re.finditer(r'import\s*\{([^}]+)\}\s*from', t):
        for x in m.group(1).split(','):
            p = [y.strip() for y in x.split(' as ')]
            imported.add(p[-1] if len(p) > 1 else p[0])
    for m in re.finditer(r'import\s+(\w+)\s+from', t):
        imported.add(m.group(1))
    # динамические:  const { a, b } = await import("./x.js")
    for m in re.finditer(r'\{([^}]+)\}\s*=\s*await\s+import\(', t):
        for x in m.group(1).split(','):
            p = [y.strip() for y in x.split(':')]
            imported.add(p[-1] if len(p) > 1 else p[0])

    # что объявлено локально
    local = set()
    for pat in [r'(?:async\s+)?function\s+(\w+)', r'(?:const|let|var)\s+(\w+)',
                r'class\s+(\w+)', r'export\s+(?:const|let|var)\s+(\w+)']:
        for m in re.finditer(pat, t): local.add(m.group(1))
    # параметры функций и деструктуризация — грубо, но достаточно
    for m in re.finditer(r'\(([^)]*)\)\s*(?:=>|\{)', t):
        for part in m.group(1).split(','):
            w = re.match(r'\s*(?:\.\.\.)?(\w+)', part)
            if w: local.add(w.group(1))
    for m in re.finditer(r'\{([^}]*)\}\s*=', t):
        for part in m.group(1).split(','):
            w = re.match(r'\s*(\w+)', part)
            if w: local.add(w.group(1))
    for m in re.finditer(r'for\s*\(\s*(?:const|let|var)\s+(?:\[)?([\w,\s]+)', t):
        for w in re.split(r'[,\s]+', m.group(1)):
            if w: local.add(w)

    # комментарии и строковые литералы не код — иначе слово в пояснении
    # засчитывалось бы как вызов функции
    code = re.sub(r'//[^\n]*', '', t)
    code = re.sub(r'/\*.*?\*/', '', code, flags=re.S)
    code = re.sub(r'`(?:[^`\\]|\\.)*`', '``', code)
    code = re.sub(r'"(?:[^"\\]|\\.)*"', '""', code)
    code = re.sub(r"'(?:[^'\\]|\\.)*'", "''", code)

    # ищем вызовы функций
    for m in re.finditer(r'(?<![.\w$])([a-z][A-Za-z0-9_]*)\s*\(', code):
        name = m.group(1)
        if name in BUILTINS or name in imported or name in local: continue
        if name in ('if','for','while','switch','catch','return','typeof','function','await','new','import'): continue
        if name in owner:
            problems.append(f"{f}: используется '{name}', но не импортировано "
                            f"(экспортируется в {', '.join(owner[name])})")

print("\n".join(sorted(set(problems))) if problems else "ВСЁ ИМПОРТИРОВАНО КОРРЕКТНО")
