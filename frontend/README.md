# frontend

SPA (React + TS + Tailwind + React Router + TanStack Query) that will
gradually replace the Flask-rendered HTML pages.

## Dev (two terminals)

```bash
# terminal 1 — Flask (legacy UI + new /api/* endpoints)
uv run flask --app app run

# terminal 2 — Vite dev server with HMR, proxies /api → :5000
cd frontend
npm run dev
# open http://localhost:5173/app/
```

## Build

```bash
cd frontend
npm run build      # outputs to ../static/dist/
```

Then visit http://localhost:5000/app/ — Flask serves the built bundle.
Legacy UI remains at `/`.

See `../MIGRATION_NOTES.md` for the phased plan.
