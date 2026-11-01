import { createFileRoute, redirect } from '@tanstack/react-router'
import { CashPage } from '@/features/static/pages'
import { deniedWithToast } from '@/features/shell/guards'

export const Route = createFileRoute('/cash')({
  beforeLoad: () => {
    if (deniedWithToast('/cash', 'Cash')) throw redirect({ to: '/inbox' })
  },
  component: CashPage,
})
