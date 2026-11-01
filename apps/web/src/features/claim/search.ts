/** /claims/$claimId search: `from=inbox:<itemId>` keeps the Inbox breadcrumb; `launch` shows a run panel. */
import { z } from 'zod'

export const claimSearchSchema = z.object({
  from: z
    .string()
    .regex(/^(inbox|claims):[\w-]*$/)
    .optional()
    .catch(undefined),
  launch: z.string().max(60).optional().catch(undefined),
})
export type ClaimSearch = z.output<typeof claimSearchSchema>

export function parseFrom(from: string | undefined): { kind: 'inbox'; itemId: string } | { kind: 'claims' } | null {
  if (!from) return null
  const [kind, id = ''] = from.split(':')
  if (kind === 'inbox' && id) return { kind: 'inbox', itemId: id }
  if (kind === 'claims') return { kind: 'claims' }
  return null
}
