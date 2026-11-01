import { createFileRoute } from '@tanstack/react-router'
import { claimSearchSchema } from '@/features/claim/search'
import { ClaimDetailPage } from '@/features/claim/ClaimDetailPage'
import { claimQuery } from '@/hooks/useClaims'

export const Route = createFileRoute('/claims/$claimId')({
  validateSearch: claimSearchSchema,
  // Start the one request the page needs while the route resolves; the page reads it via useClaim.
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(claimQuery(params.claimId))
  },
  component: ClaimDetailPage,
})
