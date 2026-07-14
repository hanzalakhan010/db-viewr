import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { BiChartType } from '@/lib/types'

// Categorical palette (fixed slot order, CVD-validated on the light surface).
const PALETTE = [
  '#2a78d6',
  '#1baf7a',
  '#eda100',
  '#008300',
  '#4a3aa7',
  '#e34948',
  '#e87ba4',
  '#eb6834',
]

const GRID_STROKE = '#eaeded'
const AXIS_STROKE = '#d5dbdb'
const TICK_STYLE = { fontSize: 11, fill: '#687078' }

const compactNum = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

interface ChartRendererProps {
  type: BiChartType
  x: string
  y: string
  series?: string
  columns: string[]
  rows: unknown[][]
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center p-4 text-center text-xs text-muted">
      {children}
    </div>
  )
}

export function ChartRenderer({ type, x, y, series, columns, rows }: ChartRendererProps) {
  if (rows.length === 0) return <Placeholder>No data</Placeholder>

  const yi = columns.indexOf(y)
  if (yi < 0) return <Placeholder>Column “{y}” is not in the result</Placeholder>

  if (type === 'number') {
    const raw = rows[0][yi]
    const value = toNum(raw)
    // Only stringify primitives; objects/arrays would render as noise.
    const fallback = raw == null || typeof raw === 'object' ? '—' : String(raw)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-4">
        <div className="text-4xl font-semibold text-text">
          {value === null ? fallback : compactNum.format(value)}
        </div>
        <div className="text-xs text-text-secondary">{y}</div>
      </div>
    )
  }

  const xi = columns.indexOf(x)
  if (xi < 0) return <Placeholder>Column “{x}” is not in the result</Placeholder>

  if (type === 'pie') {
    const data = rows
      .map((r) => ({ name: String(r[xi] ?? ''), value: toNum(r[yi]) ?? 0 }))
      .filter((d) => d.value > 0)
    if (data.length === 0) return <Placeholder>No data</Placeholder>
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            stroke="#ffffff"
            strokeWidth={2}
            label={false}
          >
            {data.map((d, i) => (
              <Cell key={d.name + i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip />
          {data.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        </PieChart>
      </ResponsiveContainer>
    )
  }

  // bar / line / area: pivot on the series column when set, keys in
  // first-appearance order so colors follow the entity, never its rank.
  const si = series ? columns.indexOf(series) : -1
  if (series && si < 0) return <Placeholder>Column “{series}” is not in the result</Placeholder>

  let keys: string[]
  let data: Record<string, unknown>[]
  if (si >= 0) {
    keys = []
    const byX = new Map<string, Record<string, unknown>>()
    for (const r of rows) {
      const xv = String(r[xi] ?? '')
      let sv = String(r[si] ?? '')
      // A series value equal to the x column name would overwrite the x label.
      if (sv === x) sv = `${sv} (series)`
      if (!keys.includes(sv)) keys.push(sv)
      let rec = byX.get(xv)
      if (!rec) {
        rec = { [x]: xv }
        byX.set(xv, rec)
      }
      rec[sv] = toNum(r[yi])
    }
    data = [...byX.values()]
  } else {
    keys = [y]
    data = rows.map((r) => ({ [x]: String(r[xi] ?? ''), [y]: toNum(r[yi]) }))
  }

  const axes = (
    <>
      <CartesianGrid stroke={GRID_STROKE} vertical={false} />
      <XAxis dataKey={x} tick={TICK_STYLE} tickLine={false} axisLine={{ stroke: AXIS_STROKE }} />
      <YAxis
        tick={TICK_STYLE}
        tickLine={false}
        axisLine={false}
        width={44}
        tickFormatter={(v: number) => compactNum.format(v)}
      />
      <Tooltip />
      {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
    </>
  )

  if (type === 'bar') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          {axes}
          {keys.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              fill={PALETTE[i % PALETTE.length]}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (type === 'area') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          {axes}
          {keys.map((k, i) => (
            <Area
              key={k}
              dataKey={k}
              stroke={PALETTE[i % PALETTE.length]}
              fill={PALETTE[i % PALETTE.length]}
              fillOpacity={0.1}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        {axes}
        {keys.map((k, i) => (
          <Line
            key={k}
            dataKey={k}
            stroke={PALETTE[i % PALETTE.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: '#ffffff', strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
