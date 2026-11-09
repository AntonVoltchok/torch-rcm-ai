import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useRouter } from '@tanstack/react-router'
import { qk } from '@/api/queryKeys'
import type { Clock } from '@/api/schema'
import { useSwitchUser } from '@/features/shell/UserSwitcher'
import { session, type DemoUser } from '@/state/session'
import { press, TryFailed, unhover, until } from './anchors'
import { NEEDS, resolveStep } from './needs'
import { RESET_DEMO, TOURS } from './registry'
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

/** The tour is putting the practice in the state a step needs (a reset to the seed), or could not. */
export interface Preparing {
  why: string
  error?: string
}

interface TourApi {
  active: Active | null
  /** The current step as shown: before an earlier Try it it depends on has run, that step's control (needs.ts). */
  step: (Step & { waiting?: string }) | null
  preparing: Preparing | null
  /** After a failed reset: `retry` tries again, otherwise the step is drawn as the practice is. */
  settlePrepare: (retry: boolean) => void
  screenTour: TourId | null
  /** `opener`: where focus returns on exit (a menu passes its toggle, since its items unmount). */
  start: (id: TourId, opener?: HTMLElement | null) => void
  exit: () => void
  go: (idx: number) => void
  /** Runs a step's "Try it". Resolves `aborted` when the tour was exited meanwhile, so the caller does nothing more. */
  runTry: (step: Step) => Promise<{ ok: true } | { ok: false; message: string } | { aborted: true }>
  /** A "Try it" is running: steps hold still until the app answers (Esc still exits, and stops it). */
  busy: boolean
  /** A Try-it changed the practice this load (approve, triage, the clock): the finish offers the reset. */
  changed: boolean
  setChanged: (c: boolean) => void
}

