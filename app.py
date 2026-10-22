import json
import os
import threading
import time
import uuid

from flask import (
    Flask,
    jsonify,
    request,
    send_from_directory,
)

from adapters import get_adapter
from adapters.views import build_view_query
from storage import connection_public, load_connections, save_connections

app = Flask(__name__)

SPA_DIST_DIR = os.path.join(os.path.dirname(__file__), "static", "dist")


@app.route("/")
@app.route("/<path:rest>")
def spa(rest: str = ""):
    """Serve the React SPA at the root.

    Hashed JS/CSS live under /assets/* — served as files. Any other path
    falls back to index.html so client-side routing works on reload.
    Unregistered /api/* paths stay JSON 404s instead of getting index.html.
    """
    if rest == "api" or rest.startswith("api/"):
        return jsonify({"error": "Not found"}), 404
    if rest:
        candidate = os.path.join(SPA_DIST_DIR, rest)
        if os.path.isfile(candidate):
            return send_from_directory(SPA_DIST_DIR, rest)
    index_path = os.path.join(SPA_DIST_DIR, "index.html")
    if not os.path.isfile(index_path):
        return (
            "SPA not built yet. Run `npm run build` in frontend/.",
            503,
        )
    return send_from_directory(SPA_DIST_DIR, "index.html")

# Allow overriding via env var so Docker can mount a persistent data volume
QUERY_HISTORY_FILE = os.environ.get(
    "QUERY_HISTORY_FILE",
    os.path.join(os.path.dirname(__file__), "query_history.json"),
)

SQL_DB_TYPES = {"postgresql", "mysql", "sqlite"}

# ── Connection persistence ─────────────────────────────────────────────────────
# load_connections / save_connections live in storage.py (shared with mcp_server.py)

# ── Query history persistence ─────────────────────────────────────────────────

def load_query_history() -> dict:
    if not os.path.exists(QUERY_HISTORY_FILE):
        return {}
    try:
        with open(QUERY_HISTORY_FILE) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_query_history(history: dict) -> None:
    with open(QUERY_HISTORY_FILE, "w") as f:
        json.dump(history, f, indent=2)


def get_history_for(conn_id: str) -> list:
    return load_query_history().get(conn_id, [])


def append_history(conn_id: str, query: str) -> None:
    query = (query or "").strip()
    if not query:
        return
    history = load_query_history()
    items = history.get(conn_id, [])
    items.insert(0, {"q": query, "t": int(time.time() * 1000)})
    history[conn_id] = items
    save_query_history(history)


# ── Saved views persistence ─────────────────────────────────────────────────────
# A "view" is a stored join spec (base table + FK/PK joins + selected columns +
# filters), not a frozen result set — reopening re-runs it against live data.
# Persisted like query history: a JSON map of {conn_id: [view, ...]}.

VIEWS_FILE = os.environ.get(
    "VIEWS_FILE",
    os.path.join(os.path.dirname(__file__), "views.json"),
)


def load_views() -> dict:
    if not os.path.exists(VIEWS_FILE):
        return {}
    try:
        with open(VIEWS_FILE) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def save_views(views: dict) -> None:
    with open(VIEWS_FILE, "w") as f:
        json.dump(views, f, indent=2)


def get_views_for(conn_id: str) -> list:
    return load_views().get(conn_id, [])


# ── Schema cache ────────────────────────────────────────────────────────────────
# Table schemas rarely change but were re-introspected on every page/sort/filter
# request — an information_schema join per click on remote DBs. Cache briefly.

SCHEMA_CACHE_TTL = 60.0
_schema_cache: dict[tuple[str, str], tuple[float, list]] = {}
_schema_cache_lock = threading.Lock()


def get_schema_cached(conn_id: str, adapter, table: str) -> list[dict]:
    key = (conn_id, table)
    with _schema_cache_lock:
        hit = _schema_cache.get(key)
        if hit and (time.monotonic() - hit[0]) < SCHEMA_CACHE_TTL:
            return hit[1]
    schema = adapter.get_schema(table)
    now = time.monotonic()
    with _schema_cache_lock:
        # Prune expired entries so the cache can't grow unbounded
        for k in [k for k, (ts, _) in _schema_cache.items() if now - ts >= SCHEMA_CACHE_TTL]:
            del _schema_cache[k]
        _schema_cache[key] = (now, schema)
    return schema


