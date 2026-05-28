import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { ColumnDef, MutationResult } from '@/lib/types'

interface Props {
  conn: string
  table: string
  dbType: string
  schema: ColumnDef[]
  columns: string[]
  onClose: () => void
  onSuccess: () => void
}

export function InsertRowModal({ conn, table, dbType, schema, columns, onClose, onSuccess }: Props) {
  const isMongo = dbType === 'mongodb'
  const fields = schema.length > 0 ? schema.map((s) => s.name) : columns

  const [values, setValues] = useState<Record<string, string>>({})
  const [nulls, setNulls] = useState<Record<string, boolean>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [doc, setDoc] = useState('{\n  \n}')

  const mutation = useMutation({
    mutationFn: async () => {
      const body = isMongo
        ? { document: doc }
        : {
            values: (() => {
              const v: Record<string, unknown> = {}
              fields.forEach((c) => {
                if (nulls[c]) v[c] = null
                else if (touched[c]) v[c] = values[c] ?? ''
              })
              return v
            })(),
          }
      return apiFetch<MutationResult>(`connections/${conn}/tables/${encodeURIComponent(table)}/insert`, {
        method: 'POST',
        body: JSON.stringify(body),
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
          <h2 className="text-lg font-medium">Insert row</h2>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate()
          }}
          className="space-y-3 px-4 py-3"
        >
          {isMongo ? (
            <textarea
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
              rows={12}
              className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-xs"
            />
          ) : (
            fields.map((c) => (
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
                    onChange={(e) => {
                      setNulls((n) => ({ ...n, [c]: e.target.checked }))
                      setTouched((t) => ({ ...t, [c]: true }))
                    }}
                  />
                  NULL
                </label>
              </div>
            ))
          )}
          {mutation.data && !mutation.data.ok && (
            <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {mutation.data.error ?? 'Insert failed'}
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
              {mutation.isPending ? 'Inserting…' : 'Insert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
