import { Link, NavLink, Outlet, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useThemeStore } from '@/lib/store'
import { THEMES, THEME_ORDER } from '@/lib/themes'
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
      <header className="flex h-12 shrink-0 items-center gap-4 bg-topbar px-4 text-topbar-text">
        <Link to="/" className="font-semibold tracking-wide">
          db-viewr
        </Link>
        <input
          type="text"
          placeholder="Jump to table, run a query…"
          className="max-w-[420px] flex-1 rounded-md border border-white/20 bg-white/10 px-2.5 py-1.5 text-[13px] text-white placeholder:text-white/60 focus:border-white/40 focus:outline-none"
        />
        <div className="ml-auto flex items-center gap-3">
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
          <ThemeSwitcher />
        </div>
      </header>
      {conn && <SubnavTabs conn={conn} />}
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}

function SubnavTabs({ conn }: { conn: string }) {
  const base = 'border-b-2 border-transparent px-3 py-2.5 text-sm text-sidebar-text hover:text-white'
  const active = 'border-accent font-semibold text-white'
  return (
    <nav className="flex shrink-0 gap-1 bg-sidebar px-3">
      <NavLink to={`/c/${conn}`} end className={({ isActive }) => `${base} ${isActive ? active : ''}`}>
        Tables
      </NavLink>
      <NavLink to={`/c/${conn}/query`} className={({ isActive }) => `${base} ${isActive ? active : ''}`}>
        Query
      </NavLink>
      <NavLink to={`/c/${conn}/erd`} className={({ isActive }) => `${base} ${isActive ? active : ''}`}>
        ERD
      </NavLink>
    </nav>
  )
}

function ThemeSwitcher() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <div className="flex gap-1.5">
      {THEME_ORDER.map((key) => {
        const active = key === theme
        return (
          <button
            key={key}
            type="button"
            onClick={() => setTheme(key)}
            className={`cursor-pointer rounded-[5px] border px-2.5 py-[5px] text-xs font-medium ${
              active
                ? 'border-accent bg-accent text-white'
                : 'border-transparent text-topbar-text opacity-75 hover:opacity-100'
            }`}
          >
            {THEMES[key].label}
          </button>
        )
      })}
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
