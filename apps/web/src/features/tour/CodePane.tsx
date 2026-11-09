import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { skipToken, useQuery } from '@tanstack/react-query'
import { useLocation } from '@tanstack/react-router'
import { api } from '@/api/endpoints'
import { qk } from '@/api/queryKeys'
import { runQueryOptions } from '@/hooks/useRun'
import { FOLLOWED } from './facts'
import { useLaunches } from '@/state/launches'
import { cn } from '@/lib/cn'
import { loadPayload } from './payloads'
import type { CodeSource, CodeTab, PaneKind } from './types'

/**
 * The right half of a tour card: the payload behind what the step shows. A `query` pane reads the same TanStack Query
 * cache the screen rendered (same key, same typed client), so it is the response on screen, not a copy taken earlier.
 * A `static` pane is a generated artifact (payloads.ts). Long arrays are trimmed for reading and say so.
 */
const KIND: Record<PaneKind, { label: string; cls: string }> = {
  captured: { label: 'live response', cls: 'bg-ok-bg text-ok' },
  cache: { label: 'GET + SSE, in cache', cls: 'bg-ok-bg text-ok' },
  rendered: { label: 'rendered on the seed', cls: 'bg-act-bg text-act' },
  source: { label: 'verbatim source', cls: 'bg-act-bg text-act' },
  synthetic: { label: 'hand-authored recording', cls: 'bg-practice-bg text-practice-ink' },
}

