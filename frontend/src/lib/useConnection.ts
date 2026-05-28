import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api'
import type { ConnectionResponse } from './types'

export function useConnection(id: string | undefined) {
  return useQuery({
    queryKey: ['connection', id],
    queryFn: () => apiFetch<ConnectionResponse>(`connections/${id}`),
    enabled: !!id,
    staleTime: 60_000,
  })
}

export function useConnectionName(id: string | undefined): string {
  const { data } = useConnection(id)
  return data?.connection.name ?? id ?? ''
}
