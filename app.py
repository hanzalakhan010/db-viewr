import json
import os
import time
import uuid
from urllib.parse import urlencode

from flask import (
    Flask,
    abort,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)

from adapters import get_adapter

app = Flask(__name__)

SPA_DIST_DIR = os.path.join(os.path.dirname(__file__), "static", "dist")


@app.route("/app/")
@app.route("/app/<path:rest>")
def spa(rest: str = ""):
    """Serve the React SPA at /app/* during migration.

    Hashed JS/CSS live under /app/assets/* — served as files. Any other path
    falls back to index.html so client-side routing works on reload.
    """
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
app.secret_key = os.environ.get("SECRET_KEY", os.urandom(24))

# Allow overriding via env var so Docker can mount a persistent data volume
CONNECTIONS_FILE = os.environ.get(
    "CONNECTIONS_FILE",
    os.path.join(os.path.dirname(__file__), "connections.json"),
)
QUERY_HISTORY_FILE = os.environ.get(
    "QUERY_HISTORY_FILE",
    os.path.join(os.path.dirname(__file__), "query_history.json"),
)

SQL_DB_TYPES = {"postgresql", "mysql", "sqlite"}

# ── Connection persistence ─────────────────────────────────────────────────────

def load_connections() -> dict:
    if not os.path.exists(CONNECTIONS_FILE):
        return {}
    with open(CONNECTIONS_FILE) as f:
        return json.load(f)


def save_connections(conns: dict) -> None:
    with open(CONNECTIONS_FILE, "w") as f:
        json.dump(conns, f, indent=2)


def get_conn_or_404(conn_id: str) -> dict:
    conns = load_connections()
    if conn_id not in conns:
        abort(404)
    return conns[conn_id]


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


# ── Context processor: inject connections into every template ──────────────────

@app.context_processor
def inject_globals():
    return {"connections": load_connections()}


# ── Index ──────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html", title="Connections")


# ── New connection ─────────────────────────────────────────────────────────────

@app.route("/connections/new", methods=["GET", "POST"])
def new_connection():
    if request.method == "POST":
        data = request.form.to_dict()
        conn_id = uuid.uuid4().hex[:8]
        data["id"] = conn_id
        conns = load_connections()
        conns[conn_id] = data
        save_connections(conns)
        flash(f"Connection \"{data.get('name', conn_id)}\" saved.", "success")
        return redirect(url_for("index"))
    return render_template("connection_form.html", conn=None, title="New Connection")


# ── Edit connection ────────────────────────────────────────────────────────────

@app.route("/connections/<conn_id>/edit", methods=["GET", "POST"])
def edit_connection(conn_id):
    conn = get_conn_or_404(conn_id)
    if request.method == "POST":
        data = request.form.to_dict()
        data["id"] = conn_id
        # Preserve password if left blank (edit form)
        if not data.get("password") and conn.get("password"):
            data["password"] = conn["password"]
        if not data.get("secret_access_key") and conn.get("secret_access_key"):
            data["secret_access_key"] = conn["secret_access_key"]
        conns = load_connections()
        conns[conn_id] = data
        save_connections(conns)
        flash("Connection updated.", "success")
        return redirect(url_for("index"))
    return render_template("connection_form.html", conn=conn, title="Edit Connection")


# ── Delete connection ──────────────────────────────────────────────────────────

@app.route("/connections/<conn_id>/delete", methods=["POST"])
def delete_connection(conn_id):
    conns = load_connections()
    conns.pop(conn_id, None)
    save_connections(conns)
    flash("Connection deleted.", "info")
    return redirect(url_for("index"))


# ── Test connectivity (JSON) ───────────────────────────────────────────────────

@app.route("/connections/<conn_id>/test", methods=["POST"])
def test_connection(conn_id):
    conn = get_conn_or_404(conn_id)
    try:
        adapter = get_adapter(conn)
        ok, err = adapter.test_connection()
    except Exception as e:
        ok, err = False, str(e)
    return jsonify({"ok": ok, "error": err})


# ── Table / collection list ────────────────────────────────────────────────────

@app.route("/connections/<conn_id>/tables")
def list_tables(conn_id):
    conn = get_conn_or_404(conn_id)
    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            tables = adapter.list_tables()
        finally:
            adapter.disconnect()
    except Exception as e:
        flash(f"Error listing tables: {e}", "error")
        tables = []
    return render_template(
        "tables.html",
        conn=conn,
        tables=tables,
        title=conn.get("name"),
        active_conn_id=conn_id,
    )


