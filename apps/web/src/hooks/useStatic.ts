/** Reads for the static screens (Today's claims, Activity, Eligibility, Cash, Denials). No mutations: they render seed data. */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type ActivityParams } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import { useCurrentUser, useSession } from '@/state/session'

const useLoc = () => {
  const { locationId } = useSession()
  return locationId === 'all' ? undefined : locationId
}

export function useActivity(p: ActivityParams) {
  const params: ActivityParams = { day: p.day, agent: p.agent, outcome: p.outcome }
  return useQuery({ queryKey: qk.activity(params), queryFn: () => api.activity(params), placeholderData: keepPreviousData })
}
export function useLedger() {
  return useQuery({ queryKey: qk.ledger, queryFn: api.ledger })
}
export function useEligibility(p: { date?: string | undefined }) {
  return useQuery({ queryKey: qk.eligibility({ date: p.date }), queryFn: () => api.eligibility({ date: p.date }), placeholderData: keepPreviousData })
}
export function useBenefits(appointmentId: string | undefined) {
  return useQuery({
    queryKey: qk.benefits(appointmentId ?? 'none'),
    queryFn: () => api.benefits(appointmentId ?? ''),
    enabled: Boolean(appointmentId),
  })
}
/** Owner-only on the server too (403); `enabled` keeps other roles from asking. */
export function useCash(opts: { enabled?: boolean } = {}) {
  const location = useLoc()
  const user = useCurrentUser()
  return useQuery({ queryKey: qk.cash(location), queryFn: api.cash, enabled: (opts.enabled ?? true) && user.role === 'owner' })
}
export function useDenials() {
  return useQuery({ queryKey: qk.denials, queryFn: api.denials })
}
export function useWorldStatus() {
  return useQuery({ queryKey: qk.world, queryFn: api.worldStatus, staleTime: 30_000, retry: false })
}
