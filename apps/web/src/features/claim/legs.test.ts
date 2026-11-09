import { describe, expect, it } from 'vitest'
import type { ClaimDetail, ClaimMove, TimelineEntry } from '@/api/schema'
import { buildHistory, entryWord, firstClause, fold, isLeg, legsOf, type Leg } from './legs'

let n = 0
function e(who: TimelineEntry['who'], kind: string, title: string, extra: Partial<TimelineEntry> = {}): TimelineEntry {
  n += 1
  return { id: `e${n}`, at: `2026-10-${String(10 + n).padStart(2, '0')}T10:00:00-04:00`, lane: 'system', kind, title, who, ...extra }
}

const move = (m: Partial<ClaimMove>): ClaimMove => ({ who: 'practice', holder_role: 'billing', holder_user_id: null, mine: true, label: 'Waiting on billing', ...m })

function detail(timeline: TimelineEntry[], m: ClaimMove, items: Partial<ClaimDetail['open_inbox_items'][number]>[] = []) {
  return {
    claim: { move: m, payer: { short_name: 'Delta' } } as ClaimDetail['claim'],
    timeline,
    open_inbox_items: items as ClaimDetail['open_inbox_items'],
  }
}

/** #4821's real shape: visit, built, acks, denial, two checks, root cause, the fix run; Dana's move. */
const story = () => [
  e('practice', 'visit', 'Visit completed · D2740 #19 +2 · Dr. Morgan'),
  e('agents', 'built', 'Claims agent built claim #4821 at checkout'),
  e('payer', 'file_999_ok', '999 accepted (file level)'),
  e('payer', 'payer_277ca_a1', 'Payer 277CA A1: accepted · ICN 26299-041833'),
  e('payer', 'remittance', 'Delta ERA · Denied CO-16 · N29 · Missing documentation'),
  e('agents', 'run:succeeded', 'IVR status check: denied 10/26, $0 paid.', { run_id: 'r1' }),
  e('agents', 'run:succeeded', 'Rep call ref DD-1027-88412: send PA via NEA, resubmit.', { run_id: 'r2' }),
  e('agents', 'root_cause', 'Root cause: ours — we sent BWX', { root_cause: 'ours' }),
  e('agents', 'run:succeeded', 'Matched the PA of #19 in PMS imaging; rule is Ask → proposed.', { run_id: 'fix' }),
]

describe('history legs', () => {
  it('merges a party’s consecutive entries, keeps the remittance alone, names the fix, ends on whose move it is', () => {
    const h = buildHistory(detail(story(), move({}), [{ run_id: 'fix', lands: 'agents' }]))
    const legs = h.legs.filter(isLeg)
    expect(legs.map((l) => [l.party, l.words.join(', ')])).toEqual([
      ['practice', 'Visit'],
      ['agents', 'Built the claim'],
      ['payer', 'Accepted'],
      ['payer', 'Denied CO-16'],
      ['agents', 'IVR status check, Rep call ref DD-1027-88412, Root cause: ours, Proposed fix'],
      ['practice', 'Your move'],
    ])
    expect(legs[3]?.outcome).toBe(true)
    expect(legs[4]?.fix).toBe(true)
    expect(legs.at(-1)?.now).toBe(true)
    expect(h.ghost).toEqual({ party: 'agents', label: 'If you approve' })
  })

  it('leaves out entries with no party and draws no ghost for a holder who is not you', () => {
    const h = buildHistory(
      detail([e(null, 'note', 'n'), e('practice', 'visit', 'Visit')], move({ mine: false, holder_role: 'owner', label: 'Dr. Morgan signs' }), [{ run_id: 'x', lands: 'practice' }]),
    )
    expect(legsOf(h).map((l) => l.words[0])).toEqual(['Visit'])
    expect(legsOf(h)[0]?.now).toBe(true)
    expect(h.ghost).toBeNull()
  })

  it('names the holder when it is not you', () => {
    const h = buildHistory(
      detail([e('practice', 'visit', 'Visit'), e('payer', 'remittance', 'Delta ERA · Denied PR-119 · Max met')], move({ mine: false, label: 'Dr. Morgan signs' })),
    )
    expect(legsOf(h).at(-1)?.words).toEqual(['Dr. Morgan signs'])
  })

  it('folds only unpinned legs, keeps order, and never folds the first, fix, outcome or now leg', () => {
    const mk = (i: number, flags: Partial<Leg> = {}): Leg => ({
      key: `l${i}`,
      party: i % 2 ? 'agents' : 'payer',
      from: 'x',
      to: 'x',
      words: [`w${i}`],
      titles: [],
      fix: false,
      outcome: false,
      now: false,
      ...flags,
    })
    const legs = [mk(0), mk(1), mk(2, { outcome: true }), mk(3), mk(4), mk(5), mk(6, { fix: true }), mk(7), mk(8, { now: true })]
    const out = fold(legs, 6)
    expect(out.length).toBeLessThanOrEqual(7)
    const kept = out.filter(isLeg).map((l) => l.key)
    expect(kept).toEqual(expect.arrayContaining(['l0', 'l2', 'l6', 'l8']))
    // Flattening the stubs gives back every leg in order.
    expect(out.flatMap((l) => (isLeg(l) ? [l.key] : l.legs.map((x) => x.key)))).toEqual(legs.map((l) => l.key))
    expect(fold(legs.slice(0, 5), 6)).toHaveLength(5)
  })

  it('cuts titles at the first clause, and words come from the kind', () => {
    expect(firstClause('Rep call ref DD-1027-88412: send PA via NEA, resubmit.')).toBe('Rep call ref DD-1027-88412')
    expect(firstClause('Drafted a claim inquiry citing Delta’s own 03/2022 EOB (tooth #31).')).toBe('Drafted a claim inquiry citing Delta’s own 03/2022 EOB')
    expect(entryWord(e('payer', 'ch_277ca_a7', 'Rejected A7'), new Set())).toBe('Rejected')
    expect(entryWord(e('payer', 'remittance', 'Cigna ERA · paid $412.00'), new Set())).toBe('Paid $412.00')
    expect(entryWord(e('agents', 'file:queued', 'Claim queued for the 11:15 Delta file via Vyne'), new Set())).toBe('Queued for the file')
  })
})
