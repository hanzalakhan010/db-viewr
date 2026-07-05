import pymysql
import pymysql.cursors
from .base import BaseAdapter
from .filters import build_where
from .pool import POOL


class MySQLAdapter(BaseAdapter):

    def _pool_key(self):
        c = self.config
        return ("mysql", c.get("host"), str(c.get("port", 3306)),
                c.get("database"), c.get("user"), c.get("password"))

    def _open_connection(self):
        return pymysql.connect(
            host=self.config["host"],
            port=int(self.config.get("port", 3306)),
            database=self.config["database"],
            user=self.config["user"],
            password=self.config["password"],
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=False,
            connect_timeout=5,
        )

    @staticmethod
    def _validate(conn):
        try:
            conn.ping(reconnect=False)
            return True
        except Exception:
            return False

    def connect(self):
        self._conn = POOL.acquire(
            self._pool_key(),
            factory=self._open_connection,
            validate=self._validate,
            close=lambda c: c.close(),
        )

    def disconnect(self):
        if self._conn:
            POOL.release(
                self._pool_key(),
                self._conn,
                reset=lambda c: c.rollback(),
                close=lambda c: c.close(),
            )
            self._conn = None

    def list_tables(self) -> list[str]:
        with self._conn.cursor() as cur:
            cur.execute("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
            return [list(row.values())[0] for row in cur.fetchall()]

    def get_schema(self, table: str) -> list[dict]:
        with self._conn.cursor() as cur:
            cur.execute(f"DESCRIBE `{table}`")
            return [
                {
                    "name": row["Field"],
                    "type": row["Type"],
                    "nullable": row["Null"] == "YES",
                    "primary_key": row["Key"] == "PRI",
                }
                for row in cur.fetchall()
            ]

    def get_rows(self, table, page=1, page_size=50, filters=None, sort=None):
        offset = (page - 1) * page_size
        where_clause, params = self._build_where(filters)
        order_clause = self._build_order(sort)

        with self._conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS cnt FROM `{table}` {where_clause}", params)
            total = cur.fetchone()["cnt"]

            cur.execute(
                f"SELECT * FROM `{table}` {where_clause} {order_clause} LIMIT %s OFFSET %s",
                params + [page_size, offset],
            )
            rows_dicts = cur.fetchall()

        if not rows_dicts:
            return {
                "columns": [], "rows": [], "total": total,
                "page": page, "page_size": page_size, "has_next": False,
            }

        columns = list(rows_dicts[0].keys())
        rows = [list(r.values()) for r in rows_dicts]

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
                    rows = [list(r.values()) for r in cur.fetchall()]
                    self._conn.rollback()
                    return {"columns": columns, "rows": rows, "affected": None, "error": None}
                else:
                    affected = cur.rowcount
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
        set_sql = ", ".join(f"`{c}` = %s" for c in set_cols)
        set_params = [None if v == "__NULL__" else v for v in new_values.values()]
        where_cols = list(identity.keys())
        where_sql = " AND ".join(f"`{c}` = %s" for c in where_cols)
        where_params = list(identity.values())
        try:
            with self._conn.cursor() as cur:
                cur.execute(
                    f"UPDATE `{table}` SET {set_sql} WHERE {where_sql}",
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
        col_sql_list = ", ".join(f"`{c}`" for c in cols)
        placeholders = ", ".join(["%s"] * len(cols))
        params = [None if v == "__NULL__" else v for v in provided.values()]
        try:
            with self._conn.cursor() as cur:
                cur.execute(
                    f"INSERT INTO `{table}` ({col_sql_list}) VALUES ({placeholders})",
                    params,
                )
                self._conn.commit()
            return {"ok": True, "error": None}
        except Exception as e:
            self._conn.rollback()
            return {"ok": False, "error": str(e)}

    def get_erd_data(self) -> dict:
        col_sql = """
            SELECT
                c.TABLE_NAME   AS table_name,
                c.COLUMN_NAME  AS column_name,
                c.COLUMN_TYPE  AS data_type,
                c.IS_NULLABLE  AS is_nullable,
                c.ORDINAL_POSITION,
                CASE WHEN c.COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END AS is_pk
            FROM information_schema.COLUMNS c
            JOIN information_schema.TABLES t
              ON t.TABLE_NAME   = c.TABLE_NAME
             AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
             AND t.TABLE_TYPE   = 'BASE TABLE'
            WHERE c.TABLE_SCHEMA = DATABASE()
            ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
        """

        fk_sql = """
            SELECT
                TABLE_NAME             AS from_table,
                COLUMN_NAME            AS from_col,
                REFERENCED_TABLE_NAME  AS to_table,
                REFERENCED_COLUMN_NAME AS to_col
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA             = DATABASE()
              AND REFERENCED_TABLE_NAME IS NOT NULL
        """

        tables: dict = {}
        with self._conn.cursor() as cur:
            cur.execute(col_sql)
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

            cur.execute(fk_sql)
            fk_rows = cur.fetchall()

        for row in fk_rows:
            if row["from_table"] in tables:
                tables[row["from_table"]]["foreign_keys"].append({
                    "column":     row["from_col"],
                    "ref_table":  row["to_table"],
                    "ref_column": row["to_col"],
                })

        return {"tables": tables, "has_relations": bool(fk_rows)}

    def _build_where(self, filters):
        return build_where(
            filters,
            placeholder="%s",
            quote_char="`",
            regex_op="REGEXP",
            not_regex_op="NOT REGEXP",
            ilike_supported=False,
        )

    def _build_order(self, sort):
        if not sort or not sort.get("column"):
            return ""
        direction = "DESC" if str(sort.get("dir", "")).lower() == "desc" else "ASC"
        col = sort["column"].replace("`", "``")
        return f"ORDER BY `{col}` {direction}"
