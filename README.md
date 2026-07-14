# db-viewr

A lightweight, self-hosted database client that runs in your browser.
Backend is Flask + adapter classes per DB type; there are two UIs sharing the
same Flask process:

- **Legacy UI** at `/` — server-rendered Jinja templates (the original).
- **SPA** at `/app/` — React + TypeScript single-page app for faster
  navigation.

Both call the same underlying adapters; pick whichever feels nicer.

## Features

- Multi-database: PostgreSQL, MySQL/MariaDB, SQLite, MongoDB, DynamoDB
- Browse tables with paginated rows, sort, simple + advanced filters
- Inline row edit / insert; CSV export
- SQL / Mongo / PartiQL query editor with per-connection history
- ERD viewer
- Multiple saved connections with connectivity test
- BI dashboards (SPA, PostgreSQL only): saved read-only queries → charts
  (bar/line/area/pie/number) → drag/resize dashboards at `/app/bi`.
  Queries run in a read-only session, which blocks writes (e.g. an
  `UPDATE` fails with a database error); for a hard guarantee, point
  the BI connection at a read-only database role.
  Definitions persist in `bi_storage.json`.

| Database       | Driver         |
|----------------|----------------|
| PostgreSQL     | psycopg2       |
| MySQL/MariaDB  | PyMySQL        |
| SQLite         | stdlib sqlite3 |
| MongoDB        | pymongo        |
| DynamoDB       | boto3          |

---

## Setup

Two prerequisites:

