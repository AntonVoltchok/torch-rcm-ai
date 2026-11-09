/**
 * The claim's history as party legs (D1 "history as party lanes"). A view over the server's timeline: the
 * party of each entry is `TimelineEntry.who`, the holder now is `claim.move`, the ghost is the open item's
 * `lands`. Nothing here decides whose move it is. Decisions: docs/adr/0008-d1-dashboard.md, decision 8.
 */
import type { ClaimDetail, MoveWho, TimelineEntry } from '@/api/schema'

export type LegParty = Exclude<MoveWho, 'nobody'>

export interface Leg {
  key: string
  party: LegParty
  /** First and last entry instants in the leg. */
  from: string
  to: string
  /** Short words, one per distinct kind of entry, in order. */
  words: string[]
  /** The full entry titles, for the tooltip and screen readers. */
  titles: string[]
  /** Holds the run that proposed the open item. */
  fix: boolean
  /** A remittance: what the payer decided. Never merged, never folded. */
  outcome: boolean
  /** The last leg: who holds the claim now. */
  now: boolean
}

export interface Folded {
  key: string
  folded: true
  count: number
  legs: Leg[]
}

export interface Ghost {
  party: LegParty
  label: string
}

export interface History {
  /** In order; a `Folded` stands for older legs folded into one, never the fix, outcome or now leg. */
  legs: (Leg | Folded)[]
  ghost: Ghost | null
}

/** Above this many legs, older middle legs fold. */
export const MAX_LEGS = 7

const REMIT = /\b(Denied [A-Z]{2}-\d+|paid \$[\d,.]+)/

/** A title up to its first clause break: "Rep call ref DD-1027-88412: send PA via NEA, resubmit." → "Rep call ref DD-1027-88412". */
export function firstClause(title: string): string {
  const cut = title.split(/\s[·—–]\s|[:;,(]|\.(\s|$)/)[0]?.trim()
  return cut || title
}

/** The short word for one entry: a closed vocabulary over `kind`; a run says its own title's first clause. */
export function entryWord(e: TimelineEntry, fixRunIds: ReadonlySet<string>): string {
  if (e.run_id && fixRunIds.has(e.run_id)) return 'Proposed fix'
  if (e.kind === 'visit') return 'Visit'
  if (e.kind === 'built') return 'Built the claim'
  if (/_(a7|reject)$/.test(e.kind)) return 'Rejected'
  if (/^(file_999_ok|ch_277ca_a1|payer_277ca_a1)$/.test(e.kind)) return 'Accepted'
  if (e.kind === 'file:queued') return 'Queued for the file'
  if (e.kind.startsWith('file:')) return 'Sent'
  if (e.kind === 'remittance') {
    const m = REMIT.exec(e.title)?.[1]
    return m ? m.charAt(0).toUpperCase() + m.slice(1) : 'Remittance'
  }
  if (e.kind === 'root_cause') return e.root_cause === 'ours' ? 'Root cause: ours' : 'Root cause found'
  if (e.kind.startsWith('run:')) {
    const word = firstClause(e.title)
    return e.kind === 'run:failed' ? `${word} (failed)` : word
  }
  return e.lane === 'human' ? 'Decided' : 'Update'
}

const isLeg = (l: Leg | Folded): l is Leg => !('folded' in l)

export function nowWord(claim: ClaimDetail['claim']): string {
  if (claim.move.who === 'nobody') return claim.move.label || 'Finished'
  return claim.move.mine && claim.move.who === 'practice' ? 'Your move' : claim.move.label
}

export function buildHistory(d: Pick<ClaimDetail, 'claim' | 'timeline' | 'open_inbox_items'>, maxLegs = MAX_LEGS): History {
  const fixRunIds = new Set(d.open_inbox_items.map((i) => i.run_id).filter((x): x is string => Boolean(x)))
  const entries = d.timeline.filter((e): e is TimelineEntry & { who: LegParty } => Boolean(e.who) && e.who !== 'nobody')

  const legs: Leg[] = []
  for (const e of entries) {
    const word = entryWord(e, fixRunIds)
    const prev = legs.at(-1)
    const fix = Boolean(e.run_id && fixRunIds.has(e.run_id))
    const outcome = e.kind === 'remittance'
    // A remittance never merges: what the payer decided, and when, always stands alone.
    const isRemit = e.kind === 'remittance'
    if (prev && prev.party === e.who && !isRemit && !prev.outcome) {
      prev.to = e.at
      if (!prev.words.includes(word)) prev.words.push(word)
      prev.titles.push(e.title)
      prev.fix ||= fix
    } else {
      legs.push({ key: e.id, party: e.who, from: e.at, to: e.at, words: [word], titles: [e.title], fix, outcome, now: false })
    }
  }

  const move = d.claim.move
  const last = legs.at(-1)
  if (move.who !== 'nobody' && last?.party !== move.who) {
    legs.push({ key: 'now', party: move.who, from: '', to: '', words: [nowWord(d.claim)], titles: [move.label], fix: false, outcome: false, now: true })
  } else if (last) {
    last.now = true
  }

  const mine = d.open_inbox_items.find((i) => i.lands && i.lands !== 'nobody' && move.mine)
  const ghost: Ghost | null = mine?.lands && mine.lands !== 'nobody' ? { party: mine.lands, label: 'If you approve' } : null

  return { legs: fold(legs, maxLegs), ghost }
}

/** Keep the first leg and every pinned leg (fix, outcome, now); fold the oldest of the rest until it fits. */
export function fold(legs: Leg[], maxLegs: number): (Leg | Folded)[] {
  if (legs.length <= maxLegs) return legs
  const pinned = (l: Leg, i: number) => i === 0 || l.fix || l.outcome || l.now
  const foldable = legs.map((l, i) => (pinned(l, i) ? -1 : i)).filter((i) => i >= 0)
  // One slot goes to the folded stub itself.
  const toFold = new Set(foldable.slice(0, Math.max(0, legs.length - maxLegs + 1)))
  if (toFold.size < 2) return legs
  // Consecutive folded legs share one stub; a pinned leg between them starts a new one, so order is kept.
  const out: (Leg | Folded)[] = []
  let stub: Folded | null = null
  for (const [i, l] of legs.entries()) {
    if (!toFold.has(i)) {
      out.push(l)
      stub = null
      continue
    }
    if (!stub) {
      stub = { key: `folded-${l.key}`, folded: true, count: 0, legs: [] }
      out.push(stub)
    }
    stub.legs.push(l)
    stub.count++
  }
  return out
}

export const legsOf = (h: History): Leg[] => h.legs.flatMap((l) => (isLeg(l) ? [l] : l.legs))
export { isLeg }
