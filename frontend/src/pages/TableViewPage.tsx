import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { TableRowsResponse } from '@/lib/types'
import { Loading } from '@/components/Spinner'
import { useConnectionName } from '@/lib/useConnection'
import { KebabMenu } from '@/components/KebabMenu'
import { FilterBar } from './TableView/FilterBar'
import { EditRowModal } from './TableView/EditRowModal'
import { InsertRowModal } from './TableView/InsertRowModal'

const PAGE_SIZES = [25, 50, 100, 200, 500]

function renderCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function TableViewPage() {
  const { conn, table } = useParams<{ conn: string; table: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const qc = useQueryClient()

  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(500, parseInt(searchParams.get('page_size') ?? '50', 10) || 50)
  const sortCol = searchParams.get('sort_col') ?? undefined
  const sortDir = (searchParams.get('sort_dir') as 'asc' | 'desc' | null) ?? undefined

  const queryString = searchParams.toString()
  const path = `connections/${conn}/tables/${encodeURIComponent(table ?? '')}${queryString ? `?${queryString}` : ''}`

  const { data, isLoading, error } = useQuery({
    queryKey: ['tableRows', conn, table, queryString],
    queryFn: () => apiFetch<TableRowsResponse>(path),
    enabled: !!conn && !!table,
  })

  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [showInsert, setShowInsert] = useState(false)
  const [density, setDensity] = useState<'compact' | 'comfortable'>('compact')
  const compact = density === 'compact'

  // URL helpers — preserve other params, drop empty ones.
  const patch = (updates: Record<string, string | number | undefined | null>) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(updates).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') next.delete(k)
      else next.set(k, String(v))
    })
    setSearchParams(next, { replace: false })
  }

  const onSort = (col: string) => {
    if (sortCol === col) {
      patch({ sort_dir: sortDir === 'asc' ? 'desc' : 'asc', page: 1 })
    } else {
      patch({ sort_col: col, sort_dir: 'asc', page: 1 })
    }
  }

  const csvHref = useMemo(
    () => `/connections/${conn}/tables/${encodeURIComponent(table ?? '')}/export.csv${queryString ? `?${queryString}` : ''}`,
    [conn, table, queryString],
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tableRows', conn, table] })
  }

  const schema = data?.schema ?? []
  const cols = data?.data.columns ?? []
  const rows = data?.data.rows ?? []
  const total = data?.data.total ?? null
  const hasNext = data?.data.has_next ?? false
  const dbType = data?.db_type ?? ''
  const connName = useConnectionName(conn)

  return (
    <div>
      <nav className="mb-4 text-sm text-text-secondary">
        <Link to={`/c/${conn}`} className="text-info hover:underline">
          {connName}
        </Link>
        <span className="mx-2">/</span>
        <span className="font-mono text-text">{table}</span>
      </nav>

      {error && (
        <div className="mb-4 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {(error as Error).message}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border p-3">
          <div className="flex-1 min-w-[20rem]">
            {data && (
              <FilterBar
                dbType={dbType}
                schema={schema}
                initial={{
                  filter_col: searchParams.get('filter_col') ?? undefined,
                  filter_op: searchParams.get('filter_op') ?? undefined,
                  filter_val: searchParams.get('filter_val') ?? undefined,
                  filter_json: searchParams.get('filter_json') ?? undefined,
                  filter_fe: searchParams.get('filter_fe') ?? undefined,
                  filter_eav: searchParams.get('filter_eav') ?? undefined,
                  adv_filters: searchParams.get('adv_filters') ?? undefined,
                }}
                onApply={(p) => patch({ ...p, page: 1 })}
              />
            )}
          </div>
          <div className="flex items-end gap-2">
            <button
              type="button"
              onClick={() => setDensity(compact ? 'comfortable' : 'compact')}
              className="rounded border border-border bg-bg px-2.5 py-1.5 text-xs text-text"
            >
              {compact ? 'Comfortable' : 'Compact'}
            </button>
            <div>
              <label className="block text-xs text-text-secondary">Page size</label>
              <select
                value={pageSize}
                onChange={(e) => patch({ page_size: e.target.value, page: 1 })}
                className="rounded border border-border bg-bg px-2 py-1 text-sm"
              >
                {PAGE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <KebabMenu
              items={[
                { label: 'Insert row', onClick: () => setShowInsert(true) },
                { label: 'Export CSV', href: csvHref },
              ]}
            />
          </div>
        </div>

        <div className="overflow-auto">
          {isLoading ? (
            <div className="p-6"><Loading /></div>
          ) : !data || rows.length === 0 ? (
            <div className="p-6 text-text-secondary">No rows.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-bg">
                <tr>
                  <th
                    className={`border-b border-border text-left font-medium text-text-secondary ${compact ? 'border-r border-border-light px-2 py-1 text-[11px]' : 'px-3 py-2 text-xs'}`}
                  >
                    ·
                  </th>
                  {cols.map((c) => {
                    const isSorted = sortCol === c
                    const colType = schema.find((s) => s.name === c)?.type
                    return (
                      <th
                        key={c}
                        onClick={() => onSort(c)}
                        title={colType ? `${c}: ${colType}` : c}
                        className={`cursor-pointer select-none border-b border-border text-left font-mono text-text-secondary hover:text-text ${compact ? 'border-r border-border-light px-2 py-1 text-[11px]' : 'px-3 py-2 text-xs'}`}
                      >
                        <span className="text-text">{c}</span>
                        {colType && <span className="ml-1 text-muted">:{colType}</span>}
                        {isSorted && <span className="ml-1 text-accent">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-border-light hover:bg-border-light/40">
                    <td className={compact ? 'border-r border-border-light px-2 py-0.5' : 'px-3 py-1'}>
                      <button
                        type="button"
                        onClick={() => setEditIdx(i)}
                        className="text-[11px] text-info hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                    {row.map((v, j) => (
                      <td
                        key={j}
                        className={`whitespace-nowrap font-mono ${compact ? 'border-r border-border-light px-2 py-0.5 text-[11px]' : 'px-3 py-1 text-xs'}`}
                      >
                        {v === null ? <span className="text-muted italic">NULL</span> : renderCell(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-text-secondary">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => patch({ page: page - 1 })}
            className="rounded border border-border px-3 py-1 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => patch({ page: page + 1 })}
            className="rounded border border-border px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
          <span>Page {page}</span>
          <span>
            Showing {rows.length} rows
            {total !== null && ` of ${total}`}
          </span>
        </div>
        {data?.elapsed_ms !== null && data?.elapsed_ms !== undefined && (
          <span className="rounded bg-border-light px-2 py-0.5 font-mono text-xs">
            {data.elapsed_ms} ms
          </span>
        )}
      </div>

      {editIdx !== null && data && conn && table && (
        <EditRowModal
          conn={conn}
          table={table}
          schema={schema}
          columns={cols}
          row={rows[editIdx]}
          onClose={() => setEditIdx(null)}
          onSuccess={() => {
            setEditIdx(null)
            invalidate()
          }}
        />
      )}

      {showInsert && data && conn && table && (
        <InsertRowModal
          conn={conn}
          table={table}
          dbType={dbType}
          schema={schema}
          columns={cols}
          onClose={() => setShowInsert(false)}
          onSuccess={() => {
            setShowInsert(false)
            invalidate()
          }}
        />
      )}
    </div>
  )
}
