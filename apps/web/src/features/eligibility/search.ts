/** /eligibility search params: the day shown and the selected appointment (benefits panel) are in the URL. */
import { z } from 'zod'

export const eligibilitySearchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  appt: z
    .string()
    .regex(/^[\w-]{1,60}$/)
    .optional()
    .catch(undefined),
})
export type EligibilitySearch = z.output<typeof eligibilitySearchSchema>
