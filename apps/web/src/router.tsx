/** Router + query client wiring. Readable search strings (lib/searchSerde.ts); context carries the QueryClient. */
import { hashKey, QueryClient } from '@tanstack/react-query'
import { createRouter, type RouterHistory } from '@tanstack/react-router'
import { configureApi } from '@/api/client'
import { qk } from '@/api/queryKeys'
import type { StripSummary } from '@/api/schema'
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

/**
 * A mutation's `meta.counts` is this viewer's strip across every location. That is the "All locations" strip, so badges
 * move without a refetch; any other strip stays the server's to compute.
 */
function applyCounts(queryClient: QueryClient, counts: StripSummary) {
  const allLocations = qk.strip(undefined)
  const scoped = session.locationParam() !== undefined
  if (!scoped) queryClient.setQueryData(allLocations, counts)
  void queryClient.invalidateQueries({ queryKey: qk.stripAll, predicate: (q) => scoped || hashKey(q.queryKey) !== hashKey(allLocations) })
}

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  configureApi({ onCounts: (counts) => applyCounts(queryClient, counts) })
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