def invalidate_schema_cache(conn_id: str) -> None:
    """Drop cached schemas for a connection (after DDL-capable queries or
    connection edits). Also drops the FK graph, which DDL can change."""
    with _schema_cache_lock:
        for key in [k for k in _schema_cache if k[0] == conn_id]:
            del _schema_cache[key]
    with _erd_cache_lock:
        _erd_cache.pop(conn_id, None)


# ── FK-graph (ERD) cache ─────────────────────────────────────────────────────────
# get_erd_data() introspects the whole schema — too heavy to run on every table
# view for the FK links, and the view builder hits it repeatedly. Cache per
# connection with the same TTL as schemas; invalidated together (above).

ERD_CACHE_TTL = 60.0
_erd_cache: dict[str, tuple[float, dict]] = {}
_erd_cache_lock = threading.Lock()


def get_erd_cached(conn_id: str, adapter) -> dict:
    with _erd_cache_lock:
        hit = _erd_cache.get(conn_id)
        if hit and (time.monotonic() - hit[0]) < ERD_CACHE_TTL:
            return hit[1]
    erd = adapter.get_erd_data()
    now = time.monotonic()
    with _erd_cache_lock:
        for k in [k for k, (ts, _) in _erd_cache.items() if now - ts >= ERD_CACHE_TTL]:
            del _erd_cache[k]
        _erd_cache[conn_id] = (now, erd)
    return erd


def _relations_for(erd: dict, table: str) -> dict:
    """Split the FK graph into edges touching `table`.

    outbound: this table's own FKs → {column, ref_table, ref_column}
              (click the FK cell to reach the parent row).
    inbound:  other tables' FKs that point at this table →
              {from_table, from_column, ref_column}
              (jump to children filtered by from_column = this row's ref_column).
    """
    tables = erd.get("tables", {})
    outbound = list(tables.get(table, {}).get("foreign_keys", []))
    inbound = []
    for tname, tinfo in tables.items():
        if tname == table:
            continue
        for fk in tinfo.get("foreign_keys", []):
            if fk.get("ref_table") == table:
                inbound.append({
                    "from_table": tname,
                    "from_column": fk["column"],
                    "ref_column": fk["ref_column"],
                })
    return {"outbound": outbound, "inbound": inbound}


# ── Filter parsing ─────────────────────────────────────────────────────────────

def _parse_sort(args, schema):
    col = (args.get("sort_col") or "").strip()
    if not col:
        return None
    valid_cols = {c.get("name") for c in (schema or []) if c.get("name")}
    if valid_cols and col not in valid_cols:
        return None
    direction = (args.get("sort_dir") or "asc").lower()
    if direction not in ("asc", "desc"):
        direction = "asc"
    return {"column": col, "dir": direction}


def _parse_filters(args, db_type: str):
    if db_type in SQL_DB_TYPES:
        adv_raw = args.get("adv_filters", "").strip()
        if adv_raw:
            try:
                data = json.loads(adv_raw)
                if isinstance(data, dict) and isinstance(data.get("conditions"), list):
                    return {
                        "advanced": True,
                        "combinator": data.get("combinator", "AND"),
                        "conditions": data["conditions"],
                    }
            except json.JSONDecodeError:
                pass
        col = args.get("filter_col", "").strip()
        if col:
            return {
                "column": col,
                "op": args.get("filter_op", "="),
                "value": args.get("filter_val", ""),
            }
    elif db_type == "mongodb":
        raw = args.get("filter_json", "").strip()
        if raw:
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                pass
    elif db_type == "dynamodb":
        fe = args.get("filter_fe", "").strip()
        if fe:
            try:
                eav = json.loads(args.get("filter_eav", "{}"))
            except json.JSONDecodeError:
                eav = {}
            return {"FilterExpression": fe, "ExpressionAttributeValues": eav}
    return None


# ── Error handlers ─────────────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({"error": str(e)}), 500


# ── JSON API (SPA) ────────────────────────────────────────────────────────────

VALID_DB_TYPES = {"postgresql", "mysql", "sqlite", "mongodb", "dynamodb"}
_SECRET_FIELDS = ("password", "secret_access_key")

_FIELDS_BY_TYPE = {
    "postgresql": ("host", "port", "database", "user", "password", "schema"),
    "mysql": ("host", "port", "database", "user", "password"),
    "sqlite": ("path",),
    "mongodb": ("uri", "database"),
    "dynamodb": ("region", "access_key_id", "secret_access_key", "endpoint_url"),
}


