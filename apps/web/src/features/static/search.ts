/** Search params of the static screens. Same rule as everywhere: the URL owns filters and tabs. */
import { z } from 'zod'
import { AgentKind } from '@/api/schema'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const activitySearchSchema = z.object({
  day: day.optional().catch(undefined),
  agent: AgentKind.optional().catch(undefined),
  outcome: z.enum(['ran', 'to_you', 'would_have_run', 'failed']).optional().catch(undefined),
})

export const eligibilitySearchSchema = z.object({
  date: day.optional().catch(undefined),
  appt: z.string().max(60).optional().catch(undefined),
})

export const SETTINGS_TABS = ['rules', 'proposals', 'changes'] as const
export const settingsSearchSchema = z.object({
  tab: z.enum(SETTINGS_TABS).optional().catch(undefined),
  rule: z.string().max(60).optional().catch(undefined),
})
