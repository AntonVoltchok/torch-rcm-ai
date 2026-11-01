import { createFileRoute } from '@tanstack/react-router'
import { settingsSearchSchema } from '@/features/settings/search'
import { SettingsAgentsPage } from '@/features/settings/SettingsAgentsPage'

export const Route = createFileRoute('/settings/agents')({ validateSearch: settingsSearchSchema, component: SettingsAgentsPage })
