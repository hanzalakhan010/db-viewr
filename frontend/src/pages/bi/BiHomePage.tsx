import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type {
  BiDashboardResponse,
  BiDashboardsResponse,
  BiQueriesResponse,
  ConnectionsResponse,
} from '@/lib/types'

export function BiHomePage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [dashName, setDashName] = useState('')

  const { data: dashData } = useQuery({
    queryKey: ['biDashboards'],
    queryFn: () => apiFetch<BiDashboardsResponse>('bi/dashboards'),
  })
  const { data: queryData } = useQuery({
    queryKey: ['biQueries'],
    queryFn: () => apiFetch<BiQueriesResponse>('bi/queries'),
  })
  const { data: connData } = useQuery({
    queryKey: ['connections'],
    queryFn: () => apiFetch<ConnectionsResponse>('connections'),
  })
  const connNames = new Map((connData?.connections ?? []).map((c) => [c.id, c.name]))

  const createDashMut = useMutation({
    mutationFn: (name: string) =>
      apiFetch<BiDashboardResponse>('bi/dashboards', {
        method: 'POST',
        body: JSON.stringify({ name, tiles: [] }),
      }),
    onSuccess: (res) => {
      setDashName('')
      qc.invalidateQueries({ queryKey: ['biDashboards'] })
      navigate(`/bi/d/${res.dashboard.id}`)
    },
  })

  const deleteDashMut = useMutation({
    mutationFn: (id: string) => apiFetch<null>(`bi/dashboards/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['biDashboards'] }),
  })

  const deleteQueryMut = useMutation({
    mutationFn: (id: string) => apiFetch<null>(`bi/queries/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['biQueries'] })
      qc.invalidateQueries({ queryKey: ['biCharts'] })
      qc.invalidateQueries({ queryKey: ['biDashboards'] })
    },
  })

  const dashboards = dashData?.dashboards ?? []
  const queries = queryData?.queries ?? []

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-xl font-medium">BI</h1>

      <section className="mb-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Dashboards</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (dashName.trim() && !createDashMut.isPending) {
                createDashMut.mutate(dashName.trim())
              }
            }}
            className="flex items-center gap-2"
          >
            <input
              value={dashName}
              onChange={(e) => setDashName(e.target.value)}
              placeholder="New dashboard name"
              className="rounded border border-border bg-surface px-2 py-1 text-sm focus:border-accent focus:outline-none"
            />
            <button
              type="submit"
              disabled={!dashName.trim() || createDashMut.isPending}
              className="rounded bg-accent px-3 py-1 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Create
            </button>
          </form>
        </div>
        {dashboards.length === 0 ? (
          <p className="text-xs text-muted">No dashboards yet.</p>
        ) : (
          <div className="space-y-2">
            {dashboards.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2"
              >
                <Link to={`/bi/d/${d.id}`} className="text-sm text-info hover:underline">
                  {d.name}
                </Link>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span>
                    {d.tiles.length} tile{d.tiles.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Delete dashboard "${d.name}"?`)) {
                        deleteDashMut.mutate(d.id)
                      }
                    }}
                    className="text-danger hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-medium">Saved queries</h2>
          <Link
            to="/bi/queries/new"
            className="rounded bg-accent px-3 py-1 text-sm text-white hover:bg-accent-hover"
          >
            New query
          </Link>
        </div>
        {queries.length === 0 ? (
          <p className="text-xs text-muted">No saved queries yet.</p>
        ) : (
          <div className="space-y-2">
            {queries.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between rounded border border-border bg-surface px-3 py-2"
              >
                <Link to={`/bi/queries/${q.id}`} className="text-sm text-info hover:underline">
                  {q.name}
                </Link>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span>{connNames.get(q.conn_id) ?? q.conn_id}</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(`Delete query "${q.name}"? Its charts are deleted too.`)
                      ) {
                        deleteQueryMut.mutate(q.id)
                      }
                    }}
                    className="text-danger hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
