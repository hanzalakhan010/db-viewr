import { useMemo } from 'react'
import type { JoinType, ViewSpec } from '@/lib/types'

interface Props {
  spec: ViewSpec
  selectedTable: string | null
  onSelectTable: (t: string) => void
  onSetJoinType: (index: number, jt: JoinType) => void
  onRemoveJoin: (index: number) => void
}

const BOX_W = 150
const BOX_H = 40
const COL_W = 240
const ROW_H = 64
const MARGIN = 16

interface Node {
  table: string
  x: number
  y: number
}
interface Edge {
  index: number
  from: Node
  to: Node
  label: string
  joinType: JoinType
}

/**
 * Hybrid mini-canvas: the tables currently in the view laid out in columns by
 * their join-distance from the base table, with the join edges drawn between
 * them. Layout is computed from the spec (deterministic — no DOM measuring),
 * so it re-renders cleanly as joins are added/removed.
 */
export function ViewCanvas({ spec, selectedTable, onSelectTable, onSetJoinType, onRemoveJoin }: Props) {
  const { nodes, edges, width, height } = useMemo(() => {
    const depth = new Map<string, number>()
    depth.set(spec.base_table, 0)
    for (const j of spec.joins) {
      const anchor = depth.has(j.from_table)
        ? j.from_table
        : depth.has(j.to_table)
          ? j.to_table
          : spec.base_table
      const other = anchor === j.from_table ? j.to_table : j.from_table
      if (!depth.has(other)) depth.set(other, (depth.get(anchor) ?? 0) + 1)
    }

    // Group tables by depth into columns, preserving insertion order.
    const byDepth = new Map<number, string[]>()
    for (const [t, d] of depth) {
      const arr = byDepth.get(d) ?? []
      arr.push(t)
      byDepth.set(d, arr)
    }
    const pos = new Map<string, Node>()
    let maxRows = 0
    let maxDepth = 0
    for (const [d, tables] of byDepth) {
      maxDepth = Math.max(maxDepth, d)
      maxRows = Math.max(maxRows, tables.length)
      tables.forEach((t, row) => {
        pos.set(t, { table: t, x: MARGIN + d * COL_W, y: MARGIN + row * ROW_H })
      })
    }

    const nodes = [...pos.values()]
    const edges: Edge[] = spec.joins.flatMap((j, index) => {
      const from = pos.get(j.from_table)
      const to = pos.get(j.to_table)
      if (!from || !to) return []
      // Anchor the arrow from the shallower node to the deeper one.
      const [src, dst] = from.x <= to.x ? [from, to] : [to, from]
      return [{
        index,
        from: src,
        to: dst,
        label: `${j.from_col} → ${j.to_col}`,
        joinType: j.join_type,
      }]
    })

    return {
      nodes,
      edges,
      width: Math.max(MARGIN * 2 + (maxDepth + 1) * COL_W, 320),
      height: Math.max(MARGIN * 2 + maxRows * ROW_H, 120),
    }
  }, [spec])

  return (
    <div className="overflow-auto rounded-lg border border-border bg-bg">
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} className="absolute inset-0">
          <defs>
            <marker
              id="view-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" className="fill-muted" />
            </marker>
          </defs>
          {edges.map((e) => {
            const x1 = e.from.x + BOX_W
            const y1 = e.from.y + BOX_H / 2
            const x2 = e.to.x
            const y2 = e.to.y + BOX_H / 2
            const mx = (x1 + x2) / 2
            return (
              <path
                key={e.index}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                className="stroke-border-light"
                strokeWidth={1.5}
                fill="none"
                markerEnd="url(#view-arrow)"
              />
            )
          })}
        </svg>

        {nodes.map((n) => {
          const isBase = n.table === spec.base_table
          const isSel = n.table === selectedTable
          return (
            <button
              key={n.table}
              type="button"
              onClick={() => onSelectTable(n.table)}
              style={{ left: n.x, top: n.y, width: BOX_W, height: BOX_H }}
              className={`absolute flex items-center justify-between gap-2 rounded-md border px-2 text-left text-xs shadow-sm ${
                isSel
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-surface hover:border-accent/60'
              }`}
            >
              <span className="truncate font-mono text-text">{n.table}</span>
              {isBase && (
                <span className="rounded bg-accent/15 px-1 py-0.5 text-[9px] font-semibold text-accent">
                  BASE
                </span>
              )}
            </button>
          )
        })}

        {edges.map((e) => {
          const mx = (e.from.x + BOX_W + e.to.x) / 2
          const my = (e.from.y + e.to.y) / 2 + BOX_H / 2
          return (
            <div
              key={e.index}
              style={{ left: mx - 46, top: my - 12 }}
              className="absolute flex items-center gap-1 rounded border border-border bg-surface px-1 py-0.5 shadow-sm"
              title={e.label}
            >
              <select
                value={e.joinType}
                onChange={(ev) => onSetJoinType(e.index, ev.target.value as JoinType)}
                className="bg-transparent text-[10px] text-text-secondary outline-none"
              >
                <option value="inner">INNER</option>
                <option value="left">LEFT</option>
              </select>
              <button
                type="button"
                onClick={() => onRemoveJoin(e.index)}
                aria-label="Remove join"
                className="text-[10px] text-danger hover:opacity-80"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
