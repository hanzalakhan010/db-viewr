import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type {
  ConnectionResponse,
  ErdResponse,
  JoinType,
  SavedView,
  ViewColumn,
  ViewFilterCondition,
  ViewJoin,
  ViewRunResponse,
  ViewSpec,
} from '@/lib/types'
import { Loading } from '@/components/Spinner'
import { useConnectionName } from '@/lib/useConnection'
import { ViewCanvas } from './ViewCanvas'

const SQL_TYPES = ['postgresql', 'mysql', 'sqlite']
const FILTER_OPS = [
  '=', '!=', '>', '<', '>=', '<=',
  'like', 'contains', 'starts_with', 'ends_with', 'is_null', 'is_not_null', 'in',
]
const NO_VALUE_OPS = new Set(['is_null', 'is_not_null'])

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

interface Cond {
  key: string // "table.column"
  op: string
  value: string
}

export function ViewBuilderPage() {
  const { conn, vid } = useParams<{ conn: string; vid?: string }>()
  const [params] = useSearchParams()
  const baseParam = params.get('base') ?? undefined
  const connName = useConnectionName(conn)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: connData } = useQuery({
    queryKey: ['connection', conn],
    queryFn: () => apiFetch<ConnectionResponse>(`connections/${conn}`),
    enabled: !!conn,
  })
  const isSql = connData ? SQL_TYPES.includes(connData.connection.db_type) : true

  const { data: erdData, isLoading: erdLoading, error: erdError } = useQuery({
    queryKey: ['erd', conn],
    queryFn: () => apiFetch<ErdResponse>(`connections/${conn}/erd`),
    enabled: !!conn && isSql,
  })

  const { data: viewData } = useQuery({
    queryKey: ['view', conn, vid],
    queryFn: () => apiFetch<SavedView>(`connections/${conn}/views/${vid}`),
    enabled: !!conn && !!vid,
  })

  // ── Editable spec state ──────────────────────────────────────────────────
  const [name, setName] = useState('')
  const [baseTable, setBaseTable] = useState('')
  const [joins, setJoins] = useState<ViewJoin[]>([])
  const [columns, setColumns] = useState<ViewColumn[]>([])
  const [conds, setConds] = useState<Cond[]>([])
  const [combinator, setCombinator] = useState<'AND' | 'OR'>('AND')
  const [selectedTable, setSelectedTable] = useState<string | null>(null)

  const erdTables = erdData?.erd.tables ?? {}
  const columnsOf = (t: string): string[] => (erdTables[t]?.columns ?? []).map((c) => c.name)

  // Seed once, from a saved view (edit) or ?base= / first table (new).
  const initRef = useRef(false)
  useEffect(() => {
    if (initRef.current) return
    if (vid) {
      if (!viewData) return
      const s = viewData.spec
      setName(viewData.name)
      setBaseTable(s.base_table)
      setJoins(s.joins ?? [])
      setColumns(s.columns ?? [])
      if (s.filters?.conditions) {
        setCombinator(s.filters.combinator ?? 'AND')
        setConds(
          s.filters.conditions.map((c) => ({
            key: `${c.table ?? s.base_table}.${c.column}`,
            op: c.op,
            value: c.value ?? '',
          })),
        )
      }
      setSelectedTable(s.base_table)
      initRef.current = true
    } else if (erdData) {
      const names = Object.keys(erdTables)
      const base = baseParam && erdTables[baseParam] ? baseParam : names[0]
      if (!base) return
      setBaseTable(base)
      setColumns(columnsOf(base).map((c) => ({ table: base, column: c })))
      setName(`${base} view`)
      setSelectedTable(base)
      initRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vid, viewData, erdData, baseParam])

  // ── Derived ─────────────────────────────────────────────────────────────
  const includedTables = useMemo(() => {
    const order: string[] = baseTable ? [baseTable] : []
    const seen = new Set(order)
    for (const j of joins) {
      for (const t of [j.from_table, j.to_table]) {
        if (t && !seen.has(t)) {
          seen.add(t)
          order.push(t)
        }
      }
    }
    return order
  }, [baseTable, joins])

  const colSet = useMemo(
    () => new Set(columns.map((c) => `${c.table}.${c.column}`)),
    [columns],
  )

  // "Add related" chips: FK neighbours of any included table not yet in view.
  const relatedChips = useMemo(() => {
    if (!erdData) return [] as Array<{ key: string; label: string; title: string; target: string; join: ViewJoin }>
    const included = new Set(includedTables)
    const out: Array<{ key: string; label: string; title: string; target: string; join: ViewJoin }> = []
    const seen = new Set<string>()
    const push = (target: string, join: ViewJoin, dir: '→' | '←', title: string) => {
      const key = `${join.from_table}.${join.from_col}->${join.to_table}.${join.to_col}`
      if (included.has(target) || seen.has(key)) return
      seen.add(key)
      out.push({ key, label: `${dir} ${target}`, title, target, join })
    }
    for (const t of includedTables) {
      for (const fk of erdTables[t]?.foreign_keys ?? []) {
        push(
          fk.ref_table,
          { from_table: t, from_col: fk.column, to_table: fk.ref_table, to_col: fk.ref_column, join_type: 'left' },
          '→',
          `${t}.${fk.column} → ${fk.ref_table}.${fk.ref_column}`,
        )
      }
    }
    for (const [s, tbl] of Object.entries(erdTables)) {
      if (included.has(s)) continue
      for (const fk of tbl.foreign_keys ?? []) {
        if (!included.has(fk.ref_table)) continue
        push(
          s,
          { from_table: s, from_col: fk.column, to_table: fk.ref_table, to_col: fk.ref_column, join_type: 'left' },
          '←',
          `${s}.${fk.column} → ${fk.ref_table}.${fk.ref_column} (referrers)`,
        )
      }
    }
    return out
  }, [erdData, includedTables]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mutators ──────────────────────────────────────────────────────────────
  const resetBase = (t: string) => {
    setBaseTable(t)
    setJoins([])
    setColumns(columnsOf(t).map((c) => ({ table: t, column: c })))
    setConds([])
    setSelectedTable(t)
  }

  const addRelated = (chip: { target: string; join: ViewJoin }) => {
    setJoins((j) => [...j, chip.join])
    setColumns((cols) => {
      const have = new Set(cols.map((c) => `${c.table}.${c.column}`))
      const add = columnsOf(chip.target)
        .map((c) => ({ table: chip.target, column: c }))
        .filter((c) => !have.has(`${c.table}.${c.column}`))
      return [...cols, ...add]
    })
    setSelectedTable(chip.target)
  }

  const setJoinType = (index: number, jt: JoinType) =>
    setJoins((j) => j.map((x, i) => (i === index ? { ...x, join_type: jt } : x)))

  const removeJoin = (index: number) => {
    const next = joins.filter((_, i) => i !== index)
    // Prune anything left disconnected from the base.
    const reachable = new Set([baseTable])
    let changed = true
    while (changed) {
      changed = false
      for (const j of next) {
        if (reachable.has(j.from_table) && !reachable.has(j.to_table)) {
          reachable.add(j.to_table)
          changed = true
        }
        if (reachable.has(j.to_table) && !reachable.has(j.from_table)) {
          reachable.add(j.from_table)
          changed = true
        }
      }
    }
    setJoins(next.filter((j) => reachable.has(j.from_table) && reachable.has(j.to_table)))
    setColumns((cols) => cols.filter((c) => reachable.has(c.table)))
    setConds((cs) => cs.filter((c) => reachable.has(c.key.slice(0, c.key.lastIndexOf('.')))))
  }

  const toggleColumn = (table: string, column: string) => {
    const key = `${table}.${column}`
    setColumns((cols) =>
      colSet.has(key)
        ? cols.filter((c) => `${c.table}.${c.column}` !== key)
        : [...cols, { table, column }],
    )
  }

  const setAllColumns = (table: string, on: boolean) =>
    setColumns((cols) => {
      const others = cols.filter((c) => c.table !== table)
      return on ? [...others, ...columnsOf(table).map((c) => ({ table, column: c }))] : others
    })

  // ── Assembled spec ──────────────────────────────────────────────────────
  const spec: ViewSpec = useMemo(() => {
    const conditions: ViewFilterCondition[] = conds
      .filter((c) => c.key)
      .map((c) => {
        const dot = c.key.lastIndexOf('.')
        return {
          table: c.key.slice(0, dot),
          column: c.key.slice(dot + 1),
          op: c.op,
          value: NO_VALUE_OPS.has(c.op) ? undefined : c.value,
        }
      })
    return {
      base_table: baseTable,
      joins,
      columns,
      filters: conditions.length ? { advanced: true, combinator, conditions } : null,
    }
  }, [baseTable, joins, columns, conds, combinator])

  // ── Run + Save ────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1)
  const pageSize = 50
  const runMut = useMutation({
    mutationFn: (p: number) =>
      apiFetch<ViewRunResponse>(`connections/${conn}/views/run`, {
        method: 'POST',
        body: JSON.stringify({ spec, page: p, page_size: pageSize }),
      }),
  })
  const goPage = (p: number) => {
    setPage(p)
    runMut.mutate(p)
  }

  const saveMut = useMutation({
    mutationFn: () =>
      vid
        ? apiFetch<SavedView>(`connections/${conn}/views/${vid}`, {
            method: 'PUT',
            body: JSON.stringify({ name, spec }),
          })
        : apiFetch<SavedView>(`connections/${conn}/views`, {
            method: 'POST',
            body: JSON.stringify({ name, spec }),
          }),
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['views', conn] })
      if (!vid) navigate(`/c/${conn}/views/${v.id}`, { replace: true })
    },
  })

  const canRun = !!baseTable && columns.length > 0
  const result = runMut.data
  const runError = (runMut.error as Error | null)?.message ?? result?.error ?? null

  if (!isSql) {
    return (
      <div>
        <Breadcrumb conn={conn} connName={connName} />
        <div className="rounded-lg border border-border bg-surface p-6 text-text-secondary">
          Views are only available on SQL connections (PostgreSQL, MySQL, SQLite).
        </div>
      </div>
    )
  }

  if (erdLoading || (vid && !viewData)) {
    return (
      <div>
        <Breadcrumb conn={conn} connName={connName} />
        <div className="rounded-lg border border-border bg-surface p-6"><Loading /></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Breadcrumb conn={conn} connName={connName} editing={!!vid} />

      {erdError && (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {(erdError as Error).message}
        </div>
      )}

      {/* Header: name + base + save */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex-1 min-w-[16rem]">
          <label className="block text-xs text-text-secondary">View name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My joined view"
            className="w-full rounded border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-xs text-text-secondary">Base table</label>
          <select
            value={baseTable}
            onChange={(e) => resetBase(e.target.value)}
            disabled={joins.length > 0}
            title={joins.length > 0 ? 'Remove joins to change the base table' : undefined}
            className="rounded border border-border bg-bg px-2 py-1 text-sm disabled:opacity-50"
          >
            {Object.keys(erdTables).sort().map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={!name.trim() || !canRun || saveMut.isPending}
          onClick={() => saveMut.mutate()}
          className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saveMut.isPending ? 'Saving…' : vid ? 'Update view' : 'Save view'}
        </button>
      </div>

      {saveMut.error && (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {(saveMut.error as Error).message}
        </div>
      )}

      {/* Canvas */}
      <div>
        <div className="mb-1 text-xs uppercase tracking-wide text-muted">Relationships</div>
        <ViewCanvas
          spec={spec}
          selectedTable={selectedTable}
          onSelectTable={setSelectedTable}
          onSetJoinType={setJoinType}
          onRemoveJoin={removeJoin}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-secondary">Add related:</span>
          {relatedChips.length === 0 ? (
            <span className="text-xs text-muted">no more related tables</span>
          ) : (
            relatedChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                title={chip.title}
                onClick={() => addRelated(chip)}
                className="rounded-full border border-border bg-surface px-2.5 py-1 font-mono text-xs text-text hover:border-accent hover:text-accent"
              >
                {chip.label}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Columns + Filters */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-muted">Columns</div>
          <div className="space-y-3">
            {includedTables.map((t) => {
              const all = columnsOf(t)
              const selCount = all.filter((c) => colSet.has(`${t}.${c}`)).length
              return (
                <div
                  key={t}
                  className={`rounded border p-2 ${selectedTable === t ? 'border-accent/60' : 'border-border-light'}`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-xs text-text">{t}</span>
                    <span className="flex items-center gap-2 text-[10px] text-text-secondary">
                      <button type="button" className="hover:text-accent" onClick={() => setAllColumns(t, true)}>all</button>
                      <button type="button" className="hover:text-accent" onClick={() => setAllColumns(t, false)}>none</button>
                      <span>{selCount}/{all.length}</span>
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {all.map((c) => (
                      <label key={c} className="flex items-center gap-1 font-mono text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={colSet.has(`${t}.${c}`)}
                          onChange={() => toggleColumn(t, c)}
                        />
                        {c}
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted">Filters</span>
            {conds.length > 1 && (
              <select
                value={combinator}
                onChange={(e) => setCombinator(e.target.value as 'AND' | 'OR')}
                className="rounded border border-border bg-bg px-1 py-0.5 text-xs"
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            )}
          </div>
          <div className="space-y-2">
            {conds.map((cond, i) => (
              <div key={i} className="flex items-center gap-1">
                <select
                  value={cond.key}
                  onChange={(e) => setConds((cs) => cs.map((c, j) => (j === i ? { ...c, key: e.target.value } : c)))}
                  className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-1 font-mono text-xs"
                >
                  <option value="">column…</option>
                  {includedTables.flatMap((t) =>
                    columnsOf(t).map((c) => (
                      <option key={`${t}.${c}`} value={`${t}.${c}`}>{t}.{c}</option>
                    )),
                  )}
                </select>
                <select
                  value={cond.op}
                  onChange={(e) => setConds((cs) => cs.map((c, j) => (j === i ? { ...c, op: e.target.value } : c)))}
                  className="rounded border border-border bg-bg px-1 py-1 text-xs"
                >
                  {FILTER_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                </select>
                <input
                  value={cond.value}
                  disabled={NO_VALUE_OPS.has(cond.op)}
                  onChange={(e) => setConds((cs) => cs.map((c, j) => (j === i ? { ...c, value: e.target.value } : c)))}
                  placeholder="value"
                  className="w-24 rounded border border-border bg-bg px-1 py-1 text-xs disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={() => setConds((cs) => cs.filter((_, j) => j !== i))}
                  className="text-xs text-danger"
                  aria-label="Remove condition"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setConds((cs) => [...cs, { key: '', op: '=', value: '' }])}
              className="text-xs text-info hover:underline"
            >
              + add condition
            </button>
          </div>
        </div>
      </div>

      {/* Run + results */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canRun || runMut.isPending}
          onClick={() => goPage(1)}
          className="rounded bg-accent px-4 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {runMut.isPending ? 'Running…' : 'Run'}
        </button>
        {!canRun && <span className="text-xs text-muted">Pick a base table and at least one column.</span>}
        {result?.elapsed_ms != null && (
          <span className="rounded bg-border-light px-2 py-0.5 font-mono text-xs">{result.elapsed_ms} ms</span>
        )}
      </div>

      {runError && (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {runError}
        </div>
      )}

      {result && !result.error && (
        <>
          <div className="overflow-auto rounded-lg border border-border bg-surface">
            {result.rows.length === 0 ? (
              <div className="p-6 text-text-secondary">No rows.</div>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="bg-bg">
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c} className="border-b border-border px-3 py-2 text-left font-mono text-xs text-text-secondary">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b border-border-light hover:bg-border-light/40">
                      {row.map((v, j) => (
                        <td key={j} className="whitespace-nowrap px-3 py-1 font-mono text-xs">
                          {v === null ? <span className="text-muted italic">NULL</span> : renderCell(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-text-secondary">
            <button
              type="button"
              disabled={page <= 1 || runMut.isPending}
              onClick={() => goPage(page - 1)}
              className="rounded border border-border px-3 py-1 disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={!result.has_next || runMut.isPending}
              onClick={() => goPage(page + 1)}
              className="rounded border border-border px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
            <span>Page {page}</span>
            <span>Showing {result.rows.length} rows</span>
          </div>
        </>
      )}
    </div>
  )
}

function Breadcrumb({ conn, connName, editing }: { conn?: string; connName: string; editing?: boolean }) {
  return (
    <nav className="text-sm text-text-secondary">
      <Link to={`/c/${conn}`} className="text-info hover:underline">{connName}</Link>
      <span className="mx-2">/</span>
      <Link to={`/c/${conn}/views`} className="text-info hover:underline">Views</Link>
      <span className="mx-2">/</span>
      <span>{editing ? 'Edit' : 'New'}</span>
    </nav>
  )
}
