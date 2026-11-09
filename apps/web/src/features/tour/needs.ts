/**
 * What a step needs from the practice, checked against the server before the step is drawn, and how a step whose
 * element an earlier Try it creates is shown until that Try it has run. Together they make every step show the thing it
 * describes: the tour puts the practice in the state a step needs instead of saying the element is not there.
 */
import type { QueryClient } from '@tanstack/react-query'
import { api } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import { FOLLOWED } from './facts'
import type { Need, Step, Tour } from './types'

/** `null` when the practice is in the state; otherwise why it is not, in a sentence for the card. */
export const NEEDS: Record<Need, (qc: QueryClient) => Promise<string | null>> = {
  'followed-open': async (qc) => {
    const item = await qc.fetchQuery({ queryKey: qk.inbox.item(FOLLOWED.item), queryFn: () => api.inboxItem(FOLLOWED.item) })
    return item.state === 'open' ? null : `K. Owens #4821 is ${item.state.replace(/_/g, ' ')} in this practice’s data, so it is no longer in the Inbox for the tour to follow.`
  },
  'triage-ready': async (qc) => {
    const d = await qc.fetchQuery({ queryKey: qk.claim(FOLLOWED.triage), queryFn: () => api.claim(FOLLOWED.triage) })
    if (d.open_inbox_items.length > 0) return 'P. Hale #4744 was already triaged in this practice’s data: it has an open Inbox item, so there is nothing new to ask.'
    if (d.claim.in_flight) return `An agent run is in flight on P. Hale #4744 (${d.claim.in_flight}).`
    return null
  },
}

/** The step as the tour shows it now: itself, or, before its `after` step's Try it has run, that step's control and Try it. */
export function resolveStep(tour: Tour, step: Step, tried: ReadonlySet<string>): Step & { waiting?: string } {
  if (!step.after || tried.has(step.after.step) || tried.has(step.id)) return step
  const from = tour.steps.find((s) => s.id === step.after?.step)
  if (!from?.tryIt || !from.anchor) return step
  return {
    ...step,
    anchor: from.anchor,
    ...(from.route ? { route: from.route } : {}),
    ...(from.needs ? { needs: from.needs } : {}),
    ...(from.missing ? { missing: from.missing } : {}),
    tryIt: { ...from.tryIt, then: 'stay' },
    waiting: step.after.note,
  }
}
