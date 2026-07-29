"""Compiler that turns a saved-view spec into a paginated SELECT with JOINs.

A view spec is dialect-agnostic; the app validates every table/column against
live introspection before calling in here, and passes the adapter's own quote
char + placeholder so the emitted SQL matches the driver. Values are always
parameterised (via ``build_where`` for filters and placeholders for
pagination); identifiers are quoted, never interpolated raw.

Spec shape::

    {
      "base_table": "orders",
      "joins": [
        {"from_table": "orders", "from_col": "customer_id",
         "to_table": "customers", "to_col": "id", "join_type": "left"},
        ...
      ],
      "columns": [{"table": "orders", "column": "id"}, ...],
      "filters": <advanced/simple filter dict, conditions may be table-qualified>,
      "sort": {"table": str, "column": str, "dir": "asc"|"desc"}   # optional
    }
"""

from .filters import _quote, build_where


def _qcol(table: str, col: str, quote_char: str) -> str:
    """Quote a table-qualified column: "table"."column"."""
    return _quote(table, quote_char) + "." + _quote(col, quote_char)


def build_view_query(
    spec: dict,
    *,
    quote_char: str,
    placeholder: str,
    page: int = 1,
    page_size: int = 50,
    filters=None,
):
    """Return ``(sql, params)`` for one page of a view.

    Fetches ``page_size + 1`` rows so the caller can compute an exact
    ``has_next`` without a COUNT over the join (which can be expensive).
    Raises ``ValueError`` for a spec that can't be compiled (e.g. a join that
    doesn't introduce a new table); the caller maps that to a 400.
    """
    base = spec["base_table"]
    joins = spec.get("joins") or []
    columns = spec.get("columns") or []

    # ── SELECT list ──────────────────────────────────────────────────────────
    # Alias every column as "table.column" so same-named columns across joined
    # tables don't clobber each other in the result set.
    if columns:
        select_parts = []
        for c in columns:
            tbl, col = c["table"], c["column"]
            alias = _quote(f"{tbl}.{col}", quote_char)
            select_parts.append(f"{_qcol(tbl, col, quote_char)} AS {alias}")
    else:
        # No explicit selection — fall back to base.* (callers normally pass
        # an explicit column list built from the schema).
        select_parts = [f"{_quote(base, quote_char)}.*"]
    select_sql = ", ".join(select_parts)

    # ── FROM + JOINs ─────────────────────────────────────────────────────────
    # Each join must introduce exactly one new table (the other side is already
    # in the FROM). The builder walks joins in order, tracking what's included.
    from_sql = _quote(base, quote_char)
    included = {base}
    for j in joins:
        ft, tt = j["from_table"], j["to_table"]
        if tt not in included:
            added = tt
        elif ft not in included:
            added = ft
        else:
            raise ValueError(
                f"join between {ft!r} and {tt!r} adds no new table"
            )
        join_type = "LEFT" if str(j.get("join_type", "inner")).lower() == "left" else "INNER"
        on = (
            f'{_qcol(ft, j["from_col"], quote_char)} = '
            f'{_qcol(tt, j["to_col"], quote_char)}'
        )
        from_sql += f" {join_type} JOIN {_quote(added, quote_char)} ON {on}"
        included.add(added)

    # ── WHERE (reuses the filter compiler with table-qualified conditions) ────
    where_sql, params = build_where(
        filters if filters is not None else spec.get("filters"),
        placeholder=placeholder,
        quote_char=quote_char,
    )

    # ── ORDER BY (optional) ──────────────────────────────────────────────────
    order_sql = ""
    sort = spec.get("sort")
    if sort and sort.get("table") and sort.get("column"):
        direction = "DESC" if str(sort.get("dir", "")).lower() == "desc" else "ASC"
        order_sql = f'ORDER BY {_qcol(sort["table"], sort["column"], quote_char)} {direction}'

    # ── Pagination (fetch one extra row for an exact has_next) ────────────────
    offset = max(0, (page - 1)) * page_size
    limit_sql = f"LIMIT {placeholder} OFFSET {placeholder}"
    params = list(params) + [page_size + 1, offset]

    sql = f"SELECT {select_sql} FROM {from_sql} {where_sql} {order_sql} {limit_sql}".strip()
    # Collapse the double spaces left when where/order are empty.
    sql = " ".join(sql.split())
    return sql, params
