import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { QueryHistoryResponse, QueryResult, ScriptRunResponse } from '@/lib/types'
import { useConnection, useConnectionName } from '@/lib/useConnection'
import { useQueryFor, useResultFor, useUIStore } from '@/lib/store'
import { Spinner } from '@/components/Spinner'
import { ResultTable } from '@/components/ResultTable'
import { ScriptResult } from '@/components/ScriptResult'

const SQL_DB_TYPES = ['postgresql', 'mysql', 'sqlite']
const SCRIPT_MAX_BYTES = 5 * 1024 * 1024

function isSqlFile(f: File): boolean {
  return f.name.toLowerCase().endsWith('.sql')
}

export function QueryPage() {
  const { conn } = useParams<{ conn: string }>()
  const connName = useConnectionName(conn)
  const { data: connData } = useConnection(conn)
  const dbType = connData?.connection.db_type
  const scriptSupported = !dbType || SQL_DB_TYPES.includes(dbType)
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

  // Script reports stay in component state: the zustand store persists to
  // sessionStorage (~5MB) and a large report would blow the quota.
  const [scriptResult, setScriptResult] = useState<ScriptRunResponse | null>(null)
  const [scriptError, setScriptError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [stopOnError, setStopOnError] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      setScriptResult(null)
      setScriptError(null)
      qc.invalidateQueries({ queryKey: historyKey })
    },
    onError: (e: unknown) => {
      setScriptResult(null)
      setScriptError(null)
      setResult({
        columns: [],
        rows: [],
        affected: null,
        error: e instanceof Error ? e.message : 'Request failed',
        elapsed_ms: null,
      })
    },
  })

  const scriptMut = useMutation({
    mutationFn: async (file: File) => {
      // Raw fetch, not apiFetch: apiFetch forces a JSON Content-Type, which
      // would clobber the multipart boundary.
      const form = new FormData()
      form.append('file', file)
      form.append('stop_on_error', String(stopOnError))
      const res = await fetch(`/api/connections/${conn}/query/script`, {
        method: 'POST',
        body: form,
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.error ?? `Upload failed (${res.status})`)
      }
      return body as ScriptRunResponse
    },
    onSuccess: (res) => {
      setScriptResult(res)
      setScriptError(null)
      setResult(null)
      qc.invalidateQueries({ queryKey: historyKey })
      qc.invalidateQueries({ queryKey: ['tables', conn] })
    },
    onError: (e: unknown) => {
      setScriptResult(null)
      setScriptError(e instanceof Error ? e.message : 'Upload failed')
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

  const runScript = (file: File) => {
    if (scriptMut.isPending) return
    if (!isSqlFile(file)) {
      setScriptResult(null)
      setScriptError(`"${file.name}" is not a .sql file.`)
      return
    }
    if (file.size > SCRIPT_MAX_BYTES) {
      setScriptResult(null)
      setScriptError(`"${file.name}" is too large (max 5 MB).`)
      return
    }
    // This executes DDL/DML against a live database — confirm before it runs.
    const kb = Math.max(1, Math.round(file.size / 1024))
    if (!window.confirm(`Run "${file.name}" (${kb} KB) against ${connName}?`)) return
    setScriptError(null)
    scriptMut.mutate(file)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      run()
    }
  }

  // Ctrl+V of a copied .sql *file*. Plain text pastes carry no files, so the
  // textarea's normal paste is untouched.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      const sql = files.find(isSqlFile)
      if (!sql) return
      e.preventDefault()
      runScript(sql)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
    // No dep array on purpose — re-binding each render keeps the handler's view
    // of stopOnError and the pending flag current without threading refs.
  })

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
          <div
            onDragOver={(e) => {
              if (!scriptSupported) return
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              if (!scriptSupported) return
              e.preventDefault()
              setDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) runScript(file)
            }}
            className={`relative rounded-lg ${dragging ? 'ring-2 ring-accent' : ''}`}
          >
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              rows={10}
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-surface p-3 font-mono text-sm focus:border-accent focus:outline-none"
              placeholder="-- write a query, or drop a .sql file here..."
            />
            {dragging && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-surface/80 text-sm text-accent">
                Drop a .sql file to run it
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
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

            <input
              ref={fileInputRef}
              type="file"
              accept=".sql,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = '' // let the same file be picked again
                if (file) runScript(file)
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={scriptMut.isPending || !scriptSupported}
              title={
                scriptSupported
                  ? 'Upload a .sql file and run its statements in order'
                  : 'Script upload is only available for SQL databases'
              }
              className="rounded border border-border px-3 py-1.5 text-sm text-text-secondary hover:border-accent hover:text-text disabled:opacity-50"
            >
              {scriptMut.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> Running script…
                </span>
              ) : (
                'Run .sql file…'
              )}
            </button>

            {scriptSupported && (
              <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={stopOnError}
                  onChange={(e) => setStopOnError(e.target.checked)}
                />
                Stop on first error
              </label>
            )}
            {scriptSupported && (
              <span className="text-xs text-muted">or drop / paste a .sql file</span>
            )}
          </div>

          <div className="mt-4">
            {scriptError ? (
              <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                <strong>Error:</strong> {scriptError}
              </div>
            ) : scriptResult ? (
              <ScriptResult result={scriptResult} />
            ) : result?.error ? (
              <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
                <strong>Error:</strong> {result.error}
              </div>
            ) : result && cols.length > 0 ? (
              <ResultTable columns={cols} rows={rows} />
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
