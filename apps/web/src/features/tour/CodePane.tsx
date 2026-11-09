import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { runQueryOptions } from '@/hooks/useRun'
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
  rendered: { label: 'rendered on the seed', cls: 'bg-act-bg text-act' },
  source: { label: 'verbatim source', cls: 'bg-act-bg text-act' },
  synthetic: { label: 'hand-authored recording', cls: 'bg-practice-bg text-practice-ink' },
}

export function CodePane({ tabs }: { tabs: CodeTab[] }) {
  const [on, setOn] = useState(0)
  const tab = tabs[Math.min(on, tabs.length - 1)]
  if (!tab) return null
  const k = KIND[tab.kind]
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[9px] border border-line bg-fill" data-testid="tour-code">
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Payloads" className="flex gap-0.5 overflow-x-auto border-b border-line bg-paper px-2 pt-1">
          {tabs.map((t, i) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={i === on}
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
      <PaneBody key={`${on}:${tab.label}`} load={tab.load} />
    </div>
  )
}

function PaneBody({ load }: { load: CodeSource }) {
  if (load.type === 'static') return <StaticBody name={load.name} />
  if (load.type === 'run') return <RunBody kind={load.kind} />
  return <QueryBody load={load} />
}

function QueryBody({ load }: { load: Extract<CodeSource, { type: 'query' }> }) {
  const enabled = load.enabled ? load.enabled() : true
  const q = useQuery({ queryKey: load.queryKey, queryFn: load.queryFn, enabled, staleTime: 30_000 })
  if (!enabled) return <Pre text="# Not available to the signed-in user (the server would answer 403)." />
  if (q.isError) return <Pre text={`# The request failed: ${q.error instanceof Error ? q.error.message : 'error'}`} />
  if (q.data === undefined) return <Pre text="# loading…" />
  return <Pre text={json(load.select ? load.select(q.data) : q.data)} />
}

function RunBody({ kind }: { kind: 'approve_group' | 'triage' }) {
  const launch = useLaunches().findLast((l) => l.kind === kind)
  const runId = launch?.runs[0]?.run_id
  const q = useQuery({ ...runQueryOptions(runId ?? 'none'), enabled: Boolean(runId) })
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
  return (
    <pre tabIndex={0} aria-label="Payload" className="m-0 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 pb-3 pt-2 font-mono text-[11.75px] leading-normal text-ink [overflow-wrap:anywhere] [tab-size:2]">
      {text.split('\n').map((ln, i) => (
        <span key={i}>
          {highlight(ln)}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

/** Pretty JSON with long arrays cut to three entries, marked so nobody mistakes the cut for the response. */
export function json(value: unknown): string {
  const trim = (v: unknown, depth: number): unknown => {
    if (Array.isArray(v)) {
      const head = v.slice(0, 3).map((x) => trim(x, depth + 1))
      return v.length > 3 ? [...head, TRIMMED] : head
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
