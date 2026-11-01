/**
 * /inbox search params. `item` is the selected item (survives refresh, back button works); `group` is the
 * expanded batch group; `launch` is the run panel being viewed. Filters are `state`, `kind`, `agent`.
 */
import { z } from 'zod'
import { AgentKind, InboxItemKind } from '@/api/schema'

export const InboxStateFilter = z.enum(['open', 'snoozed', 'done'])

export const inboxSearchSchema = z.object({
  state: InboxStateFilter.optional().catch(undefined),
  kind: InboxItemKind.optional().catch(undefined),
  agent: AgentKind.optional().catch(undefined),
  item: z.string().max(60).optional().catch(undefined),
  group: z.string().max(80).optional().catch(undefined),
  launch: z.string().max(60).optional().catch(undefined),
})
export type InboxSearch = z.output<typeof inboxSearchSchema>