# ── Table / collection data view ───────────────────────────────────────────────

@app.route("/connections/<conn_id>/tables/<path:table>")
def view_table(conn_id, table):
    conn = get_conn_or_404(conn_id)
    db_type = conn.get("db_type", "")
    page = max(1, int(request.args.get("page", 1)))
    page_size = max(1, min(500, int(request.args.get("page_size", 50))))

    filters = _parse_filters(request.args, db_type)
    filter_qs = urlencode({k: v for k, v in request.args.items() if k != "page"})

    schema = []
    data = {"columns": [], "rows": [], "total": None, "page": page,
            "page_size": page_size, "has_next": False}
    error = None
    elapsed_ms = None

    sort = None  # parsed after schema is loaded so we can validate the column

    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            schema = adapter.get_schema(table)
            sort = _parse_sort(request.args, schema)
            start = time.monotonic()
            data = adapter.get_rows(table, page, page_size, filters, sort)
            elapsed_ms = int((time.monotonic() - start) * 1000)
        finally:
            adapter.disconnect()
    except Exception as e:
        error = str(e)

    return render_template(
        "table_view.html",
        conn=conn,
        table=table,
        schema=schema,
        data=data,
        filters=filters,
        filter_qs=filter_qs,
        sort=sort,
        elapsed_ms=elapsed_ms,
        db_type=db_type,
        error=error,
        title=f"{table} — {conn.get('name')}",
        active_conn_id=conn_id,
    )


# ── CSV export ────────────────────────────────────────────────────────────────

@app.route("/connections/<conn_id>/tables/<path:table>/export.csv")
def export_table_csv(conn_id, table):
    import csv as csvmod
    import io
    from flask import Response

    conn = get_conn_or_404(conn_id)
    db_type = conn.get("db_type", "")
    filters = _parse_filters(request.args, db_type)
    max_rows = max(1, min(100000, int(request.args.get("limit", 10000))))

    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            schema = adapter.get_schema(table)
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


# ── Update row ────────────────────────────────────────────────────────────────

@app.route("/connections/<conn_id>/tables/<path:table>/update", methods=["POST"])
def update_row(conn_id, table):
    conn = get_conn_or_404(conn_id)

    identity = {k[len("identity_"):]: v
                for k, v in request.form.items()
                if k.startswith("identity_")}
    new_values = {k[len("val_"):]: v
                  for k, v in request.form.items()
                  if k.startswith("val_")}
    for c in request.form.getlist("null_col"):
        new_values[c] = "__NULL__"

    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            result = adapter.update_row(table, identity, new_values)
        finally:
            adapter.disconnect()
    except Exception as e:
        result = {"ok": False, "error": str(e)}

    if result.get("ok"):
        flash("Row updated.", "success")
    else:
        flash(f"Update failed: {result.get('error')}", "error")
    return redirect(url_for("view_table", conn_id=conn_id, table=table))


# ── Insert row ────────────────────────────────────────────────────────────────

@app.route("/connections/<conn_id>/tables/<path:table>/insert", methods=["POST"])
def insert_row(conn_id, table):
    conn = get_conn_or_404(conn_id)
    db_type = conn.get("db_type", "")

    if db_type in SQL_DB_TYPES:
        values = {k[4:]: v for k, v in request.form.items() if k.startswith("col_")}
        null_cols = request.form.getlist("null_col")
        for c in null_cols:
            values[c] = "__NULL__"
    else:
        values = {"__document__": request.form.get("document", "")}

    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            result = adapter.insert_row(table, values)
        finally:
            adapter.disconnect()
    except Exception as e:
        result = {"ok": False, "error": str(e)}

    if result.get("ok"):
        flash("Row inserted.", "success")
    else:
        flash(f"Insert failed: {result.get('error')}", "error")
    return redirect(url_for("view_table", conn_id=conn_id, table=table))


# ── ERD viewer ────────────────────────────────────────────────────────────────

