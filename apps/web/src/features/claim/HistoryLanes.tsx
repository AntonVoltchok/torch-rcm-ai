/**
 * D1's history as party lanes, as an HTML grid instead of D1's SVG. One column per leg, and per lane two grid rows:
 * text, then a fixed 14px bar track. A label wraps inside its own column, so nothing ever crosses a hop or a lane
 * rule (D1 hid that overlap with a white text halo). Hops are vertical lines spanning bar tracks, centre to centre.
 */
import { Fragment, useState } from 'react'
import type { ClaimDetail } from '@/api/schema'
import { shortDate } from '@/lib/format'
import { cn } from '@/lib/cn'
import { buildHistory, isLeg, type Folded, type Leg, type LegParty } from './legs'

const LANES: readonly LegParty[] = ['practice', 'agents', 'payer']
const BAR: Record<LegParty, string> = {
  practice: 'bg-practice rounded-[4px]',
  agents: 'bg-agents rounded-[2px]',
  payer: 'bg-payer rounded-none',
}
/** Someone else at the practice holds it ("Dr. Morgan signs"): the baton's hatch. */
const HATCH = 'repeating-linear-gradient(-45deg, var(--color-practice) 0 3px, #fff 3px 5.5px)'
const LANE_TEXT: Record<LegParty, string> = { practice: 'text-practice-ink', agents: 'text-agents-ink', payer: 'text-payer-ink' }

/** Grid rows: lane i's text row is 2i+1, its bar track 2i+2. */
const textRow = (p: LegParty) => LANES.indexOf(p) * 2 + 1
const barRow = (p: LegParty) => LANES.indexOf(p) * 2 + 2

function range(l: Leg): string {
  if (!l.from) return 'Now'
  const a = shortDate(l.from)
  const b = shortDate(l.to)
  return a === b ? a : `${a}–${b}`
}

/** Column weight from how much the leg has to say, so short legs stay short and none is cramped. */
const weight = (l: Leg | Folded) => (isLeg(l) ? Math.min(3, Math.max(1, (range(l).length + l.words.join(', ').length) / 18)) : 0.7)

export function HistoryLanes({ claim }: { claim: Pick<ClaimDetail, 'claim' | 'timeline' | 'open_inbox_items'> }) {
  const [expanded, setExpanded] = useState(false)
  const history = buildHistory(claim, expanded ? Number.POSITIVE_INFINITY : undefined)
  const payer = claim.claim.payer.short_name
  const laneName: Record<LegParty, string> = { practice: 'Practice', agents: 'Agents', payer }
  const held = claim.claim.move.who === 'practice' && !claim.claim.move.mine

  const cols = history.legs.map((l) => `minmax(88px, ${weight(l).toFixed(2)}fr)`)
  if (history.ghost) cols.push('minmax(96px, 1fr)')

  // The lane each column's bar sits on; a folded stub carries the lane of the leg before it through.
  const laneAt: LegParty[] = []
  for (const l of history.legs) laneAt.push(isLeg(l) ? l.party : (laneAt.at(-1) ?? 'practice'))

  return (
    <div
      role="group"
      aria-label="History by party"
      className="grid gap-x-0"
      style={{ gridTemplateColumns: `76px ${cols.join(' ')}`, gridTemplateRows: 'auto 14px auto 14px auto 14px' }}
    >
      {LANES.map((p) => (
        <Fragment key={p}>
          <span aria-hidden className={cn('self-center pr-3 text-sm font-medium', LANE_TEXT[p])} style={{ gridColumn: 1, gridRow: `${textRow(p)} / ${barRow(p) + 1}` }}>
            {laneName[p]}
          </span>
          <span aria-hidden className="h-px self-center bg-line" style={{ gridColumn: '2 / -1', gridRow: barRow(p) }} />
        </Fragment>
      ))}
      <ol className="contents">
        {history.legs.map((l, i) => {
          const col = i + 2
          const prev = i > 0 ? laneAt[i - 1] : undefined
          const lane = laneAt[i] as LegParty
          const hop = prev && prev !== lane && (
            <span
              aria-hidden
              className="w-[1.25px] justify-self-start bg-nobody"
              style={{ gridColumn: col, gridRow: `${Math.min(barRow(prev), barRow(lane))} / ${Math.max(barRow(prev), barRow(lane)) + 1}`, marginBlock: 7 }}
            />
          )
          if (!isLeg(l)) {
            return (
              <li key={l.key} className="contents">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="self-end justify-self-center rounded-full border border-dashed border-line-strong bg-paper px-2 text-xs font-medium text-mid hover:bg-hover"
                  style={{ gridColumn: col, gridRow: textRow(lane) }}
                  title={l.legs.map((x) => `${range(x)} ${x.words.join(', ')}`).join('\n')}
                >
                  +{l.count} earlier
                </button>
                <span aria-hidden className="self-center border-t border-dashed border-nobody" style={{ gridColumn: col, gridRow: barRow(lane) }} />
              </li>
            )
          }
          return (
            <li key={l.key} className="contents" data-party={l.party} data-fix={l.fix || undefined} data-outcome={l.outcome || undefined} data-now={l.now || undefined}>
              {hop}
              <div className="min-w-0 self-end pb-1 pr-3" style={{ gridColumn: col, gridRow: textRow(l.party) }} title={l.titles.join('\n')}>
                <span className="sr-only">{laneName[l.party]}, </span>
                <div className="text-xs text-soft">{range(l)}</div>
                <div className={cn('text-sm leading-[17px] text-ink', l.now && 'font-semibold', (l.fix || l.outcome) && 'font-medium')}>{l.words.join(', ')}</div>
              </div>
              <span
                aria-hidden
                className={cn('self-center', BAR[l.party], prev === l.party && 'ml-1', l.now ? 'h-3.5' : 'h-2', l.now && l.party === 'practice' && 'rounded-[7px]')}
                style={{ gridColumn: col, gridRow: barRow(l.party), ...(l.now && held ? { background: HATCH } : {}) }}
              />
            </li>
          )
        })}
        {history.ghost && (
          <li className="contents" data-ghost={history.ghost.party}>
            {laneAt.at(-1) !== history.ghost.party && (
              <span
                aria-hidden
                className="justify-self-start border-l border-dashed border-nobody"
                style={{
                  gridColumn: history.legs.length + 2,
                  gridRow: `${Math.min(barRow(laneAt.at(-1) ?? 'practice'), barRow(history.ghost.party))} / ${Math.max(barRow(laneAt.at(-1) ?? 'practice'), barRow(history.ghost.party)) + 1}`,
                  marginBlock: 7,
                }}
              />
            )}
            <div className="self-end pb-1 pl-2 text-sm text-mid" style={{ gridColumn: history.legs.length + 2, gridRow: textRow(history.ghost.party) }}>
              <span className="sr-only">Next, {laneName[history.ghost.party]}: </span>
              {history.ghost.label}
            </div>
            <span
              aria-hidden
              className="ml-2 h-3.5 self-center rounded-[3px] border-[1.5px] border-dashed border-nobody"
              style={{ gridColumn: history.legs.length + 2, gridRow: barRow(history.ghost.party) }}
            />
          </li>
        )}
      </ol>
    </div>
  )
}
