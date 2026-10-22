"""Split a .sql script into individual statements.

Pure text, no adapter imports — the drivers can't do this for us. sqlite3's
``execute`` rejects multi-statement input outright and PyMySQL disallows it by
default, so a script upload has to be sliced up before it reaches them.

Naive ``text.split(";")`` corrupts any script with a semicolon inside a string
literal, a comment, or a Postgres function body, so this scans character by
character and only splits on semicolons found at the top level.
"""

# Postgres/MySQL identifier chars that may appear in a $tag$ dollar-quote tag
_TAG_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")


def _read_dollar_tag(text: str, i: int) -> str | None:
    """If a dollar-quote opener starts at ``i``, return it (e.g. ``$$``, ``$fn$``).

    Returns None when the ``$`` is just a plain character (``$1`` placeholders,
    money literals) rather than the start of a quote.
    """
    j = i + 1
    while j < len(text) and text[j] in _TAG_CHARS:
        j += 1
    if j < len(text) and text[j] == "$":
        return text[i:j + 1]
    return None


def _at_line_start(buf: list[str]) -> bool:
    """True when only whitespace has been emitted since the last newline."""
    for chunk in reversed(buf):
        for ch in reversed(chunk):
            if ch == "\n":
                return True
            if not ch.isspace():
                return False
    return True


def _is_blank(stmt: str) -> bool:
    """True when a chunk holds no executable SQL — only whitespace/comments.

    A trailing ``-- done`` after the last semicolon would otherwise be sent to
    the driver as a statement and come back as a syntax error.
    """
    i = 0
    n = len(stmt)
    while i < n:
        c = stmt[i]
        if c.isspace():
            i += 1
        elif stmt.startswith("--", i) or c == "#":
            nl = stmt.find("\n", i)
            if nl == -1:
                return True
            i = nl + 1
        elif stmt.startswith("/*", i):
            end = stmt.find("*/", i + 2)
            if end == -1:
                return True
            i = end + 2
        else:
            return False
    return True


def split_statements(text: str) -> list[str]:
    """Split ``text`` on top-level semicolons.

    Understands single/double-quoted strings (with doubled-quote escapes and
    backslash escapes), MySQL backtick identifiers, ``--``/``#`` line comments,
    ``/* */`` block comments, and Postgres dollar-quoted bodies. Blank and
    comment-only chunks are dropped; a final statement without a trailing
    semicolon is kept.
    """
    statements: list[str] = []
    buf: list[str] = []
    i = 0
    n = len(text)

    while i < n:
        c = text[i]

        # ── comments ──────────────────────────────────────────────────────────
        # `#` is only honoured at the start of a line (mysqldump style) — mid-line
        # it is a legitimate Postgres operator character, not a comment.
        if text.startswith("--", i) or (c == "#" and _at_line_start(buf)):
            nl = text.find("\n", i)
            end = n if nl == -1 else nl + 1
            buf.append(text[i:end])
            i = end
            continue

        if text.startswith("/*", i):
            close = text.find("*/", i + 2)
            end = n if close == -1 else close + 2
            buf.append(text[i:end])
            i = end
            continue

        # ── quoted spans ──────────────────────────────────────────────────────
        if c in ("'", '"', "`"):
            quote = c
            buf.append(c)
            i += 1
            while i < n:
                ch = text[i]
                if ch == "\\" and quote != "`" and i + 1 < n:
                    # MySQL-style backslash escape; Postgres treats it literally
                    # but consuming both chars is harmless either way.
                    buf.append(text[i:i + 2])
                    i += 2
                    continue
                if ch == quote:
                    if i + 1 < n and text[i + 1] == quote:  # doubled → literal
                        buf.append(ch * 2)
                        i += 2
                        continue
                    buf.append(ch)
                    i += 1
                    break
                buf.append(ch)
                i += 1
            continue

        if c == "$":
            tag = _read_dollar_tag(text, i)
            if tag:
                close = text.find(tag, i + len(tag))
                end = n if close == -1 else close + len(tag)
                buf.append(text[i:end])
                i = end
                continue

        # ── the split point ───────────────────────────────────────────────────
        if c == ";":
            statements.append("".join(buf))
            buf = []
            i += 1
            continue

        buf.append(c)
        i += 1

    statements.append("".join(buf))

    return [s.strip() for s in statements if not _is_blank(s)]