/** The persona the main tour's copy is written for. */
const TOUR_PERSONA: DemoUser['id'] = 'usr_dana'

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
  const [changed, setChanged] = useState(false)
  const [preparing, setPreparing] = useState<Preparing | null>(null)
  /** Steps whose Try it changed the practice in this tour; from then on the tour never resets it on its own. */
  const [tried, setTried] = useState<ReadonlySet<string>>(new Set())
  const triedRef = useRef(tried)
  triedRef.current = tried
  /** At most one reset per tour: a need still unmet after it is drawn as is, with the step's missing note. */
  const prepared = useRef(false)
  const [prepTick, setPrepTick] = useState(0)
  const activeRef = useRef(active)
  activeRef.current = active
  const opener = useRef<HTMLElement | null>(null)
  /** The persona to give back on exit, when the main tour switched to Dana. */
  const restoreUser = useRef<DemoUser['id'] | null>(null)
  const tryAbort = useRef<AbortController | null>(null)
  /** The step whose route has been reached; a pathname change after that is the user's own (Back), not the tour's. */
  const settled = useRef<string | null>(null)
  const screenTour = tourForPath(pathname)

  // `replace`: a tour's steps are not history entries, so Back leaves the tour instead of walking through it.
  const navigate = useCallback(
    async (to: string, search?: Record<string, unknown>) => {
      await router.navigate({ to, replace: true, ...(search ? { search } : {}) } as Parameters<typeof router.navigate>[0])
    },
    [router],
  )

  const start = useCallback(
    (id: TourId, from?: HTMLElement | null) => {
      // A tour started from inside another (the finish modal) keeps the first opener.
      if (!activeRef.current) opener.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      tryAbort.current?.abort()
      tryAbort.current = null
      setBusy(false)
      setPreparing(null)
      setTried(new Set())
      prepared.current = false
      unhover()
      tourStore.markSeen(id)
      setActive({ tour: TOURS[id], idx: 0 })
    },
    [],
  )

  const exit = useCallback(() => {
    tryAbort.current?.abort()
    tryAbort.current = null
    unhover()
    setActive(null)
    setBusy(false)
    setPreparing(null)
    settled.current = null
    const restore = restoreUser.current
    restoreUser.current = null
    if (restore && session.get().userId !== restore) void switchUser(restore)
    const back = opener.current
    opener.current = null
    // Back to whatever opened the tour once the shell is interactive again, or to the screen if that is gone.
    requestAnimationFrame(() => (back?.isConnected ? back : document.getElementById('main'))?.focus())
  }, [switchUser])

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

  const raw = active ? (active.tour.steps[active.idx] ?? null) : null
  const step = useMemo(() => (active && raw ? resolveStep(active.tour, raw, tried) : null), [active, raw, tried])
  const stepKey = active && step ? `${active.tour.id}:${step.id}` : null

  // The main tour is written as Dana: past the welcome it signs in as her with the app's own switcher, and exit gives
  // the viewer's persona back.
  useEffect(() => {
    if (!active || active.tour.id !== 'main' || active.idx === 0 || busy) return
    const current = session.get().userId
    if (current === TOUR_PERSONA || restoreUser.current) return
    restoreUser.current = current
    void switchUser(TOUR_PERSONA)
  }, [active, busy, switchUser])

  // Back (or any navigation the tour did not make) once a step has reached its route ends the tour.
  useEffect(() => {
    if (!active || !step || step.modal || busy || settled.current !== stepKey) return
    const ok = step.route ? pathname === step.route.to : tourForPath(pathname) === active.tour.id
    if (!ok) exit()
  }, [pathname, active, step, stepKey, busy, exit])

  // Every ctx call checks the signal, so Esc stops a Try-it between its steps (a request already sent still lands).
  const runTry = useCallback<TourApi['runTry']>(
    async (s) => {
      if (!s.tryIt) return { ok: true }
      tryAbort.current?.abort()
      const ctrl = new AbortController()
      tryAbort.current = ctrl
      const { signal } = ctrl
      // Mutations that existed before the press; anything else in the cache was started by it (GC-safe, unlike an index).
      let before: Set<unknown> | null = null
      const since = () => (before ? qc.getMutationCache().getAll().filter((m) => !before?.has(m)) : [])
      const live = () => {
        if (signal.aborted) throw new DOMException('Tour exited', 'AbortError')
      }
      const ctx: TryCtx = {
        signal,
        navigate: async (to, search) => {
          live()
          await navigate(to, search)
        },
        switchUser: async (id) => {
          live()
          await switchUser(id)
        },
        press: (name) => {
          live()
          before = new Set(qc.getMutationCache().getAll())
          press(name)
        },
        pressSettled: () => {
          const started = since()
          return started.length > 0 && started.every((m) => m.state.status === 'success')
        },
        // A mutation the press started that failed ends the wait at once, with the app's own message.
        until: (fn, ms, what) =>
          until(
            () => {
              const failed = since().find((m) => m.state.status === 'error')
              if (failed) throw new TryFailed(failed.state.error instanceof Error ? failed.state.error.message : 'The server refused it.')
              return fn()
            },
            ms,
            what,
            signal,
          ),
        clockNow: () => qc.getQueryData<Clock>(qk.clock)?.now,
        clockAdvancing: () => Boolean(qc.getQueryData<Clock>(qk.clock)?.advancing),
      }
      setBusy(true)
      // A Try-it may switch personas (the reset, the overnight); an exit mid-way stops it before it switches back, so
      // exit must know whom to give the app back to. Restored to what it was once the Try-it ends on its own.
      const restore = restoreUser.current
      if (!restore) restoreUser.current = session.get().userId
      try {
        await s.tryIt.run(ctx)
        if (s.tryIt.mutates && !signal.aborted) {
          setChanged(true)
          setTried((t) => new Set(t).add(s.id))
        }
        return signal.aborted ? { aborted: true } : { ok: true }
      } catch (e) {
        return signal.aborted ? { aborted: true } : { ok: false, message: e instanceof Error ? e.message : 'That did not work.' }
      } finally {
        if (!signal.aborted) {
          setBusy(false)
          restoreUser.current = restore
        }
        if (tryAbort.current === ctrl) tryAbort.current = null
      }
    },
    [navigate, switchUser, qc],
  )

  // A ref, so the route effect does not re-run (and drop its reset) each time runTry's identity changes.
  const runTryRef = useRef(runTry)
  runTryRef.current = runTry

  // Each step's route, URL first. A step without one uses its tour's screen, and keeps the user's filters there. A step
  // that needs a practice state the demo has left (needs.ts) gets it first: the owner's reset, as the finish offers it,
  // unless a Try-it in this tour moved the practice on, which the step's missing note then says.
  useEffect(() => {
    settled.current = null
    if (!active || !step || step.modal) return
    let live = true
    void (async () => {
      if (step.needs && !prepared.current && triedRef.current.size === 0) {
        const why = await NEEDS[step.needs](qc).catch(() => null)
        if (!live) return
        if (why) {
          prepared.current = true
          setPreparing({ why })
          // The reset's outcome is shown even if this effect was superseded meanwhile; only the navigation below is not.
          const r = await runTryRef.current({ ...step, tryIt: RESET_DEMO })
          if ('aborted' in r) return
          if (!r.ok) {
            setPreparing({ why, error: r.message })
            return
          }
          setChanged(false)
          setPreparing(null)
          if (!live) return
        }
      }
      // A step without its own route stays on any screen of its tour (the claim on screen, the user's filters).
      if (!step.route && tourForPath(router.state.location.pathname) === active.tour.id) {
        if (live) settled.current = `${active.tour.id}:${step.id}`
        return
      }
      const want = step.route ?? { to: active.tour.home }
      const extra = step.searchFrom ? await step.searchFrom(qc).catch(() => ({})) : {}
      const search = want.search || step.searchFrom ? { ...want.search, ...extra } : undefined
      const here = router.state.location
      const sameSearch = !search || Object.entries(search).every(([k, v]) => (here.search as Record<string, unknown>)[k] === v)
      if (!live) return
      if (here.pathname !== want.to || !sameSearch) await navigate(want.to, search)
      if (live) settled.current = `${active.tour.id}:${step.id}`
    })()
    return () => {
      live = false
    }
  }, [active, step, router, navigate, qc, prepTick])

  const settlePrepare = useCallback((retry: boolean) => {
    if (retry) prepared.current = false
    setPreparing(null)
    setPrepTick((t) => t + 1)
  }, [])

  const api = useMemo<TourApi>(
    () => ({ active, step, preparing, settlePrepare, screenTour, start, exit, go, runTry, busy, changed, setChanged }),
    [active, step, preparing, settlePrepare, screenTour, start, exit, go, runTry, busy, changed],
  )
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}
