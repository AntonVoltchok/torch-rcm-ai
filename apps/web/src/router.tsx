/** Router + query client wiring. Readable search strings (lib/searchSerde.ts); context carries the QueryClient. */
import { QueryClient } from '@tanstack/react-query'
import { createRouter, type RouterHistory } from '@tanstack/react-router'
import { configureApi } from '@/api/client'
import { qk } from '@/api/queryKeys'
import { isApiError } from '@/api/client'
import { parseSearch, stringifySearch } from '@/lib/searchSerde'
import { session } from '@/state/session'
import { routeTree } from './routeTree.gen'

export function createQueryClient(opts: { retry?: boolean } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // 4xx are answers, not blips: don't retry them.
        retry: opts.retry === false ? false : (n, err) => n < 2 && !(isApiError(err) && err.status >= 400 && err.status < 500),
      },
      mutations: { retry: false },
    },
  })
}

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  // Every mutation response's `meta.counts` lands here: badges and strip move without a refetch.
  configureApi({ onCounts: (counts) => queryClient.setQueryData(qk.strip(session.locationParam()), counts) })
  return createRouter({
    routeTree,
    context: { queryClient },
    ...(history ? { history } : {}),
    parseSearch,
    stringifySearch,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
