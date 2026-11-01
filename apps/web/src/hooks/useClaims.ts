/** Claims table (infinite, server-filtered/sorted), claim detail, saved views and manual triage. */
import { keepPreviousData, queryOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/endpoints'
import { isApiError } from '@/api/client'
import { qk } from '@/api/queryKeys'
import type { RunView } from '@/api/schema'
import { mergeSnapshot, runViewOf } from '@/lib/runEvents'
import { toApiParams, type ClaimsSearch } from '@/features/claims/search'
import { launchStore, type Launch } from '@/state/launches'
import { useSession } from '@/state/session'
import { toast } from '@/state/toast'

export function useClaimsList(search: ClaimsSearch) {
  const { locationId } = useSession()
  const apiParams = toApiParams(search)
  return useInfiniteQuery({
    queryKey: qk.claims.list({ ...apiParams, location: locationId === 'all' ? undefined : locationId }),
    queryFn: ({ pageParam, signal }) => api.claims(apiParams, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export const claimQuery = (id: string) => queryOptions({ queryKey: qk.claim(id), queryFn: () => api.claim(id) })

export function useClaim(id: string) {
  return useQuery(claimQuery(id))
}

export function useViews() {
  return useQuery({ queryKey: qk.views, queryFn: api.views, staleTime: 60_000 })
}

export function useSaveView() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { name: string; search_params: Record<string, unknown> }) => api.saveView(v.name, v.search_params),
    onSuccess: (view) => {
      toast(`Saved view “${view.name}”.`, { tone: 'ok' })
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.views }),
  })
}

/** "Ask Follow-up to look": POST /claims/{id}:triage → 202 {run}; the panel streams the run. */
export function useTriage(opts: { onLaunched?: (l: Launch) => void } = {}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { claimId: string; number: number; patient: string }) => api.triage(v.claimId, 'followup'),
    onSuccess: ({ run }, v) => {
      qc.setQueryData<RunView>(qk.run(run.id), (old) => mergeSnapshot(old, runViewOf(run)))
      const launch: Launch = {
        id: run.id,
        kind: 'triage',
        title: `Follow-up looks at #${v.number}`,
        runs: [{ run_id: run.id, claim_id: v.claimId, item_id: null, label: `#${v.number} ${v.patient}` }],
        started_at: qc.getQueryData<{ now: string }>(qk.clock)?.now ?? run.started_at ?? '',
      }
      launchStore.add(launch)
      opts.onLaunched?.(launch)
    },
    onError: (err) => {
      if (isApiError(err, 'run_in_progress')) toast('An agent is already working this claim, or it has an open item.', { tone: 'warn' })
      else if (isApiError(err, 'agents_paused')) toast(err.message, { tone: 'warn' })
      else toast('Could not start the agent.', { tone: 'bad' })
    },
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: qk.claim(v.claimId) }),
  })
}
