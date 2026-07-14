---
title: 'BI Dashboards v1 (PostgreSQL-only)'
type: 'feature'
created: '2026-07-14'
status: 'done'
baseline_commit: 'c58d9026cd32e568fda19eeea800fe6a4734fbc6'
context: ['docs/specs/spec-bi-dashboards/SPEC.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** db-viewr users can browse rows but cannot answer aggregate "how is the business doing?" questions without exporting to another tool (SPEC-bi-dashboards, Why).

**Approach:** Add a BI section in the same Flask app + React SPA: saved queries bound to existing PostgreSQL connections → charts (Recharts) → drag/resize dashboards that re-run their queries on load. Read-only enforced by the database, not by SQL parsing.

## Boundaries & Constraints

**Always:**
- PostgreSQL connections only; server rejects BI execution against any other connection type.
- BI query execution runs in a read-only psycopg2 session (`set_session(readonly=True)`) — CAP-4.
- Reuse existing `get_adapter()` path, `storage.py` connections, and `apiFetch` wrapper; match existing route/error conventions (plain `@app.route`, `{"error": ...}` JSON).
- BI objects persist to one JSON file, path overridable via `BI_STORAGE_FILE` env var (Docker volume pattern).
- Chart set: bar, line, area, pie, number tile. Dashboards are drag/resize-editable and layouts persist.

**Ask First:**
- Any new npm dependency beyond `recharts` and `react-grid-layout`.
- Any change to existing endpoints' request/response shapes.

**Never:**
- No parameterized queries, dashboard filters, caching, scheduled refresh, LLM features, sharing/permissions (SPEC non-goals).
- No BI in the legacy Jinja UI.
- No SQL text inspection for write-blocking.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Run saved SELECT | valid query id | `{columns, rows, error: null, elapsed_ms}` (same shape as existing `/query`) | N/A |
| Run write statement | saved query containing UPDATE | DB rejects (read-only session); error returned inline | `error` string, HTTP 200 (matches `/query` convention) |
| Run vs non-pg connection | saved query whose connection is mysql/sqlite/etc. | rejected before execution | `{"error": ...}`, 400 |
| Deleted connection | saved query whose conn_id no longer exists | rejected | `{"error": "Connection not found"}`, 404 |
| Deleted query behind a chart | dashboard references chart whose query was deleted | dashboard renders other tiles; broken tile shows inline error | per-tile error state, no crash |
| Corrupt/missing bi_storage.json | file absent or invalid JSON | treated as empty store | swallow like `load_query_history` |
| Empty result set | SELECT returning 0 rows | chart tile renders "no data" placeholder | N/A |

</frozen-after-approval>

## Code Map

- `adapters/postgres.py:9-17` -- `connect()`; add `readonly: bool = False` kwarg → `set_session(readonly=True)`
- `app.py:755-799` -- `api_run_query`; the run-path pattern (adapter lifecycle, inline-error response) to mirror
- `app.py:49-52,68-95` -- env-override + JSON load/save pattern for the new BI store
- `storage.py` -- `load_connections`; BI reuses it, filters `type == "postgresql"`
- `bi_storage.py` (new) -- load/save BI store: `{queries: {}, charts: {}, dashboards: {}}`
- `frontend/src/App.tsx:18-37` -- add top-level routes `bi`, `bi/queries/:id`, `bi/d/:id` under `AppLayout`
- `frontend/src/layout/AppLayout.tsx` -- add BI nav entry (top-level, not per-connection sidebar)
- `frontend/src/lib/api.ts` -- `apiFetch` wrapper; `frontend/src/lib/types.ts` -- add BI types
- `frontend/src/pages/QueryPage.tsx:38-57,143-177` -- mutation pattern + results `<table>`/`renderCell` to reuse
- `frontend/src/pages/bi/` (new) -- `BiHomePage` (dashboards+queries list), `BiQueryPage` (editor + chart builder), `BiDashboardPage` (react-grid-layout)
- `frontend/src/components/bi/ChartRenderer.tsx` (new) -- Recharts renderer for the 5 chart types

## Tasks & Acceptance

**Execution:**
- [x] `adapters/postgres.py` -- add `readonly` kwarg to `connect()` -- DB-level write blocking (CAP-4)
- [x] `bi_storage.py` -- new module: load/save with `BI_STORAGE_FILE` override, corrupt-file fallback to empty -- persistence (CAP-1/2/3)
- [x] `app.py` -- add `/api/bi` endpoints: CRUD for queries/charts/dashboards; `POST /api/bi/queries/<id>/run` (404 missing conn, 400 non-pg, readonly connect, response shape of `api_run_query`); `PUT /api/bi/dashboards/<id>/layout` -- backend surface
- [x] `frontend/package.json` -- add `recharts`, `react-grid-layout` (+`@types/react-grid-layout`) -- charting + drag/resize
- [x] `frontend/src/lib/types.ts` -- `BiQuery`, `BiChart` (type, x/y/series mapping), `BiDashboard` (tiles: chart_id + x/y/w/h) -- shared contract
- [x] `frontend/src/components/bi/ChartRenderer.tsx` -- render 5 chart types from `{columns, rows}` + mapping; empty-data placeholder -- CAP-2
- [x] `frontend/src/pages/bi/*` -- three pages: list, query editor with save + column-mapping chart builder (pg connections only in picker), dashboard with grid drag/resize persisted via layout endpoint, per-tile fetch-on-mount + error state -- CAP-1/2/3/5
- [x] `frontend/src/App.tsx` + `frontend/src/layout/AppLayout.tsx` -- routes + nav entry -- discoverability
- [x] `README.md` -- document BI section + `BI_STORAGE_FILE` -- ops parity with existing env vars

**Acceptance Criteria:**
- Given a saved pg connection, when I save a SELECT, map a bar chart, pin it to a dashboard, and restart Flask, then reopening the dashboard re-runs the query and renders the chart from persisted definitions (CAP-1/2/3).
- Given a saved query containing `UPDATE`, when run via BI, then the row is unchanged in the database and the response carries a read-only error (CAP-4).
- Given connections of mixed types, when creating a BI query, then only PostgreSQL connections are offered, and the run endpoint returns 400 for a non-pg conn_id (CAP-5, pg-only constraint).
- Given a dashboard whose tiles were dragged/resized, when the page reloads, then the layout is restored (CAP-3).

## Design Notes

- Run endpoint returns errors inline at HTTP 200 like `api_run_query`, so the SPA reuses one result-handling path.
- Charts store column *names* (not indexes) for x/y/series so query edits that keep names don't break charts.
- Before writing ChartRenderer, load the `dataviz` skill (chart color/form rules).

## Verification

**Commands:**
- `uv run python -c "import app, bi_storage"` -- expected: no import errors
- `cd frontend && npm run build` -- expected: tsc + vite succeed, output in `static/dist`

**Manual checks (if no CLI):**
- Full flow against a local Postgres: save query → chart → dashboard → restart → reload; then an UPDATE query returns "read-only" error and data is unchanged.

## Suggested Review Order

**Read-only execution (the security-relevant core)**

- Readonly connect: session read-only + timeout + close-on-failure
  [`postgres.py:9`](../../adapters/postgres.py#L9)

- Readonly sessions never commit, even for multi-statement bypass attempts
  [`postgres.py:119`](../../adapters/postgres.py#L119)

- BI run endpoint: 404/400 gates, readonly connect, inline-error response shape
  [`app.py:1024`](../../app.py#L1024)

**Persistence & concurrency**

- Atomic temp-file+replace save; module lock against lost updates
  [`bi_storage.py:8`](../../bi_storage.py#L8)

- Every mutation wraps load-mutate-save in the lock
  [`app.py:967`](../../app.py#L967)

**API surface & validation**

- Query input validation: types, connection existence, pg-only at save time
  [`app.py:868`](../../app.py#L868)

- Chart mapping validation (column names as strings)
  [`app.py:891`](../../app.py#L891)

- Tile geometry bounds + duplicate-tile rejection
  [`app.py:921`](../../app.py#L921)

- CRUD endpoints start here
  [`app.py:958`](../../app.py#L958)

**Frontend**

- Chart rendering for all 5 types, dataviz-styled, pivot/collision guards
  [`ChartRenderer.tsx:64`](../../frontend/src/components/bi/ChartRenderer.tsx#L64)

- Dashboard grid: drag/resize persistence, per-tile fetch + isolated errors
  [`BiDashboardPage.tsx:90`](../../frontend/src/pages/bi/BiDashboardPage.tsx#L90)

- Query editor: pg-only picker, run/save, chart builder keyed to result columns
  [`BiQueryPage.tsx:1`](../../frontend/src/pages/bi/BiQueryPage.tsx#L1)

**Peripherals**

- New top-level routes
  [`App.tsx:34`](../../frontend/src/App.tsx#L34)

- Nav entry, README docs, .gitignore
  [`AppLayout.tsx:1`](../../frontend/src/layout/AppLayout.tsx#L1)
