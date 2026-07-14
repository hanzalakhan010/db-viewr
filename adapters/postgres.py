import psycopg2
import psycopg2.extras
from .base import BaseAdapter
from .filters import build_where


class PostgresAdapter(BaseAdapter):

    def connect(self, readonly: bool = False):
        kwargs = {}
        if readonly:
            kwargs["connect_timeout"] = 10
        self._conn = psycopg2.connect(
            host=self.config["host"],
            port=int(self.config.get("port", 5432)),
            dbname=self.config["database"],
            user=self.config["user"],
            password=self.config["password"],
            **kwargs,
        )
        self._readonly = readonly
        self._conn.autocommit = False
        if readonly:
            try:
                self._conn.set_session(readonly=True)
            except Exception:
                self._conn.close()
                self._conn = None
                raise

    def disconnect(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    def list_tables(self) -> list[str]:
        schema = self.config.get("schema", "public")
        sql = """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = %s
            ORDER BY table_name
        """
        with self._conn.cursor() as cur:
            cur.execute(sql, (schema,))
            return [row[0] for row in cur.fetchall()]

    def get_schema(self, table: str) -> list[dict]:
        schema = self.config.get("schema", "public")
        sql = """
            SELECT
                c.column_name,
                c.data_type,
                c.is_nullable,
                CASE WHEN pk.column_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_pk
            FROM information_schema.columns c
            LEFT JOIN (
                SELECT ku.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage ku
                  ON tc.constraint_name = ku.constraint_name
                 AND tc.table_schema = ku.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_name = %s
                  AND tc.table_schema = %s
            ) pk ON c.column_name = pk.column_name
            WHERE c.table_name = %s
              AND c.table_schema = %s
            ORDER BY c.ordinal_position
        """
        with self._conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(sql, (table, schema, table, schema))
            return [
                {
                    "name": row["column_name"],
                    "type": row["data_type"],
                    "nullable": row["is_nullable"] == "YES",
                    "primary_key": bool(row["is_pk"]),
                }
                for row in cur.fetchall()
            ]

    def get_rows(self, table, page=1, page_size=50, filters=None, sort=None):
        offset = (page - 1) * page_size
        where_clause, params = self._build_where(filters)
        order_clause = self._build_order(sort)

        with self._conn.cursor() as cur:
            cur.execute(f'SELECT COUNT(*) FROM "{table}" {where_clause}', params)
            total = cur.fetchone()[0]

            cur.execute(
                f'SELECT * FROM "{table}" {where_clause} {order_clause} LIMIT %s OFFSET %s',
                params + [page_size, offset],
            )
            columns = [d[0] for d in cur.description] if cur.description else []
            rows = [list(row) for row in cur.fetchall()]

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
            with self._conn.cursor() as cur:
                cur.execute(query_str)
                if cur.description:
                    columns = [d[0] for d in cur.description]
                    rows = [list(r) for r in cur.fetchall()]
                    self._conn.rollback()
                    return {"columns": columns, "rows": rows, "affected": None, "error": None}
                else:
                    affected = cur.rowcount
                    if getattr(self, "_readonly", False):
                        # Belt-and-braces: a readonly session must never commit,
                        # even if a multi-statement query changed session defaults.
                        self._conn.rollback()
                    else:
                        self._conn.commit()
                    return {"columns": [], "rows": [], "affected": affected, "error": None}
        except Exception as e:
            self._conn.rollback()
            return {"columns": [], "rows": [], "affected": None, "error": str(e)}

    def update_row(self, table: str, identity: dict, new_values: dict) -> dict:
        if not identity:
            return {"ok": False, "error": "No identity columns — cannot locate row."}
        if not new_values:
            return {"ok": False, "error": "No changes."}
        set_cols = list(new_values.keys())
        set_sql = ", ".join(f'"{c}" = %s' for c in set_cols)
        set_params = [None if v == "__NULL__" else v for v in new_values.values()]
        where_cols = list(identity.keys())
        where_sql = " AND ".join(f'"{c}" = %s' for c in where_cols)
        where_params = list(identity.values())
        try:
            with self._conn.cursor() as cur:
                cur.execute(
                    f'UPDATE "{table}" SET {set_sql} WHERE {where_sql}',
                    set_params + where_params,
                )
                affected = cur.rowcount
                self._conn.commit()
            if affected == 0:
                return {"ok": False, "error": "No matching row."}
            return {"ok": True, "error": None}
        except Exception as e:
            self._conn.rollback()
            return {"ok": False, "error": str(e)}

    def insert_row(self, table: str, values: dict) -> dict:
        provided = {k: v for k, v in values.items() if v != ""}
        if not provided:
            return {"ok": False, "error": "No values provided."}
        cols = list(provided.keys())
        col_sql = ", ".join(f'"{c}"' for c in cols)
        placeholders = ", ".join(["%s"] * len(cols))
        params = [None if v == "__NULL__" else v for v in provided.values()]
        try:
            with self._conn.cursor() as cur:
                cur.execute(
                    f'INSERT INTO "{table}" ({col_sql}) VALUES ({placeholders})',
                    params,
                )
                self._conn.commit()
            return {"ok": True, "error": None}
        except Exception as e:
            self._conn.rollback()
            return {"ok": False, "error": str(e)}

    def get_erd_data(self) -> dict:
        schema = self.config.get("schema", "public")

        # ── All columns for all base tables in one query ──────────────────────
        col_sql = """
            SELECT
                c.table_name,
                c.column_name,
                c.data_type,
                c.is_nullable,
                c.ordinal_position,
                CASE WHEN pk.column_name IS NOT NULL THEN TRUE ELSE FALSE END AS is_pk
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_name   = c.table_name
             AND t.table_schema = c.table_schema
             AND t.table_type   = 'BASE TABLE'
            LEFT JOIN (
                SELECT kcu.table_name, kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema    = kcu.table_schema
                WHERE tc.constraint_type = 'PRIMARY KEY'
                  AND tc.table_schema   = %s
            ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
            WHERE c.table_schema = %s
            ORDER BY c.table_name, c.ordinal_position
        """

        # ── All FK relationships in one query ─────────────────────────────────
        fk_sql = """
            SELECT
                kcu.table_name  AS from_table,
                kcu.column_name AS from_col,
                ccu.table_name  AS to_table,
                ccu.column_name AS to_col
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema    = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema    = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema    = %s
        """

        tables: dict = {}
        with self._conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(col_sql, (schema, schema))
            for row in cur.fetchall():
                tname = row["table_name"]
                if tname not in tables:
                    tables[tname] = {"columns": [], "foreign_keys": []}
                tables[tname]["columns"].append({
                    "name": row["column_name"],
                    "type": row["data_type"],
                    "primary_key": bool(row["is_pk"]),
                    "nullable": row["is_nullable"] == "YES",
                })

            cur.execute(fk_sql, (schema,))
            fk_rows = cur.fetchall()

        for row in fk_rows:
            if row["from_table"] in tables:
                tables[row["from_table"]]["foreign_keys"].append({
                    "column":    row["from_col"],
                    "ref_table": row["to_table"],
                    "ref_column": row["to_col"],
                })

        return {"tables": tables, "has_relations": bool(fk_rows)}

    def _build_where(self, filters):
        return build_where(
            filters,
            placeholder="%s",
            quote_char='"',
            regex_op="~",
            not_regex_op="!~",
            ilike_supported=True,
        )

    def _build_order(self, sort):
        if not sort or not sort.get("column"):
            return ""
        direction = "DESC" if str(sort.get("dir", "")).lower() == "desc" else "ASC"
        col = sort["column"].replace('"', '""')
        return f'ORDER BY "{col}" {direction}'
