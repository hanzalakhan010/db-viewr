import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { TablesResponse } from '@/lib/types'
import { Loading } from '@/components/Spinner'

export function TablesPage() {
  const { conn } = useParams<{ conn: string }>()
  const { data, isLoading, error } = useQuery({
    queryKey: ['tables', conn],
    queryFn: () => apiFetch<TablesResponse>(`connections/${conn}/tables`),
    enabled: !!conn,
  })

  return (
    <div>
      <h1 className="mb-4 text-xl font-medium">Tables</h1>

      {error && (
        <div className="mb-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {(error as Error).message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {isLoading ? (
          <div className="p-6"><Loading /></div>
        ) : !data || data.tables.length === 0 ? (
          <div className="p-6 text-text-secondary">No tables found.</div>
        ) : (
          <ul className="divide-y divide-border-light">
            {data.tables.map((t) => (
              <li key={t}>
                <Link
                  to={`/c/${conn}/t/${encodeURIComponent(t)}`}
                  className="block px-4 py-2 font-mono text-sm text-info hover:bg-border-light hover:underline"
                >
                  {t}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
