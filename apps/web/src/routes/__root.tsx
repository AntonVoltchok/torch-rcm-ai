import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link } from '@tanstack/react-router'
import { RootLayout } from '@/features/shell/RootLayout'
import { EmptyState } from '@/components/EmptyState'

export interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: () => (
    <EmptyState
      title="No such screen"
      action={
        <Link to="/inbox" className="font-medium text-act">
          Go to the Inbox
        </Link>
      }
    >
      Every screen in TorchRCM is in the sidebar.
    </EmptyState>
  ),
  errorComponent: ({ error, reset }) => (
    <EmptyState
      title="Something broke on this screen"
      action={
        <button type="button" className="font-medium text-act underline underline-offset-2" onClick={reset}>
          Try again
        </button>
      }
    >
      {error instanceof Error ? error.message : String(error)}
    </EmptyState>
  ),
})
