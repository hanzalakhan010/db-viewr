import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { ConnectionResponse, ViewsResponse } from '@/lib/types'
import { Loading } from '@/components/Spinner'
import { useConnectionName } from '@/lib/useConnection'

const SQL_TYPES = ['postgresql', 'mysql', 'sqlite']

export function ViewsListPage() {
  const { conn } = useParams<{ conn: string }>()
  const connName = useConnectionName(conn)
  const qc = useQueryClient()
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const { data: connData } = useQuery({
    queryKey: ['connection', conn],
    queryFn: () => apiFetch<ConnectionResponse>(`connections/${conn}`),
    enabled: !!conn,
  })
  const isSql = connData ? SQL_TYPES.includes(connData.connection.db_type) : true

  const { data, isLoading, error } = useQuery({
    queryKey: ['views', conn],
    queryFn: () => apiFetch<ViewsResponse>(`connections/${conn}/views`),
    enabled: !!conn && isSql,
  })

  const del = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`connections/${conn}/views/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmId(null)
      qc.invalidateQueries({ queryKey: ['views', conn] })
    },
  })

  const views = data?.views ?? []

  return (
    <div>
      <nav className="mb-4 text-sm text-text-secondary">
        <Link to={`/c/${conn}`} className="text-info hover:underline">
          {connName}
        </Link>
        <span className="mx-2">/</span>
        <span>Views</span>
      </nav>

      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-medium">Saved views</h1>
        {isSql && (
          <Link
            to={`/c/${conn}/views/new`}
            className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
          >
            + New view
          </Link>
        )}
      </div>

      {!isSql && (
        <div className="rounded-lg border border-border bg-surface p-6 text-text-secondary">
          Views are only available on SQL connections (PostgreSQL, MySQL, SQLite).
        </div>
      )}

      {error && (
        <div className="mb-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {(error as Error).message}
        </div>
      )}

      {isSql && isLoading ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <Loading />
        </div>
      ) : isSql && views.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-text-secondary">
          No saved views yet. Create one to join tables along their relationships
          and re-run it any time.
        </div>
      ) : isSql ? (
        <ul className="space-y-2">
          {views.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
            >
              <Link to={`/c/${conn}/views/${v.id}`} className="min-w-0 flex-1">
                <div className="font-medium text-text hover:underline">{v.name}</div>
                <div className="mt-0.5 font-mono text-xs text-text-secondary">
                  {v.spec.base_table}
                  {v.spec.joins.length > 0 && ` · ${v.spec.joins.length} join${v.spec.joins.length > 1 ? 's' : ''}`}
                  {` · ${v.spec.columns.length} column${v.spec.columns.length === 1 ? '' : 's'}`}
                </div>
              </Link>
              {confirmId === v.id ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => del.mutate(v.id)}
                    disabled={del.isPending}
                    className="rounded bg-danger px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-border-light"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmId(v.id)}
                  className="rounded border border-border px-2 py-1 text-xs text-danger hover:bg-danger/10"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
