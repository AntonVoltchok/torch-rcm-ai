/**
 * The server facts tour copy quotes, read through the app's own hooks and query keys so the tour and the screen share
 * one cache and can never disagree. Nothing here counts or adds: each value is a field of a response.
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import { API_BASE } from '@/env'
import { useInboxItem } from '@/hooks/useInbox'
import { inboxListQuery } from '@/hooks/useInbox'
import { useStrip } from '@/hooks/useStrip'
import { useClock } from '@/hooks/useClock'
import { useAgentsStatus } from '@/hooks/useAgents'
import { useLaunches } from '@/state/launches'
import { useSession } from '@/state/session'
import { tileFor } from '@/lib/strip'
import type { ClaimStatus } from '@/api/schema'

/** Records the seed pins by id (docs/spec/04-seed.md); the demo script follows the same ones. */
export const FOLLOWED = { item: 'itm_4821', claim: 'clm_4821', triage: 'clm_4744' } as const

export function useStripFacts() {
  const s = useStrip().data
  const tile = (status: ClaimStatus) => (s ? tileFor(s, status)?.count : undefined)
  return { s, tile }
}

/**
 * How the server's agents plan right now, in the reader's words (ADR-0013). `replay` is live mode answering from
 * recorded API responses; it is never described as a live call.
 */
export function useAgentMode(): { kind: 'replay' | 'live' | 'none' | undefined; label: string | undefined; line: string } {
  const s = useAgentsStatus().data
  if (!s) return { kind: undefined, label: undefined, line: '' }
  if (s.mode === 'live' && s.replay)
    return {
      kind: 'replay',
      label: 'Recorded Claude',
      line: 'Judgment calls replay real Claude API responses recorded on these cases. No live calls. Routine work follows rules; a case off the recorded path uses a hand-written plan and says so.',
    }
  if (s.mode === 'live') return { kind: 'live', label: 'Live Claude', line: 'Judgment calls go to Claude as you watch; routine work follows rules.' }
  return { kind: 'none', label: 'No model', line: 'Judgment calls use hand-written plans. The recorded Claude responses for these cases are replayed in the test suite.' }
}

/**
 * Which server answers this page: the API's own `GET /system` (host and deployed commit from Render's env), plus the
 * host the client calls. The MSW mock answers `host: 'mock'`, so the card never claims a server that is not there.
 */
export function useBackend() {
  const info = useQuery({ queryKey: qk.system, queryFn: api.system, staleTime: Infinity }).data
  const origin = API_BASE.startsWith('http') ? new URL(API_BASE).host : API_BASE
  if (!info) return { info, origin, label: undefined }
  const label = info.host === 'Render' ? 'Render' : info.host === 'local' ? 'Local API' : 'In-browser mock'
  return { info, origin, label }
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
