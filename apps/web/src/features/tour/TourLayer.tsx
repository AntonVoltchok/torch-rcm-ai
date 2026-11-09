import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type WheelEvent } from 'react'
import { cn } from '@/lib/cn'
import { useCurrentUser } from '@/state/session'
import { CodePane } from './CodePane'
import { RESET_DEMO, TOURS } from './registry'
import { toursFor } from './screens'
import { tourStore, useCodeOpen, useSeen } from './store'
import { useTour } from './TourProvider'
import { useAnchorRect } from './useAnchorRect'
import type { Step } from './types'

/**
 * What a running tour draws over the app: a shade with a hole and an accent outline around the step's real element,
 * and a two-column card (text left, payload right) placed where it does not cover that element. Modal steps (welcome,
 * finish) are a centred dialog. The app underneath is `inert` while this is up (RootLayout), so focus, clicks and the
 * screen's own shortcuts stay in the tour; Esc or "Exit tour" gives the app back at any step.
 */
export function TourLayer() {
  const { active, step, preparing } = useTour()
  useTourKeys()
  if (!active || !step) return null
  if (step.modal) return <TourModal step={step} />
  return preparing ? <PrepareCard /> : <Spotlight step={step} key={`${active.tour.id}:${active.idx}`} />
}

/** The tour is resetting the practice so the next step has what it shows (needs.ts); the shell stays covered meanwhile. */
function PrepareCard() {
  const { active, preparing, settlePrepare, exit } = useTour()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[data-tour-next]')?.focus({ preventScroll: true })
  }, [preparing?.error])
  if (!preparing) return null
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-shade p-4">
      <div
        ref={box}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-testid="tour-preparing"
        onKeyDown={trapTab}
        className="box-border flex w-[500px] max-w-full flex-col gap-2.5 rounded-xl bg-paper px-4 pb-3 pt-3 text-[13.5px] leading-relaxed text-ink shadow-[0_0_0_1px_rgb(22_26_34/0.08),0_22px_60px_rgb(22_26_34/0.30)]"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-soft">{active?.tour.name} · setting up</span>
        <h2 id="tour-title" className="m-0 text-[17px] font-semibold leading-tight tracking-[-0.012em]">
          {preparing.error ? 'The reset did not finish' : 'Putting the practice back at the seed'}
        </h2>
        <div id="tour-body" className="flex flex-col gap-2.5">
          <p className="m-0">{preparing.why}</p>
          <p className="m-0 text-mid">
            The tour shows each step on the data it describes, so it presses Dr. Morgan’s <b className="text-ink">Reset demo</b> (the same button the owner has) and
            signs you back in.
          </p>
          {preparing.error ? (
            <p role="alert" className="m-0 text-xs font-medium text-risk-ink" data-testid="tour-preparing-error">
              {preparing.error}
            </p>
          ) : (
            <p role="status" className="m-0 text-xs text-soft">
              Resetting…
            </p>
          )}
        </div>
        <footer className="mt-1 flex items-center gap-2 border-t border-line pt-2.5">
          <button type="button" onClick={exit} className="px-0.5 py-1.5 text-[12.5px] font-medium text-mid underline underline-offset-2 hover:text-ink">
            Exit tour
          </button>
          <span className="flex-1" />
          {preparing.error && (
            <>
              <button type="button" onClick={() => settlePrepare(false)} className="rounded-md border border-line-strong bg-paper px-3.5 py-1.5 text-[13px] font-semibold">
                Continue as is
              </button>
              <button
                type="button"
                data-tour-next=""
                onClick={() => settlePrepare(true)}
                className="rounded-md border border-act bg-act px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-act-hover"
              >
                Try again
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

const PAD = 5
const GAP = 14
const M = 12

function Spotlight({ step }: { step: Step & { waiting?: string } }) {
  const { active, go, exit, runTry: run, busy } = useTour()
  const [nudge, setNudge] = useState(false)
  const codeOpen = useCodeOpen() && Boolean(step.code?.length)
  const [doneAnchor, setDoneAnchor] = useState<string | undefined>(undefined)
  const anchor = useAnchorRect(doneAnchor ?? step.anchor, `${step.id}:${doneAnchor ?? ''}`)
  const card = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<CSSProperties & { narrow?: boolean }>({ opacity: 0 })
  const [tryState, setTryState] = useState<{ ok: boolean; message: string } | null>(null)

  const tour = active?.tour
  const idx = active?.idx ?? 0
  const anchored = tour?.steps.filter((s) => !s.modal) ?? []
  const n = anchored.findIndex((s) => s.id === step.id)
  const last = tour ? idx === tour.steps.length - 1 : true
  const rect = anchor.rect || null
  // Re-place when the card's own content changes size (an error, the missing note) or the window does.
  const [relayout, setRelayout] = useState(0)
  useEffect(() => {
    const bump = () => setRelayout((n) => n + 1)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(bump)
    const text = card.current?.querySelector('[data-testid="tour-text"]')
    if (text) ro?.observe(text)
    window.addEventListener('resize', bump)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', bump)
    }
  }, [])

  // Place the card: below or above the element when a usable card fits, else narrow beside it, else over the half
  // of the screen the element is not in (ported from the mock's place(), DECISIONS D10).
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const wide = Math.min(1180, vw - 2 * M)
    const narrowW = Math.min(500, vw - 2 * M)
    if (!rect) {
      const W = codeOpen ? wide : narrowW
      const H = codeOpen ? Math.min(560, vh - 2 * M) : undefined
      setPos({ left: (vw - W) / 2, top: Math.max(M, (vh - (H ?? el.offsetHeight)) / 2), width: W, height: H, opacity: 1 })
      return
    }
    const r = { top: rect.top - PAD, left: rect.left - PAD, right: rect.right + PAD, bottom: rect.bottom + PAD }
    const below = vh - r.bottom - GAP - M
    const above = r.top - GAP - M
    const right = vw - r.right - GAP - M
    const left = r.left - GAP - M
    let W = codeOpen ? wide : narrowW
    let H: number
    let top: number
    let x: number | undefined
    let narrow = false
    if (!codeOpen) {
      el.style.width = `${W}px`
      el.style.height = 'auto'
      H = el.offsetHeight
      if (below >= H) top = r.bottom + GAP
      else if (above >= H) top = r.top - GAP - H
      else if (right >= W) [x, top] = [r.right + GAP, r.top]
      else if (left >= W) [x, top] = [r.left - GAP - W, r.top]
      else top = (r.top + r.bottom) / 2 > vh / 2 ? M : vh - M - H
    } else {
      const want = Math.min(560, Math.max(380, vh * 0.56))
      const minH = 330
      if (below >= minH) [H, top] = [Math.min(want, below), r.bottom + GAP]
      else if (above >= minH) {
        H = Math.min(want, above)
        top = r.top - GAP - H
      } else if (right >= narrowW || left >= narrowW) {
        W = narrowW
        narrow = true
        H = Math.min(vh - 2 * M, 640)
        x = right >= narrowW ? r.right + GAP : r.left - GAP - W
        top = Math.max(M, Math.min(r.top, vh - M - H))
      } else {
        const mid = (r.top + r.bottom) / 2
        H = Math.min(want, Math.max(minH, mid > vh / 2 ? mid - 60 - M : vh - mid - 60 - M))
        top = mid > vh / 2 ? M : vh - M - H
      }
    }
    if (x === undefined) x = W >= vw - 2 * M - 40 ? (vw - W) / 2 : (r.left + r.right) / 2 - W / 2
    x = Math.max(M, Math.min(x, vw - W - M))
    top = Math.max(M, Math.min(top, vh - M - H))
    setPos({ left: x, top, width: W, height: codeOpen ? H : undefined, narrow, opacity: 1 })
  }, [rect, codeOpen, relayout])

  // Focus the primary button when a step opens: keyboard users land in the card.
  useEffect(() => {
    card.current?.querySelector<HTMLButtonElement>('[data-tour-next]')?.focus({ preventScroll: true })
  }, [step])

  const runTry = async () => {
    const t = step.tryIt
    if (!t || busy) return
    setTryState(null)
    const r = await run(step)
    if ('aborted' in r) return
    if (!r.ok) setTryState({ ok: false, message: r.message })
    else if (t.then === 'next') go(idx + 1)
    else {
      setTryState({ ok: true, message: t.done ?? 'Done.' })
      if (t.doneAnchor) setDoneAnchor(t.doneAnchor)
    }
  }

  // The shade passes the wheel to whatever scrolls the anchor, so a long screen can still be read during a step.
  const onWheel = (e: WheelEvent) => {
    let el: HTMLElement | null = anchor.el?.parentElement ?? null
    while (el && !(el.scrollHeight > el.clientHeight && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement
    el?.scrollBy({ top: e.deltaY, left: e.deltaX })
  }

  const hole = rect
    ? { top: 0, left: 0, transform: `translate(${rect.left - PAD}px, ${rect.top - PAD}px)`, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD }
    : null
  const Body = step.body
  const missing = anchor.rect === false

  return (
    <>
      {/* Shade with a hole: one element whose huge shadow is the dim overlay. A transparent shield under it takes clicks. */}
      <div
        className="fixed inset-0 z-40"
        aria-hidden
        data-testid="tour-shield"
        onWheel={onWheel}
        onClick={(e) => {
          e.stopPropagation()
          setNudge(true)
        }}
      />
      {hole ? (
        <div
          aria-hidden
          data-testid="tour-hole"
          className="pointer-events-none fixed z-40 rounded-[9px] shadow-[0_0_0_200vmax_var(--color-shade)] outline-2 outline-offset-1 outline-act motion-safe:transition-[transform,width,height] motion-safe:duration-200"
          style={hole}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0 z-40 bg-shade" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-testid="tour-card"
        onKeyDown={trapTab}
        style={pos}
        className={cn('fixed z-40 box-border flex flex-col overflow-hidden rounded-xl bg-paper text-ink shadow-[0_0_0_1px_rgb(22_26_34/0.08),0_22px_60px_rgb(22_26_34/0.30)]')}
      >
        <div className="flex items-center gap-2.5 px-4 pt-3">
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-soft">
            {tour?.name} · step {n + 1} of {anchored.length}
            {step.ey ? ` · ${step.ey}` : ''}
          </span>
          <span className="flex-1" />
          {step.code?.length ? (
            <button
              type="button"
              onClick={() => tourStore.setCodeOpen(!codeOpen)}
              className="whitespace-nowrap rounded-md border border-line-strong px-2 py-0.5 text-xs font-medium text-mid hover:border-ink hover:text-ink"
            >
              {codeOpen ? 'Hide code' : 'Show code'}
            </button>
          ) : null}
          <button type="button" aria-label="Exit tour" onClick={exit} className="px-0.5 text-lg leading-none text-soft hover:text-ink">
            ×
          </button>
        </div>
        <div className={cn('grid min-h-0 flex-1 gap-4 px-4 pt-2', codeOpen ? (pos.narrow ? 'grid-rows-[fit-content(55%)_minmax(0,1fr)]' : 'grid-cols-[minmax(0,42fr)_minmax(0,58fr)]') : 'grid-cols-1')}>
          <div className="flex min-h-0 flex-col gap-2.5 overflow-auto pb-1 pr-0.5 text-[13.5px] leading-relaxed text-ink" data-testid="tour-text">
            <h2 id="tour-title" className="m-0 text-[17px] font-semibold leading-tight tracking-[-0.012em] [text-wrap:balance]">
              {step.title}
            </h2>
            <div id="tour-body" className="flex flex-col gap-2.5" data-testid="tour-copy">
              <Body />
            </div>
            {nudge && (
              <p role="status" className="m-0 rounded-md border border-act-line bg-act-bg px-2.5 py-1.5 text-xs text-ink" data-testid="tour-nudge">
                The app is paused while the tour is open.{' '}
                {step.tryIt ? '“Try it” presses this control for you, or exit the tour to use it yourself.' : 'Exit the tour to use it yourself.'}
              </p>
            )}
            {step.waiting && (
              <p role="status" className="m-0 rounded-md border border-act-line bg-act-bg px-2.5 py-1.5 text-xs text-ink" data-testid="tour-waiting">
                {step.waiting}
              </p>
            )}
            {missing && (
              <p role="status" className="m-0 rounded-md border border-line-strong bg-fill px-2.5 py-1.5 text-xs text-mid" data-testid="tour-missing">
                <b className="text-ink">Not on screen right now.</b> {step.missing ?? 'This element is not on the screen in the demo’s current state.'}
              </p>
            )}
            {step.tryIt && (
              <div className="flex flex-col items-start gap-1.5">
                <button
                  type="button"
                  onClick={() => void runTry()}
                  disabled={busy || tryState?.ok === true || !rect}
                  className="rounded-md border border-act bg-act-bg px-3 py-1.5 text-[12.5px] font-semibold text-act hover:bg-act hover:text-white disabled:cursor-default disabled:opacity-50 disabled:hover:bg-act-bg disabled:hover:text-act"
                  data-testid="tour-try"
                >
                  {busy ? step.tryIt.busy : tryState?.ok ? (step.tryIt.done ?? 'Done') : step.tryIt.label}
                </button>
                {tryState && !tryState.ok && (
                  <p role="alert" className="m-0 text-xs font-medium text-risk-ink" data-testid="tour-try-error">
                    {tryState.message}
                  </p>
                )}
              </div>
            )}
          </div>
          {codeOpen && step.code && <CodePane tabs={step.code} />}
        </div>
        <footer className="mt-2.5 flex items-center gap-2 border-t border-line px-4 pb-3 pt-2.5">
          <button type="button" onClick={exit} className="px-0.5 py-1.5 text-[12.5px] font-medium text-mid underline underline-offset-2 hover:text-ink">
            Exit tour
          </button>
          <span className="flex flex-1 flex-wrap justify-center gap-[5px]" aria-hidden>
            {anchored.map((s, i) => (
              <i key={s.id} className={cn('h-1.5 w-1.5 rounded-full', i === n ? 'bg-act' : i < n ? 'bg-soft' : 'bg-line-strong')} />
            ))}
          </span>
          <button type="button" onClick={() => go(idx - 1)} disabled={idx === 0 || busy} className="rounded-md border border-line-strong bg-paper px-3.5 py-1.5 text-[13px] font-semibold disabled:opacity-40">
            Back
          </button>
          <button
            type="button"
            data-tour-next=""
            disabled={busy}
            onClick={() => (last ? exit() : go(idx + 1))}
            className="rounded-md border border-act bg-act px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-act-hover disabled:opacity-40"
          >
            {last ? 'Finish' : 'Next'}
          </button>
        </footer>
      </div>
    </>
  )
}

function TourModal({ step }: { step: Step }) {
  const { active, go, exit, start, changed, setChanged, runTry, busy } = useTour()
  const [resetError, setResetError] = useState<string | null>(null)
  const reset = async () => {
    setResetError(null)
    const r = await runTry({ ...step, tryIt: RESET_DEMO })
    if ('aborted' in r) return
    if (r.ok) setChanged(false)
    else setResetError(r.message)
  }
  const role = useCurrentUser().role
  const seen = useSeen()
  const box = useRef<HTMLDivElement>(null)
  const Body = step.body
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>('[data-tour-next]')?.focus({ preventScroll: true })
  }, [step])
  const welcome = step.modal === 'welcome'
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-shade p-4">
      <div
        ref={box}
        role="dialog"
        aria-labelledby="tour-title"
        data-testid="tour-modal"
        onKeyDown={trapTab}
        className="box-border flex max-h-[calc(100vh-32px)] w-[760px] max-w-full flex-col gap-3 overflow-auto rounded-[14px] bg-paper px-6 pb-4 pt-5 text-ink shadow-[0_24px_60px_rgb(0_0_0/0.30)]"
      >
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-soft">
          {step.ey}
          <button type="button" aria-label="Exit tour" onClick={exit} className="ml-auto text-xl leading-none text-soft hover:text-ink">
            ×
          </button>
        </div>
        <h2 id="tour-title" className="m-0 text-[24px] font-semibold tracking-[-0.018em] [text-wrap:balance]">
          {step.title}
        </h2>
        <div data-testid="tour-copy" className="flex flex-col gap-3">
          <Body />
        </div>
        {!welcome && changed && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border-l-[3px] border-practice-ink bg-practice-bg px-3 py-2 text-xs text-ink" data-testid="tour-changed">
            <span className="min-w-[240px] flex-1">
              The tour’s Try-its changed this practice (an approval, a triage or the clock). To walk the demo script from its start, reset the demo to the seed first.
            </span>
            <button type="button" disabled={busy} onClick={() => void reset()} className="rounded-md border border-act bg-paper px-2.5 py-1 font-semibold text-act hover:bg-act hover:text-white disabled:opacity-50">
              {busy ? RESET_DEMO.busy : RESET_DEMO.label}
            </button>
            {resetError && (
              <span role="alert" className="w-full font-medium text-risk-ink">
                {resetError}
              </span>
            )}
          </div>
        )}
        {!welcome && (
          <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0" aria-label="Screen tours">
            {toursFor(role).map((id) => (
              <li key={id} className="flex">
              <button
                type="button"
                onClick={() => start(id)}
                className="flex w-full min-w-0 flex-col gap-1 rounded-[9px] border border-line bg-paper px-3 py-2 text-left hover:border-act"
              >
                <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                  {TOURS[id].name}
                  <span className={cn('ml-auto rounded px-1.5 text-[10.5px] font-semibold', seen[id] ? 'bg-ok-bg text-ok' : 'border border-line bg-fill text-mid')}>
                    {seen[id] ? '✓ seen' : 'not yet'}
                  </span>
                </span>
                <span className="text-xs leading-snug text-mid">{TOURS[id].blurb}</span>
              </button>
              </li>
            ))}
          </ul>
        )}
        <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="min-w-[220px] flex-1 text-xs text-mid">
            {welcome
              ? 'Opens each time the app loads; exit any time and restart it from “Tour this screen” in the sidebar.'
              : 'Panes marked “live response” read the API through the app’s own client; “rendered” ran the real code on the seed; “recorded API response” is a cassette captured from the API and replayed.'}
          </span>
          <button type="button" onClick={welcome ? exit : () => start('main')} className="rounded-lg border border-line-strong bg-paper px-4 py-2 text-[13.5px] font-semibold">
            {welcome ? 'Skip, use the app' : 'Replay main tour'}
          </button>
          <button type="button" data-tour-next="" onClick={welcome ? () => go((active?.idx ?? 0) + 1) : exit} className="rounded-lg border border-act bg-act px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-act-hover">
            {welcome ? 'Start the tour' : 'Finish'}
          </button>
        </footer>
      </div>
    </div>
  )
}

