/** Inbox reads. Lists are keyed by their filters; items by id; both under ['inbox'] for one invalidation. */
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import type { InboxSearch } from '@/features/inbox/search'
import { useSession } from '@/state/session'

export type InboxListParams = { state: string; kind?: string | undefined; agent?: string | undefined; location: string | undefined }

export const inboxListQuery = (p: InboxListParams) =>
  queryOptions({
    queryKey: qk.inbox.list(p),
    queryFn: ({ signal }) => api.inbox({ state: p.state, kind: p.kind, agent: p.agent }, signal),
    placeholderData: keepPreviousData,
  })

export function useInboxListParams(search: InboxSearch): InboxListParams {
  const { locationId } = useSession()
  return { state: search.state ?? 'open', kind: search.kind, agent: search.agent, location: locationId === 'all' ? undefined : locationId }
}

export function useInboxList(search: InboxSearch) {
  return useQuery(inboxListQuery(useInboxListParams(search)))
}

export function useInboxItem(id: string | undefined) {
  return useQuery({
    queryKey: qk.inbox.item(id ?? 'none'),
    queryFn: () => api.inboxItem(id ?? ''),
    enabled: Boolean(id),
  })
}
