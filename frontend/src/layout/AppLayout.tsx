import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { ConnectionPublic, ConnectionResponse } from '@/lib/types'

export function AppLayout() {
  const { conn } = useParams()
  const { data } = useQuery({
    queryKey: ['connection', conn],
    queryFn: () => apiFetch<ConnectionResponse>(`connections/${conn}`),
    enabled: !!conn,
    staleTime: 60_000,
  })
  const c = data?.connection

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b-2 border-accent bg-topbar px-4 text-topbar-text">
        <Link to="/" className="font-medium tracking-wide">
          db-viewr
        </Link>
        {conn && (
          <span className="text-sm text-sidebar-text">
            {c ? (
              <>
                <span className="font-medium text-white">{c.name}</span>
                <span className="ml-2 font-mono text-xs">{connSummary(c)}</span>
              </>
            ) : (
              <span className="font-mono text-xs opacity-60">{conn}</span>
            )}
          </span>
        )}
        <div className="ml-auto text-xs text-sidebar-text">SPA preview</div>
      </header>
      <div className="flex min-h-0 flex-1">
        {conn ? <ConnSidebar conn={conn} /> : null}
        <main className="min-h-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function connSummary(c: ConnectionPublic): string {
  if (c.host) return `${c.host}${c.port ? `:${c.port}` : ''}${c.database ? `/${c.database}` : ''}`
  if (c.uri) return c.uri
  if (c.path) return c.path
  if (c.region) return c.region
  return ''
}

function ConnSidebar({ conn }: { conn: string }) {
  const link =
    'block rounded px-3 py-2 text-sm text-sidebar-text hover:bg-sidebar-hover'
  const active = 'bg-sidebar-active text-white'
  return (
    <aside className="w-60 shrink-0 bg-sidebar p-2">
      <nav className="space-y-1">
        <NavLink
          to={`/c/${conn}`}
          end
          className={({ isActive }) => `${link} ${isActive ? active : ''}`}
        >
          Tables
        </NavLink>
        <NavLink
          to={`/c/${conn}/query`}
          className={({ isActive }) => `${link} ${isActive ? active : ''}`}
        >
          Query
        </NavLink>
        <NavLink
          to={`/c/${conn}/erd`}
          className={({ isActive }) => `${link} ${isActive ? active : ''}`}
        >
          ERD
        </NavLink>
      </nav>
    </aside>
  )
}