/**
 * ← → step, Enter goes on (unless a control has focus: then it is that control's Enter), Esc exits. Captured at the
 * window before the app's own shortcuts (j/k/a/⇧A in useListKeys), which stay quiet while a tour is up: a stray "a"
 * must not approve anything behind the card.
 */
function useTourKeys() {
  const { active, go, exit, busy } = useTour()
  useEffect(() => {
    if (!active) return
    const steps = active.tour.steps
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') return
      e.stopPropagation()
      const t = e.target instanceof Element ? e.target : null
      const next = () => (active.idx >= steps.length - 1 ? exit() : go(active.idx + 1))
      if (e.key === 'Escape') {
        e.preventDefault()
        exit()
      } else if (busy) return
      else if (e.key === 'ArrowRight' && !t?.closest('[role=tablist], pre')) {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft' && !t?.closest('[role=tablist], pre')) {
        e.preventDefault()
        go(active.idx - 1)
      } else if (e.key === 'Enter' && !t?.closest('button, a, [role=tab], select, input, textarea')) {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, go, exit, busy])
}

/** Keeps Tab inside the dialog (the shell is inert as well; this covers browsers without `inert`). */
function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'Tab') return
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex="0"]'))
  const first = items[0]
  const lastEl = items.at(-1)
  if (!first || !lastEl) return
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    lastEl.focus()
  } else if (!e.shiftKey && document.activeElement === lastEl) {
    e.preventDefault()
    first.focus()
  }
}
