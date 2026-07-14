# Deferred work

## From spec-bi-dashboards-v1 review (2026-07-14)

- **Result-size cap on BI run endpoint** — a saved `SELECT * FROM huge_table` pinned to a dashboard serializes the full result set on every load; consider server-side row truncation (with a `truncated` flag) or statement_timeout tuning.
- **Request dedup across dashboard tiles** — tiles sharing the same saved query each fire their own `/run`; could share one fetch per query per load.
- **App-wide authentication** — pre-existing: no auth anywhere in db-viewr; BI endpoints follow suit. Matters if ever exposed beyond localhost/trusted networks.
- **Entry-level bi_storage validation** — `load_bi_store` validates top-level shape only; a hand-edited store with a non-dict entry can still 500 individual endpoints.
- **Read-only DB role guidance** — README now recommends it; a first-class "read-only credentials per connection" feature would make CAP-4 a hard guarantee.
