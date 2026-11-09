/**
 * /inbox search params. `item` is the selected item (survives refresh, back button works); `group` is the
 * expanded batch group; `launch` is the run panel being viewed, or `STARTING` while an approval is on its way.
 * Filters are `state`, `kind`, `agent`.
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

/**
 * `?launch=starting`: the run pane is open for the approval this tab just sent, before the server has named the
 * run. The pane reads it from the pending mutation; with none (a reload), the URL means nothing and the item shows.
 * Run ids are `run_…`, so the value cannot collide.
 */
export const STARTING = 'starting'

/** The filter tabs, in order. `kind` is the URL value; undefined is All. */
export const INBOX_TABS: { kind: InboxItemKind | undefined; label: string }[] = [
  { kind: undefined, label: 'All' },
  { kind: 'approve_action', label: 'Approvals' },
  { kind: 'review_draft', label: 'Drafts' },
  { kind: 'variance', label: 'Variances' },
  { kind: 'eligibility_flag', label: 'Eligibility' },
]
