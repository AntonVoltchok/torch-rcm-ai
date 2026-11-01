import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { deniedWithToast } from '@/features/shell/guards'

export const Route = createFileRoute('/settings')({
  beforeLoad: () => {
    if (deniedWithToast('/settings/agents', 'Settings', 'Settings is for billing and the owner.')) throw redirect({ to: '/inbox' })
  },
  component: Outlet,
})
