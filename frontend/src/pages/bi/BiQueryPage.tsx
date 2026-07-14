import { useState, type KeyboardEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type {
  BiChart,
  BiChartResponse,
  BiChartsResponse,
  BiChartType,
  BiDashboard,
  BiDashboardsResponse,
  BiQuery,
  BiQueryResponse,
  ConnectionsResponse,
  QueryResult,
} from '@/lib/types'
import { BI_CHART_TYPE_LABELS } from '@/lib/types'
import { ChartRenderer } from '@/components/bi/ChartRenderer'
import { Spinner } from '@/components/Spinner'

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

const selectCls =
  'rounded border border-border bg-surface px-2 py-1 text-sm focus:border-accent focus:outline-none'

export function BiQueryPage() {
  const { id } = useParams<{ id: string }>()
  const isNew = id === 'new'

  const { data: queryData, error: queryError } = useQuery({
    queryKey: ['biQuery', id],
    queryFn: () => apiFetch<BiQueryResponse>(`bi/queries/${id}`),
    enabled: !isNew && !!id,
  })

  if (queryError) {
    return (
      <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
        {queryError instanceof Error ? queryError.message : 'Query not found'}
      </div>
    )
  }
  if (!isNew && !queryData) return <Spinner />

  return <BiQueryEditor key={id} id={id!} isNew={isNew} initial={queryData?.query} />
}

function BiQueryEditor({
  id,
  isNew,
  initial,
}: {
  id: string
  isNew: boolean
  initial: BiQuery | undefined
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [name, setName] = useState(initial?.name ?? '')
  const [connId, setConnId] = useState(initial?.conn_id ?? '')
  const [sql, setSql] = useState(initial?.sql ?? '')
  const [result, setResult] = useState<QueryResult | null>(null)

  const { data: connData } = useQuery({
    queryKey: ['connections'],
    queryFn: () => apiFetch<ConnectionsResponse>('connections'),
  })
  const pgConns = (connData?.connections ?? []).filter((c) => c.db_type === 'postgresql')

  const { data: chartsData } = useQuery({
    queryKey: ['biCharts'],
    queryFn: () => apiFetch<BiChartsResponse>('bi/charts'),
  })
  const charts = (chartsData?.charts ?? []).filter((c) => c.query_id === id)

  const { data: dashData } = useQuery({
    queryKey: ['biDashboards'],
    queryFn: () => apiFetch<BiDashboardsResponse>('bi/dashboards'),
  })
  const dashboards = dashData?.dashboards ?? []

  const saveMut = useMutation({
    mutationFn: () =>
      apiFetch<BiQueryResponse>(isNew ? 'bi/queries' : `bi/queries/${id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: JSON.stringify({ name: name.trim(), conn_id: connId, sql }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['biQueries'] })
      qc.setQueryData(['biQuery', res.query.id], res)
      if (isNew) navigate(`/bi/queries/${res.query.id}`, { replace: true })
    },
  })

  const runMut = useMutation({
    // Persist edits first so the run endpoint executes what's on screen.
    mutationFn: async () => {
      await apiFetch<BiQueryResponse>(`bi/queries/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim(), conn_id: connId, sql }),
      })
      qc.invalidateQueries({ queryKey: ['biQueries'] })
      return apiFetch<QueryResult>(`bi/queries/${id}/run`, { method: 'POST' })
    },
    onSuccess: (res) => setResult(res),
    onError: (e: unknown) =>
      setResult({
        columns: [],
        rows: [],
        affected: null,
        error: e instanceof Error ? e.message : 'Request failed',
        elapsed_ms: null,
      }),
  })

  const canSave = !!name.trim() && !!connId
  const run = () => {
    if (isNew || !canSave || runMut.isPending) return
    runMut.mutate()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      run()
    }
  }

  const cols = result?.columns ?? []
  const rows = result?.rows ?? []

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="mb-4 text-sm text-text-secondary">
        <Link to="/bi" className="text-info hover:underline">
          BI
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text">{isNew ? 'New query' : name || 'Query'}</span>
      </nav>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Query name"
          className="w-64 rounded border border-border bg-surface px-2 py-1 text-sm focus:border-accent focus:outline-none"
        />
        <select value={connId} onChange={(e) => setConnId(e.target.value)} className={selectCls}>
          <option value="">— PostgreSQL connection —</option>
          {pgConns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {pgConns.length === 0 && (
          <span className="text-xs text-muted">No PostgreSQL connections saved yet.</span>
        )}
      </div>

      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={onKeyDown}
        rows={8}
        spellCheck={false}
        className="w-full rounded-lg border border-border bg-surface p-3 font-mono text-sm focus:border-accent focus:outline-none"
        placeholder="-- SELECT ... (runs in a read-only session)"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => saveMut.mutate()}
          disabled={!canSave || saveMut.isPending}
          className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {saveMut.isPending ? 'Saving…' : 'Save query'}
        </button>
        <button
          type="button"
          onClick={run}
          disabled={isNew || !canSave || runMut.isPending}
          title={isNew ? 'Save the query first' : undefined}
          className="rounded border border-border bg-surface px-3 py-1.5 text-sm hover:border-accent disabled:opacity-50"
        >
          {runMut.isPending ? (
            <span className="inline-flex items-center gap-2">
              <Spinner /> Running…
            </span>
          ) : (
            'Run'
          )}
        </button>
        {result?.elapsed_ms != null && (
          <span className="rounded bg-border-light px-2 py-0.5 font-mono text-xs text-text-secondary">
            {result.elapsed_ms} ms
          </span>
        )}
        {saveMut.error && (
          <span className="text-xs text-danger">
            {saveMut.error instanceof Error ? saveMut.error.message : 'Save failed'}
          </span>
        )}
      </div>

      <div className="mt-4">
        {result?.error ? (
          <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            <strong>Error:</strong> {result.error}
          </div>
        ) : result && cols.length > 0 ? (
          <div className="max-h-80 overflow-auto rounded-lg border border-border bg-surface">
            <table className="min-w-full text-sm">
              <thead className="bg-bg">
                <tr>
                  {cols.map((c) => (
                    <th
                      key={c}
                      className="border-b border-border px-3 py-2 text-left font-mono text-xs text-text-secondary"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-border-light hover:bg-border-light/40">
                    {row.map((v, j) => (
                      <td key={j} className="whitespace-nowrap px-3 py-1 font-mono text-xs">
                        {v === null ? (
                          <span className="text-muted italic">NULL</span>
                        ) : (
                          renderCell(v)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-border-light px-3 py-1.5 text-xs text-text-secondary">
              {rows.length} row{rows.length === 1 ? '' : 's'}
            </div>
          </div>
        ) : result ? (
          <div className="rounded border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
            Query OK — no rows returned
          </div>
        ) : null}
      </div>

      {!isNew && result && cols.length > 0 && !result.error && (
        // Keyed on the column set so stale x/y/series picks reset when a new
        // run returns different columns.
        <ChartBuilder key={cols.join(' ')} queryId={id} result={result} />
      )}

      {!isNew && charts.length > 0 && (
        <ChartList charts={charts} dashboards={dashboards} result={result} />
      )}
    </div>
  )
}

function ChartBuilder({ queryId, result }: { queryId: string; result: QueryResult }) {
  const qc = useQueryClient()
  const cols = result.columns
  const [chartName, setChartName] = useState('')
  const [type, setType] = useState<BiChartType>('bar')
  const [x, setX] = useState(cols[0] ?? '')
  const [y, setY] = useState(cols[1] ?? cols[0] ?? '')
  const [series, setSeries] = useState('')

  const saveChartMut = useMutation({
    mutationFn: () =>
      apiFetch<BiChartResponse>('bi/charts', {
        method: 'POST',
        body: JSON.stringify({
          name: chartName.trim(),
          query_id: queryId,
          type,
          x,
          y,
          ...(series ? { series } : {}),
        }),
      }),
    onSuccess: () => {
      setChartName('')
      qc.invalidateQueries({ queryKey: ['biCharts'] })
    },
  })

  const needsX = type !== 'number'
  const canSave = !!chartName.trim() && !!y && (!needsX || !!x)

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-medium">Chart builder</h2>
      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <input
            value={chartName}
            onChange={(e) => setChartName(e.target.value)}
            placeholder="Chart name"
            className="w-48 rounded border border-border bg-surface px-2 py-1 focus:border-accent focus:outline-none"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as BiChartType)}
            className={selectCls}
          >
            {Object.entries(BI_CHART_TYPE_LABELS).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          {needsX && (
            <label className="flex items-center gap-1 text-xs text-text-secondary">
              x
              <select value={x} onChange={(e) => setX(e.target.value)} className={selectCls}>
                {cols.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          <label className="flex items-center gap-1 text-xs text-text-secondary">
            y
            <select value={y} onChange={(e) => setY(e.target.value)} className={selectCls}>
              {cols.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {(type === 'bar' || type === 'line' || type === 'area') && (
            <label className="flex items-center gap-1 text-xs text-text-secondary">
              series
              <select
                value={series}
                onChange={(e) => setSeries(e.target.value)}
                className={selectCls}
              >
                <option value="">—</option>
                {cols.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            onClick={() => saveChartMut.mutate()}
            disabled={!canSave || saveChartMut.isPending}
            className="rounded bg-accent px-3 py-1 text-white hover:bg-accent-hover disabled:opacity-50"
          >
            Save chart
          </button>
          {saveChartMut.error && (
            <span className="text-xs text-danger">
              {saveChartMut.error instanceof Error ? saveChartMut.error.message : 'Save failed'}
            </span>
          )}
        </div>
        <div className="h-72">
          <ChartRenderer
            type={type}
            x={x}
            y={y}
            series={series || undefined}
            columns={result.columns}
            rows={result.rows}
          />
        </div>
      </div>
    </section>
  )
}

function ChartList({
  charts,
  dashboards,
  result,
}: {
  charts: BiChart[]
  dashboards: BiDashboard[]
  result: QueryResult | null
}) {
  const qc = useQueryClient()

  const addToDashMut = useMutation({
    mutationFn: ({ chart, dash }: { chart: BiChart; dash: BiDashboard }) => {
      const maxY = dash.tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0)
      return apiFetch<null>(`bi/dashboards/${dash.id}/layout`, {
        method: 'PUT',
        body: JSON.stringify({
          tiles: [...dash.tiles, { chart_id: chart.id, x: 0, y: maxY, w: 6, h: 4 }],
        }),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['biDashboards'] }),
  })

  const deleteChartMut = useMutation({
    mutationFn: (chartId: string) => apiFetch<null>(`bi/charts/${chartId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['biCharts'] })
      qc.invalidateQueries({ queryKey: ['biDashboards'] })
    },
  })

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-medium">Saved charts</h2>
      <div className="space-y-2">
        {charts.map((chart) => (
          <div key={chart.id} className="rounded-lg border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>
                {chart.name}{' '}
                <span className="text-xs text-muted">({BI_CHART_TYPE_LABELS[chart.type]})</span>
              </span>
              <div className="flex items-center gap-2 text-xs">
                {(() => {
                  // A chart can only appear once per dashboard, so hide the
                  // ones that already have a tile for it.
                  const available = dashboards.filter(
                    (d) => !d.tiles.some((t) => t.chart_id === chart.id),
                  )
                  if (dashboards.length > 0 && available.length === 0) {
                    return <span className="text-muted">On every dashboard</span>
                  }
                  return (
                    <select
                      value=""
                      onChange={(e) => {
                        const dash = available.find((d) => d.id === e.target.value)
                        if (dash) addToDashMut.mutate({ chart, dash })
                      }}
                      className={selectCls}
                    >
                      <option value="">Add to dashboard…</option>
                      {available.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  )
                })()}
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete chart "${chart.name}"?`)) {
                      deleteChartMut.mutate(chart.id)
                    }
                  }}
                  className="text-danger hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
            {result && !result.error && result.columns.length > 0 && (
              <div className="h-56">
                <ChartRenderer
                  type={chart.type}
                  x={chart.x}
                  y={chart.y}
                  series={chart.series}
                  columns={result.columns}
                  rows={result.rows}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
