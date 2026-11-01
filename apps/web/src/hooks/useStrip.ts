/** The pipeline strip / nav badges. Written by the API client from every mutation's `meta.counts`. */
import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import { useSession } from '@/state/session'

export const stripQuery = (location: string | undefined) =>
  queryOptions({ queryKey: qk.strip(location), queryFn: api.strip, staleTime: 30_000 })

export function useStrip() {
  const { locationId } = useSession()
  return useQuery(stripQuery(locationId === 'all' ? undefined : locationId))
}
