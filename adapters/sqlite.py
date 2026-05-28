import re
import sqlite3
from .base import BaseAdapter
from .filters import build_where


def _sqlite_regexp(pattern, value):
    if value is None or pattern is None:
        return 0
    try:
        return 1 if re.search(pattern, str(value)) else 0
    except re.error:
        return 0


class SQLiteAdapter(BaseAdapter):

    def connect(self):
        self._conn = sqlite3.connect(self.config["path"])
        self._conn.row_factory = sqlite3.Row
        self._conn.create_function("REGEXP", 2, _sqlite_regexp)

    def disconnect(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    def list_tables(self) -> list[str]:
        cur = self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        )
        return [row[0] for row in cur.fetchall()]

    def get_schema(self, table: str) -> list[dict]:
        cur = self._conn.execute(f'PRAGMA table_info("{table}")')
        return [
            {
                "name": row["name"],
                "type": row["type"] or "TEXT",
                "nullable": row["notnull"] == 0,
                "primary_key": row["pk"] > 0,
            }
            for row in cur.fetchall()
        ]

    def get_rows(self, table, page=1, page_size=50, filters=None, sort=None):
        where_clause, params = self._build_where(filters)
        order_clause = self._build_order(sort)
        offset = (page - 1) * page_size

        total_cur = self._conn.execute(
            f'SELECT COUNT(*) FROM "{table}" {where_clause}', params
        )
        total = total_cur.fetchone()[0]

        cur = self._conn.execute(
            f'SELECT * FROM "{table}" {where_clause} {order_clause} LIMIT ? OFFSET ?',
            params + [page_size, offset],
        )
        columns = [d[0] for d in cur.description] if cur.description else []
        rows = [list(r) for r in cur.fetchall()]

        return {
            "columns": columns,
            "rows": rows,
            "total": total,
            "page": page,
            "page_size": page_size,
            "has_next": (offset + page_size) < total,
        }

    def execute_query(self, query_str: str) -> dict:
        try:
            cur = self._conn.execute(query_str)
            if cur.description:
                columns = [d[0] for d in cur.description]
                rows = [list(r) for r in cur.fetchall()]
                self._conn.rollback()
                return {"columns": columns, "rows": rows, "affected": None, "error": None}
            else:
                affected = cur.rowcount
                self._conn.commit()
                return {"columns": [], "rows": [], "affected": affected, "error": None}
        except Exception as e:
            return {"columns": [], "rows": [], "affected": None, "error": str(e)}

    def update_row(self, table: str, identity: dict, new_values: dict) -> dict:
        if not identity:
            return {"ok": False, "error": "No identity columns — cannot locate row."}
        if not new_values:
            return {"ok": False, "error": "No changes."}
        set_cols = list(new_values.keys())
        set_sql = ", ".join(f'"{c}" = ?' for c in set_cols)
        set_params = [None if v == "__NULL__" else v for v in new_values.values()]
        where_cols = list(identity.keys())
        where_sql = " AND ".join(f'"{c}" = ?' for c in where_cols)
        where_params = list(identity.values())
        try:
            cur = self._conn.execute(
                f'UPDATE "{table}" SET {set_sql} WHERE {where_sql}',
                set_params + where_params,
            )
            self._conn.commit()
            if cur.rowcount == 0:
                return {"ok": False, "error": "No matching row."}
            return {"ok": True, "error": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def insert_row(self, table: str, values: dict) -> dict:
        provided = {k: v for k, v in values.items() if v != ""}
        if not provided:
            return {"ok": False, "error": "No values provided."}
        cols = list(provided.keys())
        col_sql = ", ".join(f'"{c}"' for c in cols)
        placeholders = ", ".join(["?"] * len(cols))
        params = [None if v == "__NULL__" else v for v in provided.values()]
        try:
            self._conn.execute(
                f'INSERT INTO "{table}" ({col_sql}) VALUES ({placeholders})',
                params,
            )
            self._conn.commit()
            return {"ok": True, "error": None}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def get_erd_data(self) -> dict:
        table_names = self.list_tables()
        tables: dict = {}

        for tname in table_names:
            # Columns via PRAGMA table_info
            cur = self._conn.execute(f'PRAGMA table_info("{tname}")')
            columns = [
                {
                    "name": row["name"],
                    "type": row["type"] or "TEXT",
                    "primary_key": row["pk"] > 0,
                    "nullable": row["notnull"] == 0,
                }
                for row in cur.fetchall()
            ]

            # FKs via PRAGMA foreign_key_list
            fk_cur = self._conn.execute(f'PRAGMA foreign_key_list("{tname}")')
            foreign_keys = [
                {
                    "column":     row["from"],
                    "ref_table":  row["table"],
                    "ref_column": row["to"] or "rowid",
                }
                for row in fk_cur.fetchall()
            ]

            tables[tname] = {"columns": columns, "foreign_keys": foreign_keys}

        has_relations = any(t["foreign_keys"] for t in tables.values())
        return {"tables": tables, "has_relations": has_relations}

    def _build_where(self, filters):
        return build_where(
            filters,
            placeholder="?",
            quote_char='"',
            regex_op="REGEXP",
            not_regex_op="NOT REGEXP",
            ilike_supported=False,
        )

    def _build_order(self, sort):
        if not sort or not sort.get("column"):
            return ""
        direction = "DESC" if str(sort.get("dir", "")).lower() == "desc" else "ASC"
        col = sort["column"].replace('"', '""')
        return f'ORDER BY "{col}" {direction}'
