/** Reads for the static screens. No mutations: these screens render seed data. */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import { useSession } from '@/state/session'

const useLoc = () => {
  const { locationId } = useSession()
  return locationId === 'all' ? undefined : locationId
}

export function useActivity(p: { day?: string | undefined; agent?: string | undefined; outcome?: string | undefined }) {
  const location = useLoc()
  return useQuery({ queryKey: qk.activity({ ...p, location }), queryFn: () => api.activity(p) })
}
export function useLedger() {
  return useQuery({ queryKey: [...qk.ledger, useLoc()], queryFn: api.ledger })
}
export function useEligibility(p: { date?: string | undefined }) {
  const location = useLoc()
  return useQuery({ queryKey: qk.eligibility({ ...p, location }), queryFn: () => api.eligibility(p) })
}
export function useCash() {
  const location = useLoc()
  return useQuery({ queryKey: qk.cash(location), queryFn: api.cash })
}
export function useDenials() {
  return useQuery({ queryKey: qk.denials, queryFn: api.denials })
}
export function useRules() {
  return useQuery({ queryKey: qk.rules, queryFn: api.rules })
}
export function useRuleChanges() {
  return useQuery({ queryKey: qk.ruleChanges, queryFn: api.ruleChanges })
}
export function useProposals() {
  return useQuery({ queryKey: qk.proposals, queryFn: api.proposals })
}
export function useWorldStatus() {
  return useQuery({ queryKey: qk.world, queryFn: api.worldStatus, staleTime: 30_000, retry: false })
}
