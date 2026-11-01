import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { deniedWithToast } from '@/features/shell/guards'

export const Route = createFileRoute('/settings')({
  beforeLoad: () => {
    if (deniedWithToast('/settings/agents', 'Settings')) throw redirect({ to: '/inbox' })
  },
  component: Outlet,
})
