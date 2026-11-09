/**
 * The server facts tour copy quotes, read through the app's own hooks and query keys so the tour and the screen share
 * one cache and can never disagree. Nothing here counts or adds: each value is a field of a response.
 */
import { useQuery } from '@tanstack/react-query'
import { useInboxItem } from '@/hooks/useInbox'
import { inboxListQuery } from '@/hooks/useInbox'
import { useStrip } from '@/hooks/useStrip'
import { useClock } from '@/hooks/useClock'
import { useLaunches } from '@/state/launches'
import { useSession } from '@/state/session'
import { tileFor } from '@/lib/strip'
import type { ClaimStatus } from '@/api/schema'

export const FOLLOWED = { item: 'itm_4821', claim: 'clm_4821', triage: 'clm_4744' } as const

export function useStripFacts() {
  const s = useStrip().data
  const tile = (status: ClaimStatus) => (s ? tileFor(s, status)?.count : undefined)
  return { s, tile }
}

export function useNowLabel() {
  return useClock().data?.now
}

/** The open Inbox list as the Inbox screen keys it (state=open, the session's location). */
export function useOpenInbox() {
  const { locationId } = useSession()
  return useQuery(inboxListQuery({ state: 'open', location: locationId === 'all' ? undefined : locationId })).data
}

export function useFollowedItem() {
  return useInboxItem(FOLLOWED.item).data
}

/** The Delta group #4821 belongs to, as the server grouped it (count and cents are the server's). */
export function useFollowedGroup() {
  const item = useFollowedItem()
  const list = useOpenInbox()
  return item?.group_key ? list?.groups?.find((g) => g.group_key === item.group_key) : undefined
}

/** `changes` the server returned for this tab's latest launch of a kind: before → after, computed by the server. */
export function useLaunchChange(kind: 'approve_group' | 'approve' | 'triage', key: string) {
  const launch = useLaunches().findLast((l) => l.kind === kind)
  return launch?.changes?.find((c) => c.key === key)
}
