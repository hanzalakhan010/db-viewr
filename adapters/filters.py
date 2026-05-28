"""Shared SQL WHERE-clause compiler for advanced filters."""


def _quote(name: str, quote_char: str) -> str:
    if quote_char == "`":
        return "`" + name.replace("`", "``") + "`"
    return quote_char + name.replace(quote_char, quote_char * 2) + quote_char


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _normalize(filters):
    """Return (conditions, combinator) or (None, None) if no filter."""
    if not filters:
        return None, None
    if filters.get("advanced"):
        conds = filters.get("conditions") or []
        combinator = (filters.get("combinator") or "AND").upper()
        if combinator not in ("AND", "OR"):
            combinator = "AND"
        return conds, combinator
    if filters.get("column"):
        return [{
            "column": filters["column"],
            "op": filters.get("op", "="),
            "value": filters.get("value", ""),
        }], "AND"
    return None, None


def build_where(
    filters,
    *,
    placeholder: str,
    quote_char: str,
    regex_op: str | None = None,
    not_regex_op: str | None = None,
    ilike_supported: bool = False,
):
    conds, combinator = _normalize(filters)
    if not conds:
        return "", []

    parts: list[str] = []
    params: list = []

    for cond in conds:
        col = (cond.get("column") or "").strip()
        op = (cond.get("op") or "=").lower()
        val = cond.get("value", "")
        val2 = cond.get("value2", "")
        if not col:
            continue
        q = _quote(col, quote_char)

        if op in {"=", "!=", ">", "<", ">=", "<="}:
            parts.append(f"{q} {op} {placeholder}")
            params.append(val)
        elif op == "like":
            parts.append(f"{q} LIKE {placeholder}")
            params.append(val)
        elif op == "not_like":
            parts.append(f"{q} NOT LIKE {placeholder}")
            params.append(val)
        elif op == "ilike":
            if ilike_supported:
                parts.append(f"{q} ILIKE {placeholder}")
            else:
                parts.append(f"LOWER({q}) LIKE LOWER({placeholder})")
            params.append(val)
        elif op == "contains":
            parts.append(f"{q} LIKE {placeholder} ESCAPE '\\'")
            params.append(f"%{_escape_like(val)}%")
        elif op == "not_contains":
            parts.append(f"{q} NOT LIKE {placeholder} ESCAPE '\\'")
            params.append(f"%{_escape_like(val)}%")
        elif op == "starts_with":
            parts.append(f"{q} LIKE {placeholder} ESCAPE '\\'")
            params.append(f"{_escape_like(val)}%")
        elif op == "ends_with":
            parts.append(f"{q} LIKE {placeholder} ESCAPE '\\'")
            params.append(f"%{_escape_like(val)}")
        elif op == "regex":
            if not regex_op:
                continue
            parts.append(f"{q} {regex_op} {placeholder}")
            params.append(val)
        elif op == "not_regex":
            if not not_regex_op:
                continue
            parts.append(f"{q} {not_regex_op} {placeholder}")
            params.append(val)
        elif op == "is_null":
            parts.append(f"{q} IS NULL")
        elif op == "is_not_null":
            parts.append(f"{q} IS NOT NULL")
        elif op in {"in", "not_in"}:
            items = [x.strip() for x in str(val).split(",") if x.strip() != ""]
            if not items:
                continue
            phs = ", ".join([placeholder] * len(items))
            kw = "IN" if op == "in" else "NOT IN"
            parts.append(f"{q} {kw} ({phs})")
            params.extend(items)
        elif op == "between":
            parts.append(f"{q} BETWEEN {placeholder} AND {placeholder}")
            params.append(val)
            params.append(val2)
        # Unknown ops are silently skipped.

    if not parts:
        return "", []
    sep = f" {combinator} "
    return "WHERE " + sep.join(parts), params
