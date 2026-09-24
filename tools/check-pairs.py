#!/usr/bin/env python3
"""
Проверка «родственных» мест.

Одна и та же возможность часто живёт в нескольких файлах сразу: ответы
есть и в ленте, и на отдельной странице записи; чат есть общий и личный.
Поправишь в одном — во втором остаётся по-старому, и заметить это можно
только случайно, открыв ту самую вкладку.

Инструмент знает такие группы и сверяет их по признакам: есть ли вызов,
стоит ли нужный вид поля, обрабатываются ли те же клавиши. Если в одном
месте признак есть, а в родственном нет — скажет.

Что это НЕ проверяет: правильность самой работы. Только то, что
родственные места не разошлись.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(path):
    full = os.path.join(ROOT, path)
    if not os.path.exists(full):
        return None
    with open(full, encoding="utf-8") as fh:
        return fh.read()


# ============================================================
#  Что с чем сверять
#
#  Каждая группа — набор мест, где одна возможность живёт сразу.
#  «signs» — по каким признакам их сверять: имя функции, кусок кода,
#  название класса. Признак ищется как обычный текст.
#
#  Добавляешь возможность в одном месте — впиши её признак сюда,
#  и инструмент проследит, чтобы родственные не отстали.
# ============================================================

GROUPS = [
    {
        # Запись показывается в ленте и на своей отдельной странице.
        # Обе должны жить одинаково: свежее оформление автора, живое
        # обновление, точечная правка карточки.
        "name": "Запись: лента и своя страница",
        "files": ["js/feed.js", "js/post.js"],
        "signs": [
            ("enrichAuthors", "свежее оформление автора"),
            ("patchPostCard", "карточка обновляется точечно"),
            ("onSnapshot", "запись обновляется живьём"),
            ("nyash:managed", "права на записи канала подхватываются на лету"),
        ],
    },
    {
        # Отправка ответа: и в ленте, и на отдельной странице записи.
        "name": "Отправка ответа",
        "files": ["js/feed.js", "js/post.js"],
        "signs": [
            ("currentReplyTarget", "цитата передаётся при отправке"),
            ("clearReplyTarget",   "цитата убирается после отправки"),
            ("e.shiftKey",         "Shift+Enter отправляет"),
            ("scrollHeight",       "поле растёт под текст"),
        ],
    },
    {
        # Показ ответов: в ленте этим занят отдельный модуль,
        # на странице записи — она сама.
        "name": "Показ ответов",
        "files": ["js/post-replies-preview.js", "js/post.js"],
        "signs": [
            ("wireReplyQuotes", "нажатие по цитате работает"),
            ("wireReplyLikes",  "оценки ответов работают"),
        ],
    },
    {
        "name": "Поля ответа в разметке",
        "files": ["index.html", "post.html"],
        "signs": [
            ("<textarea", "поле многострочное"),
        ],
    },
    {
        # Список своего подгружается позже отрисовки — и лента, и чат
        # должны перерисоваться, когда он пришёл, иначе кнопок не будет.
        "name": "Своё: записи и сообщения",
        "files": ["js/feed.js", "js/chat.js"],
        "signs": [
            ("nyash:owned", "перерисовка, когда подъехал список своего"),
        ],
    },
    {
        # Кнопка воспроизведения есть в полосе и в развёрнутом виде.
        # Обе должны показывать то, что происходит на самом деле.
        "name": "Кнопки плеера",
        "files": ["js/player.js"],
        "signs": [
            ("audio && !audio.paused ? ICON.pause : ICON.play",
             "кнопка рисуется по состоянию, а не наугад"),
        ],
    },
    {
        # Живые подписки: если переиспользовать старую при пустых данных,
        # экран остаётся пустым навсегда.
        "name": "Подписки на данные",
        "files": ["js/feed.js", "js/chat.js"],
        "signs": [
            ("= null;\n  }", "подписка пересоздаётся, если показывать нечего"),
        ],
    },
    {
        "name": "Чат: общий и личный",
        "files": ["js/chat.js", "js/dm-page.js"],
        "signs": [
            ("reactToMeow",  "мяуканье"),
            ("just-came",    "появление новых сообщений"),
            ("shownAt",      "отличаем новые от перерисованных"),
            ("e.shiftKey",   "Shift+Enter отправляет"),
            ("invokedByUid", "сообщения бота удаляет тот, кто вызвал"),
        ],
    },
    {
        "name": "Окна: закрытие с анимацией",
        "files": ["js/music-ui.js", "js/art-ui.js", "js/post-composer.js", "js/avatar.js"],
        "signs": [
            ("closeOverlay", "окно уходит плавно"),
        ],
    },
    {
        "name": "Страницы: сбой не рушит остальное",
        "files": [f"js/{n}" for n in sorted(os.listdir(os.path.join(ROOT, "js")))
                  if n.endswith("-page.js")],
        "signs": [
            ("showPageError", "ошибка вкладки видна человеку"),
        ],
    },
]


def main():
    problems = []

    for group in GROUPS:
        present = {}
        for path in group["files"]:
            text = read(path)
            if text is None:
                continue
            present[path] = text

        if len(present) < 2:
            continue

        for sign, what in group["signs"]:
            has = [p for p, t in present.items() if sign in t]
            missing = [p for p in present if p not in has]

            # Признак есть хотя бы в одном месте, но не во всех —
            # значит где-то отстали.
            if has and missing:
                problems.append({
                    "group": group["name"],
                    "what": what,
                    "have": has,
                    "missing": missing,
                })

    if not problems:
        print("РОДСТВЕННЫЕ МЕСТА СОГЛАСОВАНЫ")
        return 0

    print(f"Расхождений: {len(problems)}\n")
    for p in problems:
        print(f"[{p['group']}] {p['what']}")
        print(f"    есть:  {', '.join(os.path.basename(x) for x in p['have'])}")
        print(f"    нет:   {', '.join(os.path.basename(x) for x in p['missing'])}")
        print()

    return 1


if __name__ == "__main__":
    sys.exit(main())
