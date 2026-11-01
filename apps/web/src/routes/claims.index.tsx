import { createFileRoute } from '@tanstack/react-router'
import { claimsSearchSchema } from '@/features/claims/search'
import { ClaimsPage } from '@/features/claims/ClaimsPage'

export const Route = createFileRoute('/claims/')({
  validateSearch: claimsSearchSchema,
  component: ClaimsPage,
})