@app.route("/connections/<conn_id>/erd")
def erd_view(conn_id):
    conn = get_conn_or_404(conn_id)
    erd_data = {"tables": {}, "has_relations": False}
    error = None
    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            erd_data = adapter.get_erd_data()
        finally:
            adapter.disconnect()
    except Exception as e:
        error = str(e)

    rel_count = sum(
        len(t.get("foreign_keys", []))
        for t in erd_data["tables"].values()
    )

    return render_template(
        "erd.html",
        conn=conn,
        erd_data=erd_data,
        rel_count=rel_count,
        error=error,
        title=f"ERD — {conn.get('name')}",
        active_conn_id=conn_id,
    )


# ── Query editor ───────────────────────────────────────────────────────────────

@app.route("/connections/<conn_id>/query", methods=["GET", "POST"])
def query_editor(conn_id):
    conn = get_conn_or_404(conn_id)
    db_type = conn.get("db_type", "")
    result = None
    query = request.form.get("query", "") if request.method == "POST" else ""

    elapsed_ms = None
    if request.method == "POST" and query.strip():
        append_history(conn_id, query)
        try:
            adapter = get_adapter(conn)
            adapter.connect()
            try:
                start = time.monotonic()
                result = adapter.execute_query(query)
                elapsed_ms = int((time.monotonic() - start) * 1000)
            finally:
                adapter.disconnect()
        except Exception as e:
            result = {"columns": [], "rows": [], "affected": None, "error": str(e)}

    return render_template(
        "query.html",
        conn=conn,
        db_type=db_type,
        query=query,
        result=result,
        elapsed_ms=elapsed_ms,
        history=get_history_for(conn_id),
        title=f"Query — {conn.get('name')}",
        active_conn_id=conn_id,
    )


# ── Query history: delete one / clear all ──────────────────────────────────────

@app.route("/connections/<conn_id>/query/history/delete", methods=["POST"])
def delete_query_history_item(conn_id):
    get_conn_or_404(conn_id)
    try:
        index = int(request.form.get("index", "-1"))
    except ValueError:
        index = -1
    history = load_query_history()
    items = history.get(conn_id, [])
    if 0 <= index < len(items):
        items.pop(index)
        history[conn_id] = items
        save_query_history(history)
    return redirect(url_for("query_editor", conn_id=conn_id))


@app.route("/connections/<conn_id>/query/history/clear", methods=["POST"])
def clear_query_history(conn_id):
    get_conn_or_404(conn_id)
    history = load_query_history()
    if conn_id in history:
        history.pop(conn_id)
        save_query_history(history)
    return redirect(url_for("query_editor", conn_id=conn_id))


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
    return render_template("error.html", code=404, message="Page not found."), 404


@app.errorhandler(500)
def server_error(e):
    return render_template("error.html", code=500, message=str(e)), 500


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
    out = {}
    for k, v in conn.items():
        if k in _SECRET_FIELDS:
            continue
        out[k] = v
    out["id"] = conn.get("id")
    for sf in _SECRET_FIELDS:
        out[f"has_{sf}"] = bool(conn.get(sf))
    return out


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
    return jsonify({"connection": _connection_public(data)})


@app.route("/api/connections/<conn_id>", methods=["DELETE"])
def api_delete_connection(conn_id):
    conns = load_connections()
    if conn_id not in conns:
        return jsonify({"error": "Connection not found"}), 404
    conns.pop(conn_id, None)
    save_connections(conns)
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

    try:
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            schema = adapter.get_schema(table)
            sort = _parse_sort(request.args, schema)
            start = time.monotonic()
            data = adapter.get_rows(table, page, page_size, filters, sort)
            elapsed_ms = int((time.monotonic() - start) * 1000)
        finally:
            adapter.disconnect()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({
        "schema": schema,
        "data": data,
        "elapsed_ms": elapsed_ms,
        "db_type": db_type,
    })


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
        adapter = get_adapter(conn)
        adapter.connect()
        try:
            start = time.monotonic()
            result = adapter.execute_query(query)
            elapsed_ms = int((time.monotonic() - start) * 1000)
        finally:
            adapter.disconnect()
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
            erd_data = adapter.get_erd_data()
        finally:
            adapter.disconnect()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    rel_count = sum(
        len(t.get("foreign_keys", []))
        for t in erd_data["tables"].values()
    )
    return jsonify({"erd": erd_data, "rel_count": rel_count}), 200


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app.run(debug=True, port=5001)
