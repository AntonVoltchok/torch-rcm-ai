import { createFileRoute } from '@tanstack/react-router'
import { settingsSearchSchema } from '@/features/static/search'
import { SettingsAgentsPage } from '@/features/static/pages'

export const Route = createFileRoute('/settings/agents')({ validateSearch: settingsSearchSchema, component: SettingsAgentsPage })
