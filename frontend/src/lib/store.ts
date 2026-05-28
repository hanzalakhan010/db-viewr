import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { QueryResult } from './types'

interface QueryState {
  query: string
  result: QueryResult | null
}

interface UIState {
  queryByConn: Record<string, QueryState>
  setQuery: (conn: string, query: string) => void
  setResult: (conn: string, result: QueryResult | null) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      queryByConn: {},
      setQuery: (conn, query) =>
        set((s) => ({
          queryByConn: {
            ...s.queryByConn,
            [conn]: { query, result: s.queryByConn[conn]?.result ?? null },
          },
        })),
      setResult: (conn, result) =>
        set((s) => ({
          queryByConn: {
            ...s.queryByConn,
            [conn]: { query: s.queryByConn[conn]?.query ?? '', result },
          },
        })),
    }),
    {
      name: 'db-viewr-ui',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ queryByConn: s.queryByConn }),
    },
  ),
)

export function useQueryFor(conn: string | undefined): string {
  return useUIStore((s) => (conn ? s.queryByConn[conn]?.query ?? '' : ''))
}

export function useResultFor(conn: string | undefined): QueryResult | null {
  return useUIStore((s) => (conn ? s.queryByConn[conn]?.result ?? null : null))
}
