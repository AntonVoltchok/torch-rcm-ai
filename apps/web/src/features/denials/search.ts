/** /denials search: `row` is the selected claim (J/K move it), so Back to Denials returns to the same row. */
import { z } from 'zod'

export const denialsSearchSchema = z.object({
  row: z.string().regex(/^clm_[\w-]+$/).optional().catch(undefined),
})
export type DenialsSearch = z.output<typeof denialsSearchSchema>