1. [**uv**](https://github.com/astral-sh/uv) — Python package manager.
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```
2. **Node 20+** — only needed if you want to (re)build the React SPA.
   Skip if you only use the legacy UI at `/`.

Clone and install Python deps:

```bash
git clone https://github.com/hanzalakhan010/db-viewr.git
cd db-viewr
uv sync
```

That's it. `uv sync` creates `.venv/` and installs everything from
`pyproject.toml` / `uv.lock`.

### Run

```bash
uv run app.py
```

Open **http://localhost:5001** — both UIs are live:

- Legacy UI: <http://localhost:5001/>
- SPA: <http://localhost:5001/app/>

Saved connections live in `connections.json` next to `app.py`
(gitignored, never committed). Query history lives in `query_history.json`.

### MCP server (query your DBs from an LLM)

The repo includes an MCP (Model Context Protocol) server, `mcp_server.py`,
that exposes your saved connections as tools an LLM client can call — a
tunnel for the model to query your databases instead of you running psql.
It speaks stdio, reads the same `connections.json`, and does **not** need
the Flask app to be running.

Tools exposed:

- `list_connections` — saved connections (secrets redacted)
- `test_connection` — connectivity check
- `list_tables` — tables / collections on a connection
- `get_table_schema` — column definitions for one table
- `get_table_rows` — paginated row browsing, no query language needed
- `run_query` — SQL / Mongo JSON / PartiQL depending on `db_type`
- `get_erd` — full schema graph with foreign-key relations

#### Setup

1. **Install deps** (the `mcp` package is already in `pyproject.toml`):
   ```bash
   uv sync
   ```
2. **Save at least one connection** — run `uv run app.py`, open
   <http://localhost:5001>, and add a connection. The MCP server reads the
   same `connections.json` the web UI writes.
3. **Connect an LLM client:**
   - **Claude Code** — already wired up via the committed `.mcp.json`.
     Open this repo in Claude Code and approve the `db-viewr` server when
     prompted.
   - **Claude Desktop** — add to `claude_desktop_config.json` (absolute
     path required since Desktop launches servers from an arbitrary
     directory), then restart Desktop:
     ```json
     {
       "mcpServers": {
         "db-viewr": {
           "command": "uv",
           "args": ["--directory", "/absolute/path/to/db-viewr", "run", "mcp_server.py"]
         }
       }
     }
     ```

#### Verify it works

Run through this checklist after setup:

- [ ] **Server boots:** `uv run mcp_server.py` starts silently and blocks
      waiting on stdin (Ctrl-C to exit). Any traceback = broken install.
- [ ] **Tools respond:** `uv run mcp dev mcp_server.py` opens the MCP
      Inspector (needs Node). Call `list_connections` — your connections
      appear with **no** `password` / `uri` / `secret_access_key` fields,
      only `has_*` booleans.
- [ ] **Queries run:** in the Inspector, call `run_query` with a
      connection id and `SELECT 1` (SQL DBs) — expect one row back with
      `error: null` and an `elapsed_ms` timing.
- [ ] **Errors are clean:** call `run_query` with a bogus `connection_id`
      → "Unknown connection id" message; with invalid SQL → the DB's
      syntax error in the `error` field. Neither should crash the server.
- [ ] **Truncation guards context:** `run_query` with `SELECT *` on a big
      table and `max_rows: 5` → 5 rows returned, `truncated: true`,
      `row_count` shows the real total.
- [ ] **Claude Code end-to-end:** `/mcp` shows `db-viewr` connected; ask
      *"list my database connections and show 5 rows from some table"* —
      each tool call should surface an approval prompt before running.
- [ ] **Web UI unaffected:** `uv run app.py` still lists/edits
      connections normally at <http://localhost:5001>.

> **Security note:** `run_query` has **full read/write access** — the LLM
> can run INSERT/UPDATE/DELETE/DDL on any saved connection. The only guard
> is your MCP client's per-call approval prompt, so review each tool call
> before approving it.

### (Optional) Rebuild the SPA

The repo ships with a pre-built bundle at `static/dist/`. Rebuild only if
you edit anything under `frontend/`:

```bash
cd frontend
npm install        # first time only
npm run build      # outputs ../static/dist/
```

For SPA development with HMR (auto-reload on save):

```bash
# terminal 1
uv run app.py
# terminal 2
cd frontend && npm run dev
# open http://localhost:5173/app/  (Vite proxies /api → :5001)
```

---

## Why not Docker?

Docker makes "connect to a DB running on your laptop" annoying — you have to
remember `host.docker.internal` on Mac/Windows or `172.17.0.1` on Linux, and
service-name resolution only works if the DB is also in a container on the
same network. Since this tool is intentionally local-only, a plain uv-run
process is friction-free. A Dockerfile + compose.yml are still in the repo
for anyone who wants them, but they're not the recommended path.

---

## Configuration (optional)

Environment variables, all optional:

| Variable                | Default                    | Description                              |
|-------------------------|----------------------------|------------------------------------------|
| `CONNECTIONS_FILE`      | `./connections.json`       | Where saved connections persist          |
| `QUERY_HISTORY_FILE`    | `./query_history.json`     | Per-connection query history             |
| `BI_STORAGE_FILE`       | `./bi_storage.json`        | BI saved queries, charts, dashboards     |
| `SECRET_KEY`            | random per-process         | Flask session secret                     |
| `AWS_ACCESS_KEY_ID`     | —                          | Fallback AWS creds for DynamoDB          |
| `AWS_SECRET_ACCESS_KEY` | —                          | Fallback AWS creds for DynamoDB          |

> **Security note:** `connections.json` stores passwords / AWS keys in
> plaintext. Don't expose port 5001 to a public network. This is a
> single-user local tool.

---

## Project layout

```
db-viewr/
├── app.py                 # Flask app: HTML routes + /api/* JSON endpoints + /app SPA mount
├── pyproject.toml         # uv-managed Python deps
├── adapters/              # one file per DB type, all extending BaseAdapter
├── templates/             # legacy server-rendered UI (Jinja)
├── static/
│   ├── style.css / *.js   # legacy UI assets
│   └── dist/              # built React SPA (gitignored; produced by `npm run build`)
├── frontend/              # React + Vite + TS source for the SPA
│   ├── src/
│   └── package.json
└── MIGRATION_NOTES.md     # decisions + open questions for the SPA migration
```

---

## Adding a new database adapter

1. Create `adapters/yourdb.py` extending `BaseAdapter`.
2. Implement `connect`, `disconnect`, `list_tables`, `get_schema`,
   `get_rows`, `execute_query`, `get_erd_data`.
3. Register it in `adapters/__init__.py`.
4. Add its form fields to `templates/connection_form.html` AND to the
   SPA form at `frontend/src/pages/ConnectionFormPage.tsx`.

---

## License

MIT
