import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { ErdResponse, ErdTable } from '@/lib/types'
import { Loading } from '@/components/Spinner'
import { useConnectionName } from '@/lib/useConnection'

function tableDomId(name: string): string {
  return `erd-table-${encodeURIComponent(name)}`
}

export function ErdPage() {
  const { conn } = useParams<{ conn: string }>()
  const connName = useConnectionName(conn)
  const [filter, setFilter] = useState('')
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const { data, isLoading, error } = useQuery({
    queryKey: ['erd', conn],
    queryFn: () => apiFetch<ErdResponse>(`connections/${conn}/erd`),
    enabled: !!conn,
  })

  const entries = useMemo<Array<[string, ErdTable]>>(() => {
    if (!data) return []
    return Object.entries(data.erd.tables).sort(([a], [b]) => a.localeCompare(b))
  }, [data])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(([name]) => name.toLowerCase().includes(q))
  }, [entries, filter])

  const scrollToTable = (name: string) => {
    const el = cardRefs.current[name]
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el.classList.add('ring-2', 'ring-accent')
    setTimeout(() => {
      el.classList.remove('ring-2', 'ring-accent')
    }, 1500)
  }

  return (
    <div>
      <nav className="mb-4 text-sm text-text-secondary">
        <Link to={`/c/${conn}`} className="text-info hover:underline">
          {connName}
        </Link>
        <span className="mx-2">/</span>
        <span>ERD</span>
      </nav>

      {error && (
        <div className="mb-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {(error as Error).message}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-medium">
          {data ? (
            <span className="text-text-secondary text-sm font-normal">
              {entries.length} tables &middot; {data.rel_count} relations
            </span>
          ) : (
            'ERD'
          )}
        </h1>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter tables..."
          className="w-64 rounded border border-border bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-border bg-surface p-6">
          <Loading />
        </div>
      ) : !data || entries.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-text-secondary">
          No tables found.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-text-secondary">
          No tables match "{filter}".
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(([name, tbl]) => (
            <div
              key={name}
              id={tableDomId(name)}
              ref={(el) => {
                cardRefs.current[name] = el
              }}
              className="rounded-lg border border-border bg-surface transition-shadow"
            >
              <div className="border-b border-border-light px-3 py-2">
                <h2 className="font-mono text-sm text-text">{name}</h2>
              </div>
              <ul className="divide-y divide-border-light/60 px-3 py-2 text-xs">
                {tbl.columns.map((col) => (
                  <li
                    key={col.name}
                    className="flex items-center justify-between gap-2 py-1 font-mono"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-text">{col.name}</span>
                      {col.primary_key && (
                        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          PK
                        </span>
                      )}
                    </span>
                    {col.type && (
                      <span className="text-text-secondary">{col.type}</span>
                    )}
                  </li>
                ))}
              </ul>
              {tbl.foreign_keys && tbl.foreign_keys.length > 0 && (
                <div className="border-t border-border-light px-3 py-2">
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">
                    References
                  </div>
                  <ul className="space-y-1 font-mono text-xs">
                    {tbl.foreign_keys.map((fk, i) => (
                      <li key={`${fk.column}-${i}`} className="text-text-secondary">
                        <span className="text-text">{fk.column}</span>
                        <span className="mx-1">&rarr;</span>
                        <button
                          type="button"
                          onClick={() => scrollToTable(fk.ref_table)}
                          className="text-info hover:underline"
                        >
                          {fk.ref_table}
                        </button>
                        <span>.{fk.ref_column}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