def _connection_public(conn: dict) -> dict:
    return connection_public(conn, _SECRET_FIELDS)


def _build_connection_from_input(payload: dict, conn_id: str, existing: dict | None = None) -> tuple[dict | None, str | None]:
    name = (payload.get("name") or "").strip()
    db_type = (payload.get("db_type") or "").strip()
    if not name:
        return None, "name is required"
    if not db_type:
        return None, "db_type is required"
    if db_type not in VALID_DB_TYPES:
        return None, f"unknown db_type: {db_type}"

    data: dict = {"id": conn_id, "name": name, "db_type": db_type}
    for field in _FIELDS_BY_TYPE[db_type]:
        if field in _SECRET_FIELDS:
            incoming = payload.get(field, None)
            if incoming is None or incoming == "":
                if existing and existing.get(field):
                    data[field] = existing[field]
            else:
                data[field] = incoming
        else:
            if field in payload:
                data[field] = payload[field]
    return data, None


@app.route("/api/connections", methods=["GET"])
def api_list_connections():
    conns = load_connections()
    return jsonify({"connections": [_connection_public(c) for c in conns.values()]})


@app.route("/api/connections/<conn_id>", methods=["GET"])
def api_get_connection(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    return jsonify({"connection": _connection_public(conns[conn_id])})


@app.route("/api/connections", methods=["POST"])
def api_create_connection():
    payload = request.get_json(silent=True) or {}
    conn_id = uuid.uuid4().hex[:8]
    data, err = _build_connection_from_input(payload, conn_id, existing=None)
    if err:
        return jsonify({"error": err}), 400
    conns = load_connections()
    conns[conn_id] = data
    save_connections(conns)
    return jsonify({"connection": _connection_public(data)}), 201


@app.route("/api/connections/<conn_id>", methods=["PUT"])
def api_update_connection(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    payload = request.get_json(silent=True) or {}
    data, err = _build_connection_from_input(payload, conn_id, existing=conns[conn_id])
    if err:
        return jsonify({"error": err}), 400
    conns[conn_id] = data
    save_connections(conns)
    invalidate_schema_cache(conn_id)
    return jsonify({"connection": _connection_public(data)})


@app.route("/api/connections/<conn_id>", methods=["DELETE"])
def api_delete_connection(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    conns.pop(conn_id, None)
    save_connections(conns)
    invalidate_schema_cache(conn_id)
    return ("", 204)


@app.route("/api/connections/<conn_id>/test", methods=["POST"])
def api_test_connection(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    conn = conns[conn_id]
    try:
        adapter = get_adapter(conn)
        ok, err = adapter.test_connection()
    except Exception as e:
        ok, err = False, str(e)
    return jsonify({"ok": ok, "error": err})


@app.route("/api/connections/<conn_id>/tables")
def api_list_tables(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    conn = conns[conn_id]
    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            tables = adapter.list_tables()
        finally:
            adapter.disconnect()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"tables": tables})


@app.route("/api/connections/<conn_id>/tables/<path:table>")
def api_view_table(conn_id, table):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    conn = conns[conn_id]
    db_type = conn.get("db_type", "")

    try:
        page = max(1, int(request.args.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = max(1, min(500, int(request.args.get("page_size", 50))))
    except (TypeError, ValueError):
        page_size = 50

    filters = _parse_filters(request.args, db_type)

    relations = {"outbound": [], "inbound": []}
    try:
        t0 = time.monotonic()
        adapter = get_adapter(conn)
        adapter.connect()
        t_connected = time.monotonic()
        try:
            schema = get_schema_cached(conn_id, adapter, table)
            t_schema = time.monotonic()
            sort = _parse_sort(request.args, schema)
            data = adapter.get_rows(table, page, page_size, filters, sort)
            t_rows = time.monotonic()
            # FK edges for this table, so the SPA can linkify cells (outbound)
            # and offer "referenced by" jumps (inbound). SQL only; cached.
            if db_type in SQL_DB_TYPES:
                relations = _relations_for(get_erd_cached(conn_id, adapter), table)
        finally:
            adapter.disconnect()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        "schema": schema,
        "data": data,
        "relations": relations,
        # Full request cost, not just the rows query — connect + schema
        # dominate on remote DBs and used to be hidden from this number
        "elapsed_ms": int((t_rows - t0) * 1000),
        "timings": {
            "connect_ms": int((t_connected - t0) * 1000),
            "schema_ms": int((t_schema - t_connected) * 1000),
            "rows_ms": int((t_rows - t_schema) * 1000),
        },
        "db_type": db_type,
    })


@app.route("/api/connections/<conn_id>/tables/<path:table>/export.csv")
def api_export_table_csv(conn_id, table):
    import csv as csvmod
    import io
    from flask import Response

    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    conn = conns[conn_id]
    db_type = conn.get("db_type", "")
    filters = _parse_filters(request.args, db_type)
    max_rows = max(1, min(100000, int(request.args.get("limit", 10000))))

    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            schema = get_schema_cached(conn_id, adapter, table)
            sort = _parse_sort(request.args, schema)

            rows_acc: list = []
            columns: list = []
            page = 1
            page_size = 1000
            while len(rows_acc) < max_rows:
                d = adapter.get_rows(table, page, page_size, filters, sort)
                if not columns:
                    columns = d.get("columns") or []
                rows_acc.extend(d.get("rows") or [])
                if not d.get("has_next") or not d.get("rows"):
                    break
                page += 1
            rows_acc = rows_acc[:max_rows]
        finally:
            adapter.disconnect()
    except Exception as e:
        return Response(f"Export failed: {e}", status=500, mimetype="text/plain")

    buf = io.StringIO()
    writer = csvmod.writer(buf)
    writer.writerow(columns)
    for r in rows_acc:
        writer.writerow(["" if v is None else v for v in r])

    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{table}.csv"',
        },
    )


@app.route("/api/connections/<conn_id>/tables/<path:table>/update", methods=["POST"])
def api_update_row(conn_id, table):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    conn = conns[conn_id]

    body = request.get_json(silent=True) or {}
    identity = body.get("identity") or {}
    values = body.get("values") or {}
    new_values = {k: ("__NULL__" if v is None else v) for k, v in values.items()}

    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            result = adapter.update_row(table, identity, new_values)
        finally:
            adapter.disconnect()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    if result.get("ok"):
        return jsonify(result), 200
    return jsonify(result), 400


@app.route("/api/connections/<conn_id>/tables/<path:table>/insert", methods=["POST"])
def api_insert_row(conn_id, table):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    conn = conns[conn_id]
    db_type = conn.get("db_type", "")

    body = request.get_json(silent=True) or {}

    if db_type == "mongodb":
        document = body.get("document", "")
        values = {"__document__": document}
    else:
        raw_values = body.get("values") or {}
        values = {k: ("__NULL__" if v is None else v) for k, v in raw_values.items()}

    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            result = adapter.insert_row(table, values)
        finally:
            adapter.disconnect()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    if result.get("ok"):
        return jsonify(result), 200
    return jsonify(result), 400


@app.route("/api/connections/<conn_id>/query", methods=["POST"])
def api_run_query(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404

    data = request.get_json(silent=True) or {}
    query = data.get("query", "") or ""

    if not query.strip():
        return jsonify({
            "columns": [],
            "rows": [],
            "affected": None,
            "error": None,
            "elapsed_ms": None,
        }), 200

    append_history(conn_id, query)
    conn = conns[conn_id]
    try:
        start = time.monotonic()
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            result = adapter.execute_query(query)
            elapsed_ms = int((time.monotonic() - start) * 1000)
        finally:
            adapter.disconnect()
        invalidate_schema_cache(conn_id)  # query may have been DDL
    except Exception as e:
        return jsonify({
            "columns": [],
            "rows": [],
            "affected": None,
            "error": str(e),
            "elapsed_ms": None,
        }), 200

    return jsonify({
        "columns": result.get("columns", []),
        "rows": result.get("rows", []),
        "affected": result.get("affected"),
        "error": None,
        "elapsed_ms": elapsed_ms,
    }), 200


# ── .sql script runner ─────────────────────────────────────────────────────────
# /query sends one string straight to the driver, which is exactly what a script
# file can't be: sqlite3 rejects multi-statement input and PyMySQL disallows it.
# So split here and run the statements one at a time over a single connection.

SQL_SCRIPT_MAX_BYTES = 5 * 1024 * 1024
SCRIPT_MAX_ROWS_PER_STMT = 500
SCRIPT_SQL_PREVIEW_CHARS = 2000


def _truncate_sql(stmt: str) -> str:
    if len(stmt) <= SCRIPT_SQL_PREVIEW_CHARS:
        return stmt
    return stmt[:SCRIPT_SQL_PREVIEW_CHARS] + "…"


@app.route("/api/connections/<conn_id>/query/script", methods=["POST"])
def api_run_query_script(conn_id):
    from sql_script import split_statements

    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    conn = conns[conn_id]
    db_type = conn.get("db_type", "")
    if db_type not in SQL_DB_TYPES:
        return jsonify({
            "error": f"Script upload is only supported for SQL databases "
                     f"(postgresql, mysql, sqlite) — this connection is {db_type or 'unknown'}."
        }), 400

    # get_data() first: it caches the body, so the multipart parse behind
    # request.files still works; the reverse order consumes the stream and
    # leaves raw (non-multipart) uploads empty. Same ordering as /api/tools/ocr.
    raw = request.get_data()
    upload = request.files.get("file")
    filename = None
    stop_on_error = True

    if upload is not None:
        blob = upload.read()
        filename = upload.filename or None
        stop_on_error = (request.form.get("stop_on_error", "true").lower()
                         not in ("false", "0", "no"))
    else:
        body = request.get_json(silent=True)
        if isinstance(body, dict):
            blob = (body.get("sql") or "").encode("utf-8")
            filename = body.get("filename") or None
            stop_on_error = bool(body.get("stop_on_error", True))
        else:
            blob = raw

    if len(blob) > SQL_SCRIPT_MAX_BYTES:
        return jsonify({
            "error": f"Script too large (max {SQL_SCRIPT_MAX_BYTES // (1024 * 1024)} MB)."
        }), 413

    text = blob.decode("utf-8", errors="replace")
    statements = split_statements(text)

    if not statements:
        return jsonify({
            "filename": filename,
            "total": 0, "ok": 0, "failed": 0, "skipped": 0,
            "elapsed_ms": 0, "error": None, "statements": [],
        }), 200

    # One history entry for the whole upload — one per statement would bury the
    # sidebar under a single file.
    label = filename or "pasted script"
    append_history(conn_id, f"-- script: {label} ({len(statements)} statements)")

    results = []
    ok = failed = skipped = 0
    script_start = time.monotonic()

    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            halted = False
            for idx, stmt in enumerate(statements):
                if halted:
                    results.append({
                        "index": idx, "sql": _truncate_sql(stmt), "status": "skipped",
                        "columns": [], "rows": [], "affected": None,
                        "error": None, "elapsed_ms": None, "truncated": False,
                    })
                    skipped += 1
                    continue

                start = time.monotonic()
                res = adapter.execute_query(stmt)
                elapsed_ms = int((time.monotonic() - start) * 1000)
                err = res.get("error")
                rows = res.get("rows") or []
                truncated = len(rows) > SCRIPT_MAX_ROWS_PER_STMT

                results.append({
                    "index": idx,
                    "sql": _truncate_sql(stmt),
                    "status": "error" if err else "ok",
                    "columns": res.get("columns") or [],
                    "rows": rows[:SCRIPT_MAX_ROWS_PER_STMT],
                    "affected": res.get("affected"),
                    "error": err,
                    "elapsed_ms": elapsed_ms,
                    "truncated": truncated,
                })
                if err:
                    failed += 1
                    if stop_on_error:
                        halted = True
                else:
                    ok += 1
        finally:
            adapter.disconnect()
        invalidate_schema_cache(conn_id)  # scripts are usually DDL
    except Exception as e:
        # Connection-level failure — report whatever ran before it blew up.
        return jsonify({
            "filename": filename,
            "total": len(statements), "ok": ok, "failed": failed, "skipped": skipped,
            "elapsed_ms": int((time.monotonic() - script_start) * 1000),
            "error": str(e),
            "statements": results,
        }), 200

    return jsonify({
        "filename": filename,
        "total": len(statements), "ok": ok, "failed": failed, "skipped": skipped,
        "elapsed_ms": int((time.monotonic() - script_start) * 1000),
        "error": None,
        "statements": results,
    }), 200


@app.route("/api/connections/<conn_id>/query/history", methods=["GET"])
def api_get_query_history(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    return jsonify({"history": get_history_for(conn_id)}), 200


@app.route("/api/connections/<conn_id>/query/history", methods=["DELETE"])
def api_delete_query_history(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404

    index_arg = request.args.get("index")
    history = load_query_history()
    items = history.get(conn_id, [])

    if index_arg is not None:
        try:
            idx = int(index_arg)
        except (TypeError, ValueError):
            return jsonify({"error": "Invalid index"}), 400
        if idx < 0 or idx >= len(items):
            return jsonify({"error": "Index out of range"}), 400
        items.pop(idx)
        history[conn_id] = items
        save_query_history(history)
        return "", 204

    if conn_id in history:
        history[conn_id] = []
        save_query_history(history)
    return "", 204


@app.route("/api/connections/<conn_id>/erd", methods=["GET"])
def api_get_erd(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404

    conn = conns[conn_id]
    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            erd_data = get_erd_cached(conn_id, adapter)
        finally:
            adapter.disconnect()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    rel_count = sum(
        len(t.get("foreign_keys", []))
        for t in erd_data["tables"].values()
    )
    return jsonify({"erd": erd_data, "rel_count": rel_count}), 200


# ── Saved views (SQL connections only) ──────────────────────────────────────────

def _collect_view_tables(spec: dict) -> set:
    tables = set()
    if spec.get("base_table"):
        tables.add(spec["base_table"])
    for j in spec.get("joins") or []:
        for k in ("from_table", "to_table"):
            if j.get(k):
                tables.add(j[k])
    return tables


def _validate_view_spec(conn_id: str, spec: dict, adapter) -> str | None:
    """Return an error string if the spec references anything that isn't a real
    table/column, else None. Guards identifier injection the way _parse_sort
    guards ORDER BY — by allow-listing against live introspection."""
    base = spec.get("base_table")
    if not base:
        return "View has no base table."

    valid_tables = set(adapter.list_tables())
    used_tables = _collect_view_tables(spec)
    unknown = used_tables - valid_tables
    if unknown:
        return f"Unknown table(s): {', '.join(sorted(unknown))}"

    cols_by_table = {
        t: {c.get("name") for c in get_schema_cached(conn_id, adapter, t)}
        for t in used_tables
    }

    for j in spec.get("joins") or []:
        ft, fc = j.get("from_table"), j.get("from_col")
        tt, tc = j.get("to_table"), j.get("to_col")
        if fc not in cols_by_table.get(ft, set()):
            return f"Unknown join column {ft}.{fc}"
        if tc not in cols_by_table.get(tt, set()):
            return f"Unknown join column {tt}.{tc}"

    for c in spec.get("columns") or []:
        t, col = c.get("table"), c.get("column")
        if t not in used_tables or col not in cols_by_table.get(t, set()):
            return f"Unknown column {t}.{col}"

    filt = spec.get("filters")
    conds = []
    if isinstance(filt, dict):
        if filt.get("advanced"):
            conds = filt.get("conditions") or []
        elif filt.get("column"):
            conds = [filt]
    for cond in conds:
        t, col = cond.get("table"), cond.get("column")
        if not col:
            continue
        if t:
            if t not in used_tables or col not in cols_by_table.get(t, set()):
                return f"Unknown filter column {t}.{col}"
        elif not any(col in cols for cols in cols_by_table.values()):
            return f"Unknown filter column {col}"

    s = spec.get("sort")
    if s and s.get("column"):
        t = s.get("table")
        if t and (t not in used_tables or s["column"] not in cols_by_table.get(t, set())):
            return f"Unknown sort column {t}.{s['column']}"
    return None


@app.route("/api/connections/<conn_id>/views", methods=["GET"])
def api_list_views(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    return jsonify({"views": get_views_for(conn_id)}), 200


@app.route("/api/connections/<conn_id>/views", methods=["POST"])
def api_create_view(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    spec = body.get("spec") or {}
    if not name:
        return jsonify({"error": "View name is required."}), 400
    if not spec.get("base_table"):
        return jsonify({"error": "View has no base table."}), 400

    now = int(time.time() * 1000)
    view = {
        "id": "v_" + uuid.uuid4().hex[:12],
        "name": name,
        "spec": spec,
        "created_at": now,
        "updated_at": now,
    }
    views = load_views()
    items = views.get(conn_id, [])
    items.append(view)
    views[conn_id] = items
    save_views(views)
    return jsonify(view), 201


@app.route("/api/connections/<conn_id>/views/run", methods=["POST"])
def api_run_view(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    conn = conns[conn_id]
    db_type = conn.get("db_type", "")
    if db_type not in SQL_DB_TYPES:
        return jsonify({"error": "Views are only supported on SQL connections."}), 400

    body = request.get_json(silent=True) or {}
    spec = body.get("spec") or {}
    try:
        page = max(1, int(body.get("page", 1)))
    except (TypeError, ValueError):
        page = 1
    try:
        page_size = max(1, min(500, int(body.get("page_size", 50))))
    except (TypeError, ValueError):
        page_size = 50

    try:
        start = time.monotonic()
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            err = _validate_view_spec(conn_id, spec, adapter)
            if err:
                return jsonify({"error": err}), 400
            sql, params = build_view_query(
                spec,
                quote_char=adapter.QUOTE_CHAR,
                placeholder=adapter.PLACEHOLDER,
                page=page,
                page_size=page_size,
            )
            result = adapter.execute_select(sql, params)
        finally:
            adapter.disconnect()
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Surface SQL errors like the query editor does (200 + error field).
    if result.get("error"):
        return jsonify({"error": result["error"]}), 200

    rows = result.get("rows", [])
    has_next = len(rows) > page_size
    rows = rows[:page_size]
    return jsonify({
        "columns": result.get("columns", []),
        "rows": rows,
        "page": page,
        "page_size": page_size,
        "has_next": has_next,
        "total": None,  # COUNT over a join is expensive; has_next is exact
        "elapsed_ms": int((time.monotonic() - start) * 1000),
        "error": None,
    }), 200


@app.route("/api/connections/<conn_id>/views/<view_id>", methods=["GET"])
def api_get_view(conn_id, view_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    for v in get_views_for(conn_id):
        if v.get("id") == view_id:
            return jsonify(v), 200
    return jsonify({"error": "View not found"}), 404


@app.route("/api/connections/<conn_id>/views/<view_id>", methods=["PUT"])
def api_update_view(conn_id, view_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    body = request.get_json(silent=True) or {}

    views = load_views()
    items = views.get(conn_id, [])
    for v in items:
        if v.get("id") == view_id:
            if "name" in body:
                name = (body.get("name") or "").strip()
                if not name:
                    return jsonify({"error": "View name is required."}), 400
                v["name"] = name
            if "spec" in body:
                spec = body.get("spec") or {}
                if not spec.get("base_table"):
                    return jsonify({"error": "View has no base table."}), 400
                v["spec"] = spec
            v["updated_at"] = int(time.time() * 1000)
            views[conn_id] = items
            save_views(views)
            return jsonify(v), 200
    return jsonify({"error": "View not found"}), 404


@app.route("/api/connections/<conn_id>/views/<view_id>", methods=["DELETE"])
def api_delete_view(conn_id, view_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    views = load_views()
    items = views.get(conn_id, [])
    remaining = [v for v in items if v.get("id") != view_id]
    if len(remaining) == len(items):
        return jsonify({"error": "View not found"}), 404
    views[conn_id] = remaining
    save_views(views)
    return "", 204


# ── Tools ──────────────────────────────────────────────────────────────────────
# Standalone utilities that don't belong to a connection. OCR runs fully
# locally (see ocr.py); nothing leaves the machine.

OCR_MAX_BYTES = 20 * 1024 * 1024


@app.route("/api/tools/ocr", methods=["POST"])
def api_tools_ocr():
    from ocr import OcrBadImage, OcrUnavailable, ocr_image

    # get_data() first: it caches the body, so the multipart parse behind
    # request.files still works; the reverse order consumes the stream and
    # leaves raw (non-multipart) uploads empty.
    raw = request.get_data()
    upload = request.files.get("image")
    data = upload.read() if upload else raw
    if not data:
        return jsonify({"error": "No image provided. Send multipart field 'image' or a raw body."}), 400
    if len(data) > OCR_MAX_BYTES:
        return jsonify({"error": f"Image too large (max {OCR_MAX_BYTES // (1024 * 1024)} MB)."}), 413

    try:
        result = ocr_image(data)
    except OcrUnavailable as e:
        return jsonify({"error": str(e)}), 503
    except OcrBadImage as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": f"OCR failed: {e}"}), 500
    return jsonify(result), 200


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, port=5001)
