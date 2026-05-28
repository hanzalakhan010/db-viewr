import { useState } from 'react'
import type { ColumnDef } from '@/lib/types'

const SQL_SIMPLE_OPS = ['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'IS NULL', 'IS NOT NULL']

const ADV_OPS: { value: string; label: string; needsValue: boolean; needsValue2?: boolean }[] = [
  { value: '=', label: '=', needsValue: true },
  { value: '!=', label: '!=', needsValue: true },
  { value: '>', label: '>', needsValue: true },
  { value: '<', label: '<', needsValue: true },
  { value: '>=', label: '>=', needsValue: true },
  { value: '<=', label: '<=', needsValue: true },
  { value: 'like', label: 'LIKE', needsValue: true },
  { value: 'not_like', label: 'NOT LIKE', needsValue: true },
  { value: 'ilike', label: 'ILIKE', needsValue: true },
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'not_contains', label: 'not contains', needsValue: true },
  { value: 'starts_with', label: 'starts with', needsValue: true },
  { value: 'ends_with', label: 'ends with', needsValue: true },
  { value: 'regex', label: 'regex', needsValue: true },
  { value: 'not_regex', label: 'not regex', needsValue: true },
  { value: 'in', label: 'IN (csv)', needsValue: true },
  { value: 'not_in', label: 'NOT IN (csv)', needsValue: true },
  { value: 'between', label: 'BETWEEN', needsValue: true, needsValue2: true },
  { value: 'is_null', label: 'IS NULL', needsValue: false },
  { value: 'is_not_null', label: 'IS NOT NULL', needsValue: false },
]

interface Condition {
  column: string
  op: string
  value: string
  value2?: string
}

interface AdvFilter {
  combinator: 'AND' | 'OR'
  conditions: Condition[]
}

function parseAdv(raw: string | undefined): AdvFilter {
  if (!raw) return { combinator: 'AND', conditions: [] }
  try {
    const p = JSON.parse(raw) as Partial<AdvFilter>
    return {
      combinator: p.combinator === 'OR' ? 'OR' : 'AND',
      conditions: Array.isArray(p.conditions) ? (p.conditions as Condition[]) : [],
    }
  } catch {
    return { combinator: 'AND', conditions: [] }
  }
}

interface Props {
  dbType: string
  schema: ColumnDef[]
  initial: {
    filter_col?: string
    filter_op?: string
    filter_val?: string
    filter_json?: string
    filter_fe?: string
    filter_eav?: string
    adv_filters?: string
  }
  onApply: (patch: Record<string, string | undefined>) => void
}

