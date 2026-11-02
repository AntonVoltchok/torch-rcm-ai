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
    <EmptyState title="No such screen" action={<Link to="/inbox">Go to the Inbox</Link>}>
      Every screen in Torch is in the sidebar.
    </EmptyState>
  ),
  errorComponent: ({ error, reset }) => (
    <EmptyState title="Something broke on this screen" action={<button type="button" className="font-semibold text-acc underline" onClick={reset}>Try again</button>}>
      {error instanceof Error ? error.message : String(error)}
    </EmptyState>
  ),
})
