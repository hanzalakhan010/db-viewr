import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import GridLayout, { useContainerWidth, type Layout } from 'react-grid-layout'
// v2 ships its own types and bundles the resize-handle styles in this sheet.
import 'react-grid-layout/css/styles.css'
import { apiFetch } from '@/lib/api'
import type {
  BiChart,
  BiChartsResponse,
  BiDashboardResponse,
  BiTile,
  QueryResult,
} from '@/lib/types'
import { ChartRenderer } from '@/components/bi/ChartRenderer'
import { Spinner } from '@/components/Spinner'

export function BiDashboardPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { width, containerRef, mounted } = useContainerWidth()

  const { data: dashData, error: dashError } = useQuery({
    queryKey: ['biDashboard', id],
    queryFn: () => apiFetch<BiDashboardResponse>(`bi/dashboards/${id}`),
    enabled: !!id,
  })
  const { data: chartsData } = useQuery({
    queryKey: ['biCharts'],
    queryFn: () => apiFetch<BiChartsResponse>('bi/charts'),
  })
  const chartById = new Map((chartsData?.charts ?? []).map((c) => [c.id, c]))

  const layoutMut = useMutation({
    mutationFn: (tiles: BiTile[]) =>
      apiFetch<BiDashboardResponse>(`bi/dashboards/${id}/layout`, {
        method: 'PUT',
        body: JSON.stringify({ tiles }),
      }),
    onSuccess: (res) => qc.setQueryData(['biDashboard', id], res),
  })

  if (dashError) {
    return (
      <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
        {dashError instanceof Error ? dashError.message : 'Dashboard not found'}
      </div>
    )
  }
  const dashboard = dashData?.dashboard
  if (!dashboard) return <Spinner />

  const tiles = dashboard.tiles
  const layout: Layout = tiles.map((t) => ({
    i: t.chart_id,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    minW: 2,
    minH: 2,
  }))

  const persist = (l: Layout) =>
    layoutMut.mutate(l.map((it) => ({ chart_id: it.i, x: it.x, y: it.y, w: it.w, h: it.h })))

  const removeTile = (chartId: string) =>
    layoutMut.mutate(tiles.filter((t) => t.chart_id !== chartId))

  return (
    <div>
      <nav className="mb-4 text-sm text-text-secondary">
        <Link to="/bi" className="text-info hover:underline">
          BI
        </Link>
        <span className="mx-2">/</span>
        <span className="text-text">{dashboard.name}</span>
      </nav>

      {tiles.length === 0 ? (
        <p className="text-xs text-muted">
          No charts pinned yet — save a chart from a{' '}
          <Link to="/bi" className="text-info hover:underline">
            BI query
          </Link>{' '}
          and add it here.
        </p>
      ) : (
        <div ref={containerRef}>
          {mounted && (
            <GridLayout
              width={width}
              layout={layout}
              gridConfig={{ cols: 12, rowHeight: 72 }}
              dragConfig={{ handle: '.bi-drag-handle' }}
              onDragStop={(l) => persist(l)}
              onResizeStop={(l) => persist(l)}
            >
              {tiles.map((t) => (
                <div key={t.chart_id}>
                  <DashboardTile
                    chart={chartById.get(t.chart_id)}
                    chartsLoaded={!!chartsData}
                    onRemove={() => removeTile(t.chart_id)}
                  />
                </div>
              ))}
            </GridLayout>
          )}
        </div>
      )}
    </div>
  )
}

function DashboardTile({
  chart,
  chartsLoaded,
  onRemove,
}: {
  chart: BiChart | undefined
  chartsLoaded: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="bi-drag-handle flex shrink-0 cursor-move items-center justify-between border-b border-border-light px-3 py-1.5">
        <span className="truncate text-xs font-medium">{chart?.name ?? 'Missing chart'}</span>
        <button
          type="button"
          onClick={onRemove}
          onPointerDown={(e) => e.stopPropagation()}
          className="px-1 text-muted hover:text-danger"
          title="Remove from dashboard"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1 p-2">
        {chart ? (
          <TileBody chart={chart} />
        ) : chartsLoaded ? (
          <TileError message="This chart no longer exists." />
        ) : (
          <TileLoading />
        )}
      </div>
    </div>
  )
}

function TileBody({ chart }: { chart: BiChart }) {
  // Each tile fetches its own data so one broken query never takes the
  // dashboard down with it.
  const { data, error, isPending } = useQuery({
    queryKey: ['biRun', chart.query_id],
    queryFn: () => apiFetch<QueryResult>(`bi/queries/${chart.query_id}/run`, { method: 'POST' }),
    staleTime: 0,
    retry: false,
  })

  if (isPending) return <TileLoading />
  if (error) {
    return <TileError message={error instanceof Error ? error.message : 'Request failed'} />
  }
  if (data.error) return <TileError message={data.error} />

  return (
    <ChartRenderer
      type={chart.type}
      x={chart.x}
      y={chart.y}
      series={chart.series}
      columns={data.columns}
      rows={data.rows}
    />
  )
}

function TileLoading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  )
}

function TileError({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-3">
      <div className="max-h-full overflow-auto rounded border border-danger/40 bg-danger/10 px-2 py-1 text-xs text-danger">
        {message}
      </div>
    </div>
  )
}
