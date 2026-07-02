"""MCP server exposing db-viewr's saved database connections as LLM tools.

Runs over stdio: `uv run mcp_server.py`. Reads the same connections.json as
the Flask app; the app does not need to be running.

stdout is the JSON-RPC transport — never print() in this module.
"""
import time
from typing import Any, Callable

from mcp.server.fastmcp import FastMCP

from adapters import get_adapter
from adapters.base import BaseAdapter
from storage import connection_public, load_connections

# The Flask UI keeps mongodb `uri` visible (it is the connection form value),
# but a URI embeds credentials — redact it from LLM-facing output.
SECRET_FIELDS = ("password", "secret_access_key", "uri")

MAX_PAGE_SIZE = 200
MAX_CELL_CHARS = 1000

mcp = FastMCP(
    "db-viewr",
    instructions=(
        "Tools for querying the user's saved database connections "
        "(PostgreSQL, MySQL, SQLite, MongoDB, DynamoDB). Call list_connections "
        "first to get connection ids and each connection's db_type; the query "
        "dialect for run_query depends on db_type (see its description)."
    ),
)


def _json_cell(value: Any) -> Any:
    """Coerce a result cell to a JSON-safe type.

    Drivers hand back datetime/Decimal/memoryview/bytes cells; the Flask app
    leans on jsonify for these, here we stringify deterministically.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        if isinstance(value, str) and len(value) > MAX_CELL_CHARS:
            return value[:MAX_CELL_CHARS] + "... [truncated]"
        return value
    text = str(value)
    if len(text) > MAX_CELL_CHARS:
        return text[:MAX_CELL_CHARS] + "... [truncated]"
    return text


def _json_rows(rows: list) -> list:
    return [[_json_cell(cell) for cell in row] for row in rows]


def _with_adapter(connection_id: str, fn: Callable[[BaseAdapter, dict], dict]) -> dict:
    conns = load_connections()
    if connection_id not in conns:
        return {
            "error": f"Unknown connection id {connection_id!r}. "
            "Call list_connections to see valid ids."
        }
    conn = conns[connection_id]
    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            return fn(adapter, conn)
        finally:
            adapter.disconnect()
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def list_connections() -> dict:
    """List the user's saved database connections.

    Always call this first: every other tool takes the `id` returned here as
    `connection_id`, and the connection's `db_type` determines which query
    dialect run_query expects. Secrets (passwords, URIs, access keys) are
    redacted.
    """
    conns = load_connections()
    return {
        "connections": [connection_public(c, SECRET_FIELDS) for c in conns.values()]
    }


@mcp.tool()
def test_connection(connection_id: str) -> dict:
    """Check that a connection can be established. Returns {ok, error}."""
    conns = load_connections()
    if connection_id not in conns:
        return {
            "ok": False,
            "error": f"Unknown connection id {connection_id!r}. "
            "Call list_connections to see valid ids.",
        }
    try:
        adapter = get_adapter(conns[connection_id])
    except Exception as e:
        return {"ok": False, "error": str(e)}
    ok, err = adapter.test_connection()
    return {"ok": ok, "error": err or None}


@mcp.tool()
def list_tables(connection_id: str) -> dict:
    """List tables (SQL) or collections (MongoDB) / tables (DynamoDB) on a connection."""
    return _with_adapter(
        connection_id, lambda adapter, conn: {"tables": adapter.list_tables()}
    )


@mcp.tool()
def get_table_schema(connection_id: str, table: str) -> dict:
    """Get the column definitions of a table.

    Returns columns with name, type, nullable, primary_key. Notes: MongoDB
    schemas are inferred by sampling documents; DynamoDB only reports key
    attributes (items are schemaless beyond the key).
    """
    return _with_adapter(
        connection_id, lambda adapter, conn: {"columns": adapter.get_schema(table)}
    )


@mcp.tool()
def get_table_rows(
    connection_id: str, table: str, page: int = 1, page_size: int = 50
) -> dict:
    """Browse rows of a table/collection with pagination (works on every db_type).

    No query language needed — use this for a quick look at data. For
    filtering, joins, or aggregation use run_query. page_size is capped at 200.
    Returns {columns, rows, total, page, page_size, has_next}; total is null
    when counting is too expensive (DynamoDB).
    """
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)

    def go(adapter: BaseAdapter, conn: dict) -> dict:
        result = adapter.get_rows(table, page=page, page_size=page_size)
        result["rows"] = _json_rows(result["rows"])
        return result

    return _with_adapter(connection_id, go)


@mcp.tool()
def run_query(connection_id: str, query: str, max_rows: int = 100) -> dict:
    """Run a query against a connection. The dialect depends on the connection's db_type:

    - postgresql / mysql / sqlite: plain SQL. Statements that return rows
      (e.g. SELECT) are always ROLLED BACK, so `INSERT/UPDATE/DELETE ...
      RETURNING` will NOT persist — use plain INSERT/UPDATE/DELETE (they
      commit and report `affected`). Prefer LIMIT on large tables.
    - mongodb: a JSON string. A JSON object is a find() filter and MUST
      include a "__collection__" key naming the collection, e.g.
      '{"__collection__": "users", "age": {"$gt": 30}}' (without it an
      arbitrary collection is used). A JSON array is an aggregation pipeline
      but always runs on the first collection — prefer object filters.
      find() results are capped at 500 documents.
    - dynamodb: a PartiQL statement, e.g. `SELECT * FROM "table" WHERE pk='x'`.

    Query errors come back in the `error` field. Result rows are truncated to
    max_rows (`truncated` is true and `row_count` holds the full count).
    """
    max_rows = max(1, max_rows)

    def go(adapter: BaseAdapter, conn: dict) -> dict:
        start = time.monotonic()
        result = adapter.execute_query(query)
        elapsed_ms = round((time.monotonic() - start) * 1000, 1)
        rows = result.get("rows") or []
        return {
            "columns": result.get("columns") or [],
            "rows": _json_rows(rows[:max_rows]),
            "row_count": len(rows),
            "truncated": len(rows) > max_rows,
            "affected": result.get("affected"),
            "error": result.get("error"),
            "elapsed_ms": elapsed_ms,
        }

    return _with_adapter(connection_id, go)


@mcp.tool()
def get_erd(connection_id: str) -> dict:
    """Get the full schema graph: every table's columns plus foreign-key relations.

    Useful for understanding how tables relate before writing joins. Output
    scales with schema size — on large databases prefer list_tables +
    get_table_schema. MongoDB infers this by sampling each collection (can be
    slow); MongoDB/DynamoDB report no relations.
    """
    return _with_adapter(
        connection_id, lambda adapter, conn: adapter.get_erd_data()
    )


if __name__ == "__main__":
    mcp.run()
