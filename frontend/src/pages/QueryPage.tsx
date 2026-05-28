import { type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { QueryHistoryResponse, QueryResult } from '@/lib/types'
import { useConnectionName } from '@/lib/useConnection'
import { useQueryFor, useResultFor, useUIStore } from '@/lib/store'
import { Spinner } from '@/components/Spinner'

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function QueryPage() {
  const { conn } = useParams<{ conn: string }>()
  const connName = useConnectionName(conn)
  const qc = useQueryClient()
  const query = useQueryFor(conn)
  const result = useResultFor(conn)
  const storeSetQuery = useUIStore((s) => s.setQuery)
  const storeSetResult = useUIStore((s) => s.setResult)
  const setQuery = (q: string) => {
    if (conn) storeSetQuery(conn, q)
  }
  const setResult = (r: QueryResult | null) => {
    if (conn) storeSetResult(conn, r)
  }

  const historyKey = ['queryHistory', conn]
  const { data: historyData } = useQuery({
    queryKey: historyKey,
    queryFn: () => apiFetch<QueryHistoryResponse>(`connections/${conn}/query/history`),
    enabled: !!conn,
  })

  const runMut = useMutation({
    mutationFn: (q: string) =>
      apiFetch<QueryResult>(`connections/${conn}/query`, {
        method: 'POST',
        body: JSON.stringify({ query: q }),
      }),
    onSuccess: (res) => {
      setResult(res)
      qc.invalidateQueries({ queryKey: historyKey })
    },
    onError: (e: unknown) => {
      setResult({
        columns: [],
        rows: [],
        affected: null,
        error: e instanceof Error ? e.message : 'Request failed',
        elapsed_ms: null,
      })
    },
  })

  const deleteItemMut = useMutation({
    mutationFn: (index: number) =>
      apiFetch<null>(`connections/${conn}/query/history?index=${index}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: historyKey }),
  })

  const clearAllMut = useMutation({
    mutationFn: () =>
      apiFetch<null>(`connections/${conn}/query/history`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: historyKey }),
  })

  const run = () => {
    const q = query.trim()
    if (!q || runMut.isPending) return
    runMut.mutate(q)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      run()
    }
  }

  const history = historyData?.history ?? []
  const cols = result?.columns ?? []
  const rows = result?.rows ?? []

  return (
    <div>
      <nav className="mb-4 text-sm text-text-secondary">
        <Link to={`/c/${conn}`} className="text-info hover:underline">
          {connName}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text">Query</span>
      </nav>

      <div className="grid gap-4 md:grid-cols-[1fr_280px]">
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-text-secondary">
            <span>
              Editor <span className="text-muted">— Cmd/Ctrl+Enter to run</span>
            </span>
            {result?.elapsed_ms != null && (
              <span className="rounded bg-border-light px-2 py-0.5 font-mono">
                {result.elapsed_ms} ms
              </span>
            )}
          </div>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            rows={10}
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-surface p-3 font-mono text-sm focus:border-accent focus:outline-none"
            placeholder="-- write a query..."
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={runMut.isPending || !query.trim()}
              className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {runMut.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Running…
                </span>
              ) : (
                'Run query'
              )}
            </button>
          </div>

          <div className="mt-4">
            {result?.error ? (
              <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                <strong>Error:</strong> {result.error}
              </div>
            ) : result && cols.length > 0 ? (
              <div className="overflow-auto rounded-lg border border-border bg-surface">
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
                Query OK
                {result.affected != null && ` · affected: ${result.affected}`}
                {result.elapsed_ms != null && ` · elapsed: ${result.elapsed_ms}ms`}
              </div>
            ) : null}
          </div>
        </div>

        <aside>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">History</h3>
            {history.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Clear query history for this connection?')) {
                    clearAllMut.mutate()
                  }
                }}
                className="text-xs text-danger hover:underline"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="space-y-2">
            {history.length === 0 ? (
              <p className="text-xs text-muted">No queries yet.</p>
            ) : (
              history.map((item, i) => {
                const preview = item.q.length > 80 ? item.q.slice(0, 80) + '…' : item.q
                return (
                  <div
                    key={i}
                    onClick={() => setQuery(item.q)}
                    className="group cursor-pointer rounded border border-border bg-surface p-2 text-xs hover:border-accent"
                  >
                    <pre className="mb-1 whitespace-pre-wrap break-words font-mono text-text">
                      {preview}
                    </pre>
                    <div className="flex items-center justify-between text-muted">
                      <span>{new Date(item.t).toLocaleString()}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteItemMut.mutate(i)
                        }}
                        className="px-1 text-danger opacity-0 group-hover:opacity-100"
                        title="Delete entry"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