export function CodePane({ tabs }: { tabs: CodeTab[] }) {
  const [on, setOn] = useState(0)
  const id = useId()
  // Arrow keys move between tabs (WAI-ARIA tabs pattern); the tour's own ← → leave the tablist alone.
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = (on + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
    setOn(next)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
  }
  const tab = tabs[Math.min(on, tabs.length - 1)]
  if (!tab) return null
  const k = KIND[tab.kind]
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[9px] border border-line bg-fill" data-testid="tour-code">
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Payloads" onKeyDown={onTabKey} className="flex gap-0.5 overflow-x-auto border-b border-line bg-paper px-2 pt-1">
          {tabs.map((t, i) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              id={`${id}-tab-${i}`}
              aria-controls={`${id}-panel`}
              aria-selected={i === on}
              tabIndex={i === on ? 0 : -1}
              onClick={() => setOn(i)}
              className={cn('whitespace-nowrap border-b-2 px-2 pb-1.5 pt-1 text-xs font-medium', i === on ? 'border-act text-ink' : 'border-transparent text-mid hover:text-ink')}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 border-b border-line bg-paper px-2.5 py-1.5 text-xs text-mid">
        <b className="truncate font-mono font-semibold text-ink">{tab.source}</b>
        <span className={cn('ml-auto flex-none rounded px-1.5 text-[10.5px] font-semibold', k.cls)}>{k.label}</span>
      </div>
      <div role={tabs.length > 1 ? 'tabpanel' : undefined} id={`${id}-panel`} aria-labelledby={tabs.length > 1 ? `${id}-tab-${on}` : undefined} className="flex min-h-0 flex-1 flex-col">
        <PaneBody key={`${on}:${tab.label}`} load={tab.load} />
      </div>
    </div>
  )
}

function PaneBody({ load }: { load: CodeSource }) {
  if (load.type === 'static') return <StaticBody name={load.name} />
  if (load.type === 'run') return <RunBody kind={load.kind} />
  if (load.type === 'claim-on-screen') return <ClaimBody field={load.field} />
  return <QueryBody load={load} />
}

function QueryBody({ load }: { load: Extract<CodeSource, { type: 'query' }> }) {
  const enabled = load.enabled ? load.enabled() : true
  // The screen owns freshness: the pane shows what is cached and fetches only what no screen has asked for yet.
  const q = useQuery({ queryKey: load.queryKey, queryFn: load.queryFn, enabled, staleTime: Infinity })
  if (!enabled) return <Pre text="# Not available to the signed-in user (the server would answer 403)." />
  if (q.isError) return <Pre text={`# The request failed: ${q.error instanceof Error ? q.error.message : 'error'}`} />
  if (q.data === undefined) return <Pre text="# loading…" />
  return <Pre text={json(load.select ? load.select(q.data) : q.data)} />
}

function ClaimBody({ field }: { field?: string | undefined }) {
  const id = useLocation({ select: (l) => /^\/claims\/([^/]+)$/.exec(l.pathname)?.[1] }) ?? FOLLOWED.claim
  return (
    <QueryBody
      load={{ type: 'query', queryKey: qk.claim(id), queryFn: () => api.claim(id), ...(field ? { select: (d: unknown) => ({ [field]: (d as Record<string, unknown>)[field] }) } : {}) }}
    />
  )
}

function RunBody({ kind }: { kind: 'approve_group' | 'triage' }) {
  const launch = useLaunches().findLast((l) => l.kind === kind)
  const runId = launch?.runs[0]?.run_id
  const opts = runQueryOptions(runId ?? 'none')
  const q = useQuery({ ...opts, queryFn: runId ? opts.queryFn : skipToken })
  if (!runId) return <Pre text="# No run started in this tab yet. Press “Try it” on the step before to start one." />
  if (q.data === undefined) return <Pre text="# loading…" />
  return <Pre text={`# ['run', '${runId}'] in the query cache: GET /runs/{id}, then patched by each SSE event\n${json(q.data)}`} />
}

function StaticBody({ name }: { name: Parameters<typeof loadPayload>[0] }) {
  const q = useQuery({ queryKey: ['tour-payload', name], queryFn: () => loadPayload(name), staleTime: Infinity })
  if (q.isError) return <Pre text={`# ${q.error instanceof Error ? q.error.message : 'missing payload'}`} />
  return <Pre text={q.data ?? '# loading…'} />
}

function Pre({ text }: { text: string }) {
  // A streaming run re-renders this on every event; highlight once per text, not per render.
  const lines = useMemo(() => text.split('\n').map(highlight), [text])
  return (
    <pre tabIndex={0} aria-label="Payload" className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 pt-2 font-mono text-[11.75px] leading-normal text-ink [overflow-wrap:anywhere] [tab-size:2]">
      {lines.map((ln, i) => (
        <span key={i}>
          {ln}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

/** Pretty JSON with long arrays cut (twelve near the top, three deeper), marked so nobody mistakes the cut for the response. */
export function json(value: unknown): string {
  const trim = (v: unknown, depth: number): unknown => {
    if (Array.isArray(v)) {
      // Arrays a step talks about (the strip's nine tiles, an item's evidence) sit near the top: keep them whole.
      const keep = depth <= 1 ? 12 : 3
      const head = v.slice(0, keep).map((x) => trim(x, depth + 1))
      return v.length > keep ? [...head, TRIMMED] : head
    }
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x, depth + 1)]))
    return v
  }
  return JSON.stringify(trim(value, 0), null, 2).replaceAll(`"${TRIMMED}"`, '# … the rest of this array is in the response, trimmed here')
}
const TRIMMED = '\u0000trimmed'

const TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\b\d[\d.]*\b|\btrue\b|\bfalse\b|\bnull\b)|(<\/?(?:world_content|tool_data)\b[^>]*>)|(\s#\s.*$)/g

/** A small JSON-ish highlighter that returns React nodes: no HTML strings, so pane text can never become markup. */
export function highlight(line: string): ReactNode {
  const t = line.trimStart()
  if (t.startsWith('#') || t.startsWith('//')) return <span className="text-soft">{line}</span>
  const out: ReactNode[] = []
  let last = 0
  for (const m of line.matchAll(TOKEN)) {
    const at = m.index
    if (at > last) out.push(line.slice(last, at))
    const [whole, str, colon, num, tag, comment] = m
    if (str !== undefined) {
      out.push(
        <span key={at} className={colon ? 'text-act-hover' : 'text-agents-ink'}>
          {str}
        </span>,
      )
      if (colon) out.push(colon)
    } else if (num !== undefined) out.push(<span key={at} className="text-practice-ink">{num}</span>)
    else if (tag !== undefined) out.push(<span key={at} className="text-risk-ink">{tag}</span>)
    else if (comment !== undefined) out.push(<span key={at} className="text-soft">{comment}</span>)
    last = at + whole.length
  }
  if (last < line.length) out.push(line.slice(last))
  return out
}
