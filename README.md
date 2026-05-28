# db-viewr

A lightweight, self-hosted database client that runs in your browser.
Built with Flask and plain HTML — no Electron, no heavy frontend framework, no build step.

```
┌─────────────────────────────────────────────────────────────────┐
│  db-viewr                                    + New Connection   │
├──────────────────┬──────────────────────────────────────────────┤
│  pg  production  │  users                          Query Editor │
│  my  staging     ├─────────────────────────────────────────────┤
│  sq  local.db    │  Schema ▸ 4 columns                         │
│  mg  atlas       │                                              │
│  dy  aws-dynamo  │  ┌──────┬──────────────┬──────────┬──────┐  │
│                  │  │  id  │  email        │  name    │  pk  │  │
│                  │  ├──────┼──────────────┼──────────┼──────┤  │
│                  │  │  1   │ alice@…       │  Alice   │  ★   │  │
│                  │  │  2   │ bob@…         │  Bob     │      │  │
│                  │  └──────┴──────────────┴──────────┴──────┘  │
│                  │  « Prev   Page 1 of 24 · 1,187 rows   Next » │
└──────────────────┴──────────────────────────────────────────────┘
```

## Features

- **Multi-database** — PostgreSQL, MySQL / MariaDB, SQLite, MongoDB, DynamoDB
- **Browse tables** — paginated rows, column schema, sortable columns
- **Filter rows** — column + operator + value for SQL; JSON filter for MongoDB; FilterExpression for DynamoDB
- **SQL / query editor** — run raw SQL, MongoDB pipelines, or DynamoDB PartiQL with `Ctrl+Enter`
- **ERD viewer** — interactive SVG diagram with FK relationship lines, drag-to-rearrange, zoom/pan
- **JSON field preview** — click any JSON/JSONB cell to see it pretty-printed in a modal
- **Multiple connections** — save, edit, test, and switch between connections; one-click connectivity test
- **Zero install for users** — pull the Docker image and go

## Supported Databases

| Database       | Driver         | Notes                                      |
|----------------|----------------|--------------------------------------------|
| PostgreSQL     | psycopg2       | FK relationships shown in ERD              |
| MySQL/MariaDB  | PyMySQL        | FK relationships shown in ERD              |
| SQLite         | stdlib sqlite3 | FK relationships shown in ERD              |
| MongoDB        | pymongo        | JSON filter & aggregate pipeline support   |
| DynamoDB       | boto3          | PartiQL query editor; local endpoint support |

---

## Quick Start — Docker (recommended)

### 1 — Clone the repository

```bash
git clone https://github.com/your-org/db-viewr.git
cd db-viewr
```

### 2 — Start the container

```bash
docker compose up -d
```

Open **http://localhost:5000** in your browser.
Your saved connections persist in a Docker volume and survive restarts and upgrades.

### 3 — Connect to a database

Click **+ New Connection**, pick your database type, fill in the credentials, and hit **Save Connection**.
Use the **Test** button on the connection list to verify connectivity before browsing.

---

## Connecting to databases inside Docker

When db-viewr runs inside Docker it cannot reach `localhost` on your host machine.
Use one of these approaches instead:

### Other Docker containers

Put db-viewr on the same Docker network as your database container and use the **service name** as the host:

```yaml
# docker-compose.yml
services:
  db-viewr:
    # ...
    networks:
      - myapp_network

networks:
  myapp_network:
    external: true
```

Then in the db-viewr UI set **Host** to the service name, e.g. `postgres` or `mysql`.

### Host machine databases

Use the Docker-internal gateway address instead of `localhost`:

- **Linux:** `172.17.0.1`
- **Mac / Windows:** `host.docker.internal`

### SQLite files on your host

Uncomment the volume mount in `docker-compose.yml`:

```yaml
volumes:
  - /home/yourname/databases:/sqlite:ro   # host path : container path
```

Then set the **File path** in the UI to `/sqlite/mydb.db`.

---

## Configuration

All configuration is done via environment variables in `docker-compose.yml`.

| Variable           | Default                      | Description                                        |
|--------------------|------------------------------|----------------------------------------------------|
| `CONNECTIONS_FILE` | `/data/connections.json`     | Where saved connections are stored                 |
| `SECRET_KEY`       | random (changes on restart)  | Flask secret — set a stable value in docker-compose|
| `AWS_ACCESS_KEY_ID`     | —                       | Optional global AWS credentials for DynamoDB       |
| `AWS_SECRET_ACCESS_KEY` | —                       | Optional global AWS credentials for DynamoDB       |

> **Security note:** `connections.json` stores passwords and AWS keys in plain text.
> Do not expose port 5000 to a public network. This tool is designed for local / internal use.

---

## Local Development (without Docker)

### Requirements

- Python 3.11+
- The databases you want to connect to (running locally or remotely)

### Setup

```bash
git clone https://github.com/your-org/db-viewr.git
cd db-viewr

python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt

python app.py
```

Open **http://localhost:5000**.

The dev server reloads automatically on code changes (`debug=True`).
Connections are saved to `connections.json` in the project root.

---

## Upgrading

```bash
# Pull the latest image (or rebuild from source)
docker compose pull          # if using a published image
# or
docker compose build         # if building locally

# Restart — named volume keeps your saved connections intact
docker compose up -d

# Backup connections before upgrading (optional)
docker cp db-viewr:/data/connections.json ./connections-backup.json
```

---

## Project Structure

```
db-viewr/
├── app.py               # Flask app — all routes
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── adapters/
│   ├── base.py          # Abstract BaseAdapter interface
│   ├── postgres.py
│   ├── mysql.py
│   ├── sqlite.py
│   ├── mongo.py
│   └── dynamo.py
├── templates/
│   ├── base.html        # Sidebar layout
│   ├── index.html       # Connection list
│   ├── connection_form.html
│   ├── tables.html      # Table browser
│   ├── table_view.html  # Paginated rows + filter
│   ├── query.html       # Query editor
│   └── erd.html         # ERD diagram viewer
└── static/
    ├── style.css
    ├── app.js           # Ctrl+Enter, JSON modal, connection test
    └── erd.js           # SVG ERD renderer (drag, zoom, FK lines)
```

---

## Adding a New Database Adapter

1. Create `adapters/yourdb.py` extending `BaseAdapter`
2. Implement: `connect`, `disconnect`, `list_tables`, `get_schema`, `get_rows`, `execute_query`, `get_erd_data`
3. Register it in `adapters/__init__.py`:
   ```python
   from .yourdb import YourDBAdapter
   ADAPTER_REGISTRY["yourdb"] = YourDBAdapter
   ```
4. Add its connection form fields to `templates/connection_form.html`

---

## License

MIT
