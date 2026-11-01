/** /activity search params: day, agent, outcome filters and the Observe-mode preview toggle are all in the URL. */
import { z } from 'zod'
import { ActivityOutcome, AgentKind } from '@/api/schema'
import { boolParam } from '@/features/claims/search'

export const activitySearchSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  agent: AgentKind.optional().catch(undefined),
  outcome: ActivityOutcome.optional().catch(undefined),
  /** "Observe mode preview": restyles what ran without review as what Observe mode would have logged instead. */
  observe: boolParam.optional().catch(undefined),
})
export type ActivitySearch = z.output<typeof activitySearchSchema>
