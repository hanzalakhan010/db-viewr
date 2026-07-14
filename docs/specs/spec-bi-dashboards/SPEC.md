---
id: SPEC-bi-dashboards
companions: []
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability only — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# BI Dashboards (v1)

## Why

Opportunity to capture, plus a vision to realize. db-viewr answers "what's in this table?" — row-oriented, write-capable, developer-facing. Its users have no way to answer "how is the business doing?" without exporting data to another tool. Existing open-source BI (Metabase, Superset, Redash) is heavyweight to self-host; db-viewr's differentiator is lightweight self-hosting in minutes, and its existing MCP server positions it for LLM-native BI later. v1 adds a BI section inside the same app — a separate UI surface sharing the adapter and connection infrastructure — starting deliberately narrow (PostgreSQL only, static queries) so the intelligence surface can grow incrementally.

## Capabilities

- id: CAP-1
  intent: User can create, name, edit, and delete a saved query bound to an existing saved PostgreSQL connection.
  success: A saved query persists across app restarts and re-executes against its connection, returning the same result shape the existing SPA query page consumes.

- id: CAP-2
  intent: User can turn a saved query's result set into a chart by choosing a chart type (bar, line, area, pie, number tile) and mapping result columns to chart dimensions (x, y, series).
  success: For a query returning tabular rows, each chart type renders correctly from the stored column mapping without re-specifying it on reload.

- id: CAP-3
  intent: User can compose dashboards by pinning charts onto a named dashboard, rearranging and resizing them on a grid, and view the dashboard with fresh data.
  success: Opening a dashboard re-runs every pinned chart's query on load and renders current results; drag/resize layout changes and dashboards persist across restarts.

- id: CAP-4
  intent: BI query execution can never mutate data, enforced by the database rather than by inspecting query text.
  success: A saved query containing INSERT/UPDATE/DELETE/DDL fails at execution time with a database error (read-only transaction), demonstrably without any SQL parsing in the BI code path.

- id: CAP-5
  intent: BI reuses the app's existing saved connections; users do not configure connections twice.
  success: Every PostgreSQL connection saved in the existing connections UI is selectable when creating a BI saved query, with no BI-specific connection store.

## Constraints

- PostgreSQL only in v1. The BI surface must not offer non-Postgres connections even though the adapter layer supports MySQL, SQLite, MongoDB, DynamoDB.
- Same Flask app and same React SPA build. BI is new routes under `/app/bi` and new endpoints under `/api/bi/…` — not a separate service, repo, or frontend build.
- Reuse `adapters/` and `storage.py` connections as-is; BI executes through the same `get_adapter()` path as the existing query editor.
- Read-only enforcement at the transaction level (`SET TRANSACTION READ ONLY` or session read-only), not query-text inspection.
- Static queries only: no query parameters, no dashboard-level filters or variable substitution.
- Refresh on dashboard load only: no server-side result caching, no scheduled refresh.
- BI objects (saved queries, charts, dashboards) persist in JSON file storage alongside `connections.json` / `query_history.json`, overridable via env var for the Docker volume pattern.

## Non-goals

- Non-PostgreSQL databases (MySQL, SQLite, MongoDB, DynamoDB) — later increments.
- Parameterized queries and dashboard filters — first "innovate" item after v1.
- Server-side caching, scheduled refresh, or alerting.
- LLM/MCP-assisted query and chart authoring — the planned differentiator, explicitly after v1.
- Sharing, permissions, or multi-user concerns.
- Semantic layer or cross-database joins.
- Any BI presence in the legacy Jinja UI; BI is SPA-only.

## Success signal

A user with a saved PostgreSQL connection writes and saves a SELECT, maps it to a chart, pins the chart to a dashboard, restarts the app, reopens the dashboard, and sees the chart rendered from freshly re-run data — while the same flow with an UPDATE statement fails with a database read-only error.

## Assumptions

- Recharts is the charting library (suggested during discussion; not explicitly confirmed).
- Single JSON storage file (e.g. `bi_storage.json`) holding all three object types, matching the app's existing flat-file persistence style.
