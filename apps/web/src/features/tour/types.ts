/**
 * The tour's data model. A tour is a list of steps; a step either centres a modal (welcome, finish) or spotlights a
 * real element of the app, named by its `data-tour` anchor. Step copy is a component so it can read numbers through
 * the app's own query hooks; it never types a number the server computes (see `Num`).
 */
import type { ComponentType } from 'react'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { DemoUser } from '@/state/session'
import type { PayloadName } from './payloads'

export type TourId = 'main' | 'inbox' | 'denials' | 'ledger' | 'claims' | 'claim' | 'payments' | 'patients' | 'eligibility' | 'activity' | 'cash' | 'settings'

/** Where a pane's text came from; drawn as a tag beside its source line. */
export type PaneKind = 'captured' | 'cache' | 'rendered' | 'source' | 'synthetic'

export type CodeSource =
  /** A response the app already holds in its query cache (or fetches through the typed client with the screen's own key). */
  | { type: 'query'; queryKey: QueryKey; queryFn: () => Promise<unknown>; enabled?: () => boolean; select?: (data: unknown) => unknown }
  /** The claim on screen (/claims/<id>), or #4821 elsewhere; `field` narrows it to one part. */
  | { type: 'claim-on-screen'; field?: string }
  /** The run this tab launched most recently (`['run', id]`, kept current by the run's SSE stream). */
  | { type: 'run'; kind: 'approve_group' | 'triage' }
  /** A generated, model-facing artifact under features/tour/payloads/. */
  | { type: 'static'; name: PayloadName }

export interface CodeTab {
  label: string
  /** The request or file, as shown above the pane. */
  source: string
  kind: PaneKind
  load: CodeSource
}

export interface TryIt {
  label: string
  busy: string
  /** Presses the real control. Resolves when the app has shown the result; rejects with the app's own words. */
  run: (ctx: TryCtx) => Promise<void>
  /** `next`: go to the next step when done. Otherwise stay, and re-anchor to `doneAnchor`. */
  then: 'next' | 'stay'
  /** Changes the practice's state (approve, triage, the clock); the finish then offers the reset. */
  mutates?: boolean
  done?: string
  doneAnchor?: string
}

export interface TryCtx {
  /** Aborted when the tour is exited; every other ctx call throws once it is. */
  signal: AbortSignal
  navigate: (to: string, search?: Record<string, unknown>) => Promise<void>
  /** Presses a real control by anchor (anchors.press), and from then on watches the mutations it starts. */
  press: (name: string) => void
  /** True once every mutation the last press started has succeeded. */
  pressSettled: () => boolean
  switchUser: (id: DemoUser['id']) => Promise<void>
  /** Resolves when `fn` returns true; polls the DOM and the query cache. Rejects after `ms`. */
  until: (fn: () => boolean, ms: number, what: string) => Promise<void>
  clockNow: () => string | undefined
  clockAdvancing: () => boolean
}

export interface Step {
  id: string
  title: string
  /** Eyebrow after "step n of m". */
  ey?: string
  /** The route the step needs; the tour navigates there (URL first) before drawing. */
  route?: { to: string; search?: Record<string, unknown> }
  /** Search params read from a server response (e.g. the first flagged appointment), merged into `route.search`. */
  searchFrom?: (qc: QueryClient) => Promise<Record<string, unknown>>
  anchor?: string
  /** Shown instead of the spotlight when the anchor is not on screen (the demo has moved past this state). */
  missing?: string
  body: ComponentType
  code?: CodeTab[]
  tryIt?: TryIt
  modal?: 'welcome' | 'finish'
}

export interface Tour {
  id: TourId
  /** The screen the tour belongs to; starting it from elsewhere goes there first. */
  home: string
  name: string
  blurb: string
  steps: Step[]
}
