import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useRouter } from '@tanstack/react-router'
import { qk } from '@/api/queryKeys'
import type { Clock } from '@/api/schema'
import { useSwitchUser } from '@/features/shell/UserSwitcher'
import { until } from './anchors'
import { TOURS } from './registry'
import { tourForPath } from './screens'
import { tourStore } from './store'
import type { Step, Tour, TourId, TryCtx } from './types'

/**
 * The tour's state: which tour is open and at which step. Transient chrome, like an open menu, so it is not in the URL;
 * everything a step changes on screen (the selected item, a filter, the route) goes through the router, so the URL
 * stays the source of truth for the app. Auto-open: the main tour on every load (dismissal lasts for this load), a
 * screen tour on the first navigation to its screen (remembered in localStorage). `torchrcm.tour.autoopen=false`
 * turns both off for test suites.
 */
interface Active {
  tour: Tour
  idx: number
}

interface TourApi {
  active: Active | null
  step: Step | null
  screenTour: TourId | null
  start: (id: TourId) => void
  exit: () => void
  go: (idx: number) => void
  tryCtx: TryCtx
  /** A "Try it" is running: steps hold still until the app answers (Esc still exits). */
  busy: boolean
  setBusy: (b: boolean) => void
}

const Ctx = createContext<TourApi | null>(null)

export function useTour(): TourApi {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTour outside TourProvider')
  return v
}

/** True while a tour or its modal covers the app (the shell marks itself inert). */
export const useTourOpen = () => useTour().active !== null

export function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const qc = useQueryClient()
  const switchUser = useSwitchUser()
  const pathname = useLocation({ select: (l) => l.pathname })
  const [active, setActive] = useState<Active | null>(null)
  const [busy, setBusy] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const screenTour = tourForPath(pathname)

  const navigate = useCallback(
    async (to: string, search?: Record<string, unknown>) => {
      await router.navigate({ to, ...(search ? { search } : {}) } as Parameters<typeof router.navigate>[0])
    },
    [router],
  )

  const start = useCallback((id: TourId) => {
    if (document.activeElement instanceof HTMLElement) opener.current = document.activeElement
    tourStore.markSeen(id)
    setActive({ tour: TOURS[id], idx: 0 })
  }, [])

  const exit = useCallback(() => {
    setActive(null)
    setBusy(false)
    const back = opener.current
    opener.current = null
    // Back to whatever opened the tour, once the shell is interactive again.
    if (back?.isConnected) requestAnimationFrame(() => back.focus())
  }, [])

  const go = useCallback((idx: number) => {
    setActive((a) => (a ? { ...a, idx: Math.max(0, Math.min(a.tour.steps.length - 1, idx)) } : a))
  }, [])

  // The main tour on every load.
  useEffect(() => {
    if (tourStore.autoOpen()) start('main')
  }, [start])

  // A screen tour the first time its screen is navigated to (not on the load itself: the main tour has that).
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    if (active || !screenTour || !tourStore.autoOpen() || tourStore.seen(screenTour)) return
    start(screenTour)
  }, [pathname, active, screenTour, start])

  const step = active ? (active.tour.steps[active.idx] ?? null) : null

  // Each step's route, URL first. A step without one uses its tour's screen, and keeps the user's filters there.
  useEffect(() => {
    if (!active || !step || step.modal) return
    let live = true
    void (async () => {
      const want = step.route ?? { to: active.tour.home }
      const extra = step.searchFrom ? await step.searchFrom(qc).catch(() => ({})) : {}
      const search = want.search || step.searchFrom ? { ...want.search, ...extra } : undefined
      const here = router.state.location
      const sameSearch = !search || Object.entries(search).every(([k, v]) => (here.search as Record<string, unknown>)[k] === v)
      if (!live || (here.pathname === want.to && sameSearch)) return
      await navigate(want.to, search)
    })()
    return () => {
      live = false
    }
  }, [active, step, router, navigate, qc])

  const tryCtx = useMemo<TryCtx>(
    () => ({
      navigate,
      switchUser: async (id) => {
        await switchUser(id)
      },
      until,
      clockNow: () => qc.getQueryData<Clock>(qk.clock)?.now,
      clockAdvancing: () => Boolean(qc.getQueryData<Clock>(qk.clock)?.advancing),
    }),
    [navigate, switchUser, qc],
  )

  const api = useMemo<TourApi>(() => ({ active, step, screenTour, start, exit, go, tryCtx, busy, setBusy }), [active, step, screenTour, start, exit, go, tryCtx, busy])
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}
