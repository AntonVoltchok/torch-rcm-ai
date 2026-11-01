import type { ReactNode } from 'react'
import { render } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { createAppRouter, createQueryClient } from '@/router'

/** The whole app at a URL, against whatever MSW server the test started. */
export function renderApp(url: string) {
  const queryClient = createQueryClient({ retry: false })
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [url] }))
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...utils, queryClient, router }
}

/** One component with a router and query client around it (for components that render <Link>). */
export function renderWithProviders(ui: ReactNode) {
  const queryClient = createQueryClient({ retry: false })
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <>{ui}</> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...utils, queryClient }
}
