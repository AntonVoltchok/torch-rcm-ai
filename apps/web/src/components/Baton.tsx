import type { ClaimMove, MoveWho } from '@/api/schema'
import { cn } from '@/lib/cn'

/**
 * Whose move a claim is, drawn as a baton on a three-stop track: practice, agents, payer. Position, hue and
 * shape all say the same thing (practice pill, agents block, payer leaf), so it reads without colour.
 * `nobody` draws the empty track. The holder is the server's (`ClaimSummary.move`); this never derives it.
 * Styles live in styles.css (`.baton`, `.party-shape-*`); a change of `who` glides the rod.
 */
export type Party = Exclude<MoveWho, 'nobody'>

export const PARTIES: readonly Party[] = ['practice', 'agents', 'payer']
const STOP: Record<Party, number> = { practice: 0, agents: 1, payer: 2 }

/** "the agents", for sentences. `mine` turns practice into "you". */
export function partyWord(who: MoveWho, mine = false): string {
  if (who === 'practice') return mine ? 'you' : 'the practice'
  if (who === 'agents') return 'the agents'
  if (who === 'payer') return 'the payer'
  return 'nobody'
}

export type BatonSize = 'sm' | 'md' | 'lg'

export interface BatonProps {
  who: MoveWho
  size?: BatonSize
  /** Practice only: `other` hatches the rod when someone else at the practice holds it ("Dr. Morgan signs"). */
  held?: 'mine' | 'other'
  /** A dashed ghost where the baton lands next (`InboxItemOut.lands`). */
  next?: MoveWho | null
  /** A group: the rod carries its member count. */
  count?: number
  /** Accessible name. Pass the server's `move.label` when there is one. */
  label?: string
  /** A legend or KPI glyph next to words that already say it: hidden from assistive tech. */
  decorative?: boolean
  className?: string
}

export function Baton({ who, size = 'sm', held = 'mine', next, count, label, decorative = false, className }: BatonProps) {
  const name = label ?? defaultLabel(who, held, next)
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name, title: name }
  return (
    <span {...a11y} className={cn('baton', className)} data-size={size} data-who={who}>
      {PARTIES.map((p) => (
        <i key={p} className="baton-stop" style={{ ['--i' as string]: STOP[p] }} />
      ))}
      {next && next !== who && next !== 'nobody' && <b className="baton-ghost" data-who={next} style={{ ['--p' as string]: STOP[next] }} />}
      {who !== 'nobody' && (
        <b className={cn('baton-rod', `party-shape-${who}`)} data-held={who === 'practice' ? held : undefined} data-count={count} style={{ ['--p' as string]: STOP[who] }}>
          {count}
        </b>
      )}
    </span>
  )
}

function defaultLabel(who: MoveWho, held: 'mine' | 'other', next: MoveWho | null | undefined): string {
  const now = who === 'nobody' ? 'Nobody holds this now' : `With ${partyWord(who, held === 'mine')}`
  return next && next !== who ? `${now}, next ${partyWord(next)}` : now
}

/** Props for a claim's baton from its server-computed move. */
export function batonProps(move: ClaimMove): Pick<BatonProps, 'who' | 'held' | 'label'> {
  return { who: move.who, held: move.mine ? 'mine' : 'other', ...(move.label ? { label: move.label } : {}) }
}

/** The mini rod: a legend swatch or a timeline marker. Decorative; say the party in text beside it. */
export function PartyMark({ who, className }: { who: MoveWho; className?: string }) {
  return <i aria-hidden className={cn('party-mark', `party-shape-${who}`, className)} />
}

/** "You · Agents · Payer" with their marks: the key to every baton on a screen. */
export function BatonLegend({ payer = 'Payer', className }: { payer?: string; className?: string }) {
  const words: Record<Party, string> = { practice: 'You', agents: 'Agents', payer }
  return (
    <span className={cn('inline-flex items-center gap-3 text-xs font-medium text-mid', className)}>
      {PARTIES.map((p) => (
        <span key={p} className="inline-flex items-center gap-1.5">
          <PartyMark who={p} />
          {words[p]}
        </span>
      ))}
    </span>
  )
}

/** Hue classes for text and tinted panels, so features never spell party colours by hand. */
export const PARTY_TEXT: Record<MoveWho, string> = {
  practice: 'text-practice-ink',
  agents: 'text-agents-ink',
  payer: 'text-payer-ink',
  nobody: 'text-mid',
}
export const PARTY_PANEL: Record<MoveWho, string> = {
  practice: 'bg-practice-bg border-practice-line',
  agents: 'bg-agents-bg border-agents-line',
  payer: 'bg-payer-bg border-payer-line',
  nobody: 'bg-fill border-line',
}
