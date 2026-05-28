import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/api'
import {
  DB_TYPE_LABELS,
  type ConnectionPublic,
  type ConnectionsResponse,
  type TestResponse,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { Loading } from '@/components/Spinner'

type TestState = { ok: boolean; message: string } | null

export function ConnectionsPage() {
  const qc = useQueryClient()
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})

  const { data, isLoading, error } = useQuery({
    queryKey: ['connections'],
    queryFn: () => apiFetch<ConnectionsResponse>('connections'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch<null>(`connections/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['connections'] }),
  })

  const testMut = useMutation({
    mutationFn: (id: string) =>
      apiFetch<TestResponse>(`connections/${id}/test`, { method: 'POST' }),
    onSuccess: (res, id) => {
      setTestStates((s) => ({
        ...s,
        [id]: { ok: res.ok, message: res.ok ? 'Connection OK' : res.error ?? 'Failed' },
      }))
      window.setTimeout(() => {
        setTestStates((s) => ({ ...s, [id]: null }))
      }, 5000)
    },
    onError: (e: unknown, id) => {
      const msg = e instanceof ApiError ? e.message : 'Failed'
      setTestStates((s) => ({ ...s, [id]: { ok: false, message: msg } }))
      window.setTimeout(() => {
        setTestStates((s) => ({ ...s, [id]: null }))
      }, 5000)
    },
  })

  const onDelete = (c: ConnectionPublic) => {
    if (window.confirm(`Delete connection '${c.name}'?`)) deleteMut.mutate(c.id)
  }

  const summary = (c: ConnectionPublic) =>
    c.host ?? c.path ?? c.uri ?? c.region ?? '—'

  const connections = data?.connections ?? []

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-medium">Connections</h1>
        <Link
          to="/new"
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          New connection
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {(error as Error).message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {isLoading ? (
          <div className="p-6"><Loading /></div>
        ) : connections.length === 0 ? (
          <div className="p-6 text-text-secondary">
            No connections saved yet.{' '}
            <Link to="/new" className="text-info hover:underline">
              Add your first connection →
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-border-light text-left text-text-secondary">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Host / Path</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => {
                const ts = testStates[c.id]
                return (
                  <tr key={c.id} className="border-t border-border-light">
                    <td className="px-4 py-2">
                      <Link to={`/c/${c.id}`} className="text-info hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      <span className="inline-block rounded bg-border-light px-2 py-0.5 text-xs text-text-secondary">
                        {DB_TYPE_LABELS[c.db_type] ?? c.db_type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted">{summary(c)}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        {ts && (
                          <span
                            className={cn(
                              'text-xs',
                              ts.ok ? 'text-success' : 'text-danger',
                            )}
                          >
                            {ts.ok ? '✓' : '✗'} {ts.message}
                          </span>
                        )}
                        <Link
                          to={`/c/${c.id}`}
                          className="rounded border border-border px-2 py-1 text-xs hover:bg-border-light"
                        >
                          Browse
                        </Link>
                        <button
                          onClick={() => testMut.mutate(c.id)}
                          disabled={testMut.isPending}
                          className="rounded border border-border px-2 py-1 text-xs hover:bg-border-light"
                        >
                          Test
                        </button>
                        <Link
                          to={`/c/${c.id}/edit`}
                          className="rounded border border-border px-2 py-1 text-xs hover:bg-border-light"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => onDelete(c)}
                          disabled={deleteMut.isPending}
                          className="rounded border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