export function FilterBar({ dbType, schema, initial, onApply }: Props) {
  const [col, setCol] = useState(initial.filter_col ?? '')
  const [op, setOp] = useState(initial.filter_op ?? '=')
  const [val, setVal] = useState(initial.filter_val ?? '')
  const [json, setJson] = useState(initial.filter_json ?? '')
  const [fe, setFe] = useState(initial.filter_fe ?? '')
  const [eav, setEav] = useState(initial.filter_eav ?? '')
  const [adv, setAdv] = useState<AdvFilter>(() => parseAdv(initial.adv_filters))
  const [advMode, setAdvMode] = useState(() => (initial.adv_filters ? true : false))

  if (dbType === 'mongodb') {
    return (
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs text-text-secondary">Filter (JSON)</label>
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            rows={2}
            className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-xs"
            placeholder='{"field": "value"}'
          />
        </div>
        <button
          type="button"
          onClick={() => onApply({ filter_json: json || undefined })}
          className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
        >
          Apply
        </button>
      </div>
    )
  }

  if (dbType === 'dynamodb') {
    return (
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs text-text-secondary">FilterExpression</label>
          <textarea
            value={fe}
            onChange={(e) => setFe(e.target.value)}
            rows={2}
            className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-xs"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-text-secondary">ExpressionAttributeValues (JSON)</label>
          <textarea
            value={eav}
            onChange={(e) => setEav(e.target.value)}
            rows={2}
            className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-xs"
          />
        </div>
        <button
          type="button"
          onClick={() => onApply({ filter_fe: fe || undefined, filter_eav: eav || undefined })}
          className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
        >
          Apply
        </button>
      </div>
    )
  }

  // ── SQL ──
  const toggleMode = () => {
    setAdvMode((m) => !m)
  }

  if (!advMode) {
    return (
      <div className="flex items-end gap-2">
        <div>
          <label className="block text-xs text-text-secondary">Column</label>
          <select
            value={col}
            onChange={(e) => setCol(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1 text-sm"
          >
            <option value="">—</option>
            {schema.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-secondary">Op</label>
          <select
            value={op}
            onChange={(e) => setOp(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1 text-sm"
          >
            {SQL_SIMPLE_OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs text-text-secondary">Value</label>
          <input
            type="text"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={() =>
            onApply({
              filter_col: col || undefined,
              filter_op: col ? op : undefined,
              filter_val: col ? val : undefined,
              adv_filters: undefined,
            })
          }
          className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
        >
          Apply
        </button>
        {(initial.filter_col || initial.filter_val) && (
          <button
            type="button"
            onClick={() => {
              setCol('')
              setVal('')
              onApply({ filter_col: undefined, filter_op: undefined, filter_val: undefined })
            }}
            className="rounded border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-border-light"
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={toggleMode}
          className="rounded border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-border-light"
          title="Advanced filter"
        >
          Advanced
        </button>
      </div>
    )
  }

  // ── Advanced SQL ──
  const updateCond = (i: number, patch: Partial<Condition>) => {
    setAdv((a) => ({ ...a, conditions: a.conditions.map((c, j) => (i === j ? { ...c, ...patch } : c)) }))
  }
  const removeCond = (i: number) => {
    setAdv((a) => ({ ...a, conditions: a.conditions.filter((_, j) => j !== i) }))
  }
  const addCond = () => {
    setAdv((a) => ({
      ...a,
      conditions: [...a.conditions, { column: schema[0]?.name ?? '', op: '=', value: '' }],
    }))
  }
  const applyAdv = () => {
    const cleaned = adv.conditions.filter((c) => c.column)
    if (cleaned.length === 0) {
      onApply({ adv_filters: undefined, filter_col: undefined, filter_op: undefined, filter_val: undefined })
      return
    }
    onApply({
      adv_filters: JSON.stringify({ combinator: adv.combinator, conditions: cleaned }),
      filter_col: undefined,
      filter_op: undefined,
      filter_val: undefined,
    })
  }
  const clearAdv = () => {
    setAdv({ combinator: 'AND', conditions: [] })
    onApply({ adv_filters: undefined })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <span>Combine with</span>
        <select
          value={adv.combinator}
          onChange={(e) => setAdv((a) => ({ ...a, combinator: e.target.value === 'OR' ? 'OR' : 'AND' }))}
          className="rounded border border-border bg-bg px-2 py-1 text-sm"
        >
          <option value="AND">AND</option>
          <option value="OR">OR</option>
        </select>
        <button
          type="button"
          onClick={toggleMode}
          className="ml-auto rounded border border-border px-2 py-1 text-xs hover:bg-border-light"
        >
          Simple
        </button>
      </div>
      {adv.conditions.length === 0 ? (
        <div className="rounded border border-dashed border-border px-3 py-2 text-xs text-muted">
          No conditions. Click "+ Add condition" to start.
        </div>
      ) : (
        adv.conditions.map((c, i) => {
          const opDef = ADV_OPS.find((o) => o.value === c.op) ?? ADV_OPS[0]
          return (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                value={c.column}
                onChange={(e) => updateCond(i, { column: e.target.value })}
                className="rounded border border-border bg-bg px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {schema.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
              <select
                value={c.op}
                onChange={(e) => updateCond(i, { op: e.target.value })}
                className="rounded border border-border bg-bg px-2 py-1 text-sm"
              >
                {ADV_OPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {opDef.needsValue && (
                <input
                  type="text"
                  value={c.value}
                  onChange={(e) => updateCond(i, { value: e.target.value })}
                  placeholder="value"
                  className="flex-1 min-w-[8rem] rounded border border-border bg-bg px-2 py-1 text-sm"
                />
              )}
              {opDef.needsValue2 && (
                <input
                  type="text"
                  value={c.value2 ?? ''}
                  onChange={(e) => updateCond(i, { value2: e.target.value })}
                  placeholder="and value"
                  className="flex-1 min-w-[8rem] rounded border border-border bg-bg px-2 py-1 text-sm"
                />
              )}
              <button
                type="button"
                onClick={() => removeCond(i)}
                aria-label="Remove condition"
                className="rounded border border-border px-2 py-1 text-xs text-danger hover:bg-danger/10"
              >
                ×
              </button>
            </div>
          )
        })
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={addCond}
          className="rounded border border-border px-3 py-1 text-xs hover:bg-border-light"
        >
          + Add condition
        </button>
        <div className="ml-auto flex gap-2">
          {initial.adv_filters && (
            <button
              type="button"
              onClick={clearAdv}
              className="rounded border border-border px-3 py-1.5 text-sm text-text-secondary hover:bg-border-light"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={applyAdv}
            className="rounded bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-hover"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
