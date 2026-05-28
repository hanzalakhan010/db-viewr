# SPA Migration Notes

## Decisions
- **Stack:** Vite + React + TypeScript (strict), Tailwind + shadcn/ui, React Router, TanStack Query.
- **Layout:** `frontend/` sibling to `app.py`. Build output → `static/dist/`.
- **Hosting:** Flask serves built SPA. Same-origin, no CORS.
- **Dev workflow:** Vite dev on :5173 with proxy `/api → :5000`. Two terminals.
- **Migration mode:** Additive. Existing Flask HTML routes/templates untouched. SPA mounted at `/app/*`. Legacy UI stays at `/` — no flip planned.
- **API:** New `/api/*` JSON endpoints added alongside current HTML routes.
- **Routing (SPA):**
  - `/app/` → connections
  - `/app/c/:conn` → tables list
  - `/app/c/:conn/t/:table` → table view
  - `/app/c/:conn/query` → query runner
  - `/app/c/:conn/erd` → ERD
- **Visual:** Keep current look. Port styles to Tailwind utilities matching existing palette/spacing.
- **State storage:** `connections.json` stays. Query history file stays.
- **Auth:** None (single-user local app).
- **Long ops:** Plain JSON + spinner. API-side pagination/limits for table view.

## Open / deferred

### How the React bundle gets onto Flask in production

**Current setup (chosen):** Flask reads `static/dist/index.html` + `static/dist/assets/*` from the filesystem and serves them via a custom route (`app.py` `spa()`). Build artifacts live at `static/dist/` and are **committed to git** so `uv run app.py` works on a fresh clone with no Node required. Frontend devs run `npm run build` before committing.

**Alternative ways to mount the bundle on Flask** — for reference when we revisit Docker:

1. **Multi-stage Dockerfile (preferred for prod images).**
   Stage 1 = `node:lts` runs `npm ci && npm run build` inside `frontend/`, producing `static/dist/`.
   Stage 2 = `python:3.12-slim` copies the python source + the built `static/dist/` from stage 1.
   Pros: clean repo (no committed bundle), reproducible, no node in final image.
   Cons: longer image build; need npm cache for speed.

2. **Commit `static/dist/` to git, skip node entirely.**
   Just `git add -f static/dist/` after each release build; Dockerfile stays python-only.
   Pros: dead-simple Docker; works offline.
   Cons: dirty diffs on every build; merge conflicts in minified JS; bundle becomes part of code review.

3. **Flask `send_from_directory` with `static_folder="static/dist"` (no custom route).**
   Init Flask as `Flask(__name__, static_folder="static/dist", static_url_path="/app")`. Skip the manual `spa()` view — Flask's built-in static handler serves files. Add a single catch-all route to fallback to `index.html` for client-side routing.
   Pros: less code; uses Flask's built-in.
   Cons: loses the explicit fallback logic; harder to gate (e.g. auth) the SPA shell. Also conflicts with existing `static/` content being served at `/static/*` — would need to keep that and use a different `static_url_path` or restructure.

4. **Run Vite/Nginx in front, Flask only serves /api.**
   Nginx routes `/api/*` to gunicorn, everything else to a static dir. Flask drops the SPA-serving route entirely.
   Pros: best perf, gzip/brotli, caching headers, CDN-friendly.
   Cons: new piece of infra; not needed at current scale.

5. **Build to a CDN, Flask serves only `index.html` (with the asset URLs pointing at the CDN).**
   `vite build --base https://cdn.example.com/db-viewr/...`. Flask's `index.html` references those URLs.
   Pros: offload bandwidth; cache busting via hashed filenames.
   Cons: extra deploy step; only worth it at scale.

6. **Embed the bundle inside the Python wheel.**
   Package `static/dist/` as wheel data via `pyproject.toml`. `pip install db-viewr` ships the SPA. Useful if distributing as a Python tool.
   Pros: one artifact; one command to install/run.
   Cons: bundles change on every frontend tweak → wheel rebuild every release.

Current pick is essentially #1 once we wire Docker. Until then, dev = `npm run build` locally + Flask reads from disk.

## Task plan
Phase 0 — scaffolding (additive, no behavior change)
Phase 1 — connections API + SPA
Phase 2 — tables list API + SPA
Phase 3 — table view API + SPA (rows, filters, sort, page, edit, insert)
Phase 4 — query runner API + SPA (+ history)
Phase 5 — ERD API + SPA
~~Phase 6~~ — not happening. SPA + legacy coexist permanently.
