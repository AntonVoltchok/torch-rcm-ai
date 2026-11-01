import { createFileRoute } from '@tanstack/react-router'
import { inboxSearchSchema } from '@/features/inbox/search'
import { InboxPage } from '@/features/inbox/InboxPage'

export const Route = createFileRoute('/inbox')({
  validateSearch: inboxSearchSchema,
  component: InboxPage,
})
