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
