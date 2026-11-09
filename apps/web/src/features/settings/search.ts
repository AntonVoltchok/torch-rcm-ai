/** /settings/agents search params: the tab and the selected rule (whose live preview is shown) live in the URL. */
import { z } from 'zod'

export const SETTINGS_TABS = ['rules', 'proposals', 'changes'] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]
export const settingsSearchSchema = z.object({
  tab: z.enum(SETTINGS_TABS).optional().catch(undefined),
  rule: z
    .string()
    .regex(/^[\w-]{1,80}$/)
    .optional()
    .catch(undefined),
})
export type SettingsSearch = z.output<typeof settingsSearchSchema>
