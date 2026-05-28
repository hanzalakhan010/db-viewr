import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { ColumnDef, MutationResult } from '@/lib/types'

interface Props {
  conn: string
  table: string
  schema: ColumnDef[]
  columns: string[]
  row: unknown[]
  onClose: () => void
  onSuccess: () => void
}

function toDisplay(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function EditRowModal({ conn, table, schema, columns, row, onClose, onSuccess }: Props) {
  // Build identity: PK columns if any are flagged, else all columns.
  const pkCols = schema.filter((c) => c.pk).map((c) => c.name)
  const identityCols = pkCols.length > 0 ? pkCols : columns

  const [values, setValues] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    columns.forEach((c, i) => {
      m[c] = toDisplay(row[i])
    })
    return m
  })
  const [nulls, setNulls] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}
    columns.forEach((c, i) => {
      m[c] = row[i] === null
    })
    return m
  })
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const mutation = useMutation({
    mutationFn: async () => {
      const identity: Record<string, unknown> = {}
      identityCols.forEach((c) => {
        const idx = columns.indexOf(c)
        if (idx < 0) return
        const v = row[idx]
        identity[c] = v === null ? null : toDisplay(v)
      })
      const diff: Record<string, unknown> = {}
      columns.forEach((c, i) => {
        const orig = row[i]
        const wasNull = orig === null
        const isNull = nulls[c]
        const newVal = values[c]
        const changed = touched[c] || wasNull !== isNull
        if (!changed) return
        diff[c] = isNull ? null : newVal
      })
      return apiFetch<MutationResult>(`connections/${conn}/tables/${encodeURIComponent(table)}/update`, {
        method: 'POST',
        body: JSON.stringify({ identity, values: diff }),
      })
    },
    onSuccess: (res) => {
      if (res.ok) onSuccess()
    },
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-lg font-medium">Edit row</h2>
          {pkCols.length === 0 && (
            <p className="text-xs text-muted">No primary key detected — identity uses all columns.</p>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate()
          }}
          className="space-y-3 px-4 py-3"
        >
          {columns.map((c) => (
            <div key={c} className="grid grid-cols-[10rem_1fr_auto] items-center gap-2">
              <label className="font-mono text-xs text-text-secondary">{c}</label>
              <input
                type="text"
                value={values[c] ?? ''}
                disabled={nulls[c]}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [c]: e.target.value }))
                  setTouched((t) => ({ ...t, [c]: true }))
                }}
                className="rounded border border-border bg-bg px-2 py-1 text-sm disabled:opacity-50"
              />
              <label className="flex items-center gap-1 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={!!nulls[c]}
                  onChange={(e) => setNulls((n) => ({ ...n, [c]: e.target.checked }))}
                />
                NULL
              </label>
            </div>
          ))}
          {mutation.data && !mutation.data.ok && (
            <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {mutation.data.error ?? 'Update failed'}
            </div>
          )}
          {mutation.error && (
            <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {(mutation.error as Error).message}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-border-light"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
