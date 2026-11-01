/**
 * The mock API's server side, in memory. Pure TypeScript (no MSW), so it is testable on its own and the
 * MSW handlers in ./handlers.ts stay a thin HTTP adapter.
 *
 * It behaves like the real server where the UI can tell the difference: counts are derived on every read
 * (strip = GROUP BY status; `needs_action` = an open item references the claim), mutations return
 * `meta.counts`, approvals start runs that stream step events with ids, and replay honours Last-Event-ID.
 */
import type {
  ActivityRow,
  AdvanceSnapshot,
  AgentKind,
  ClaimDetail,
  ClaimRow,
  ClaimStatus,
  Evidence,
  InboxGroup,
  InboxItem,
  InboxItemDetail,
  InboxList,
  PolicyVerdict,
  Run,
  RunStep,
  RuleProposal,
  SavedView,
  StripSummary,
} from '@/api/schema'
import { CLAIM_STATUSES } from '@/api/schema'
import type { ClaimsApiParams } from '@/features/claims/search'
import { at, buildClaims, FROZEN_NOW, type MockClaim } from './fixtures/claims'
import { buildInbox, EVIDENCE, GROUP_META } from './fixtures/inbox'
import { buildActivity, PROPOSALS, VIEWS } from './fixtures/static'

export class MockError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly alternatives: string[] = [],
  ) {
    super(message)
  }
}

export type UserId = 'usr_dana' | 'usr_morgan' | 'usr_lee' | 'usr_tasha'
const USER_NAME: Record<UserId, string> = { usr_dana: 'Dana S.', usr_morgan: 'Dr. Morgan', usr_lee: 'Dr. Lee', usr_tasha: 'Tasha P.' }
const isOwner = (u: UserId) => u === 'usr_morgan'

export interface SseRecord {
  id: number
  event: string
  data: unknown
}

interface StepPlan {
  name: string
  output: string
  progress?: string[]
  evidence?: Evidence
  verdict?: PolicyVerdict
}

interface RunPlan {
  steps: StepPlan[]
  /** Published when `decide` completes: the agent's own label for the situation and its rationale. */
  situation?: { label: string; rationale: string }
  onDone: (db: MockDb, run: Run) => void
}

type Scheduler = (fn: () => void, ms: number) => void

export interface MockDbOptions {
  /** Delay between run step events; 0 in unit tests. */
  stepDelayMs?: number
  schedule?: Scheduler
  onChange?: (db: MockDb) => void
}

interface State {
  now: string
  claims: MockClaim[]
  items: InboxItem[]
  evidence: Record<string, Evidence>
  runs: Record<string, Run>
  runLog: Record<string, SseRecord[]>
  activity: (ActivityRow & { ran_without_review?: boolean })[]
  views: SavedView[]
  proposals: RuleProposal[]
  paused: { by: string; at: string } | null
  advance: AdvanceSnapshot | null
  seq: number
  eventSeq: number
}

function initialState(): State {
  const bgRun: Run = {
    id: 'run_bg_hill_rep',
    agent: 'followup',
    trigger: 'rule',
    rule_id: 'rule_t1_rep_call',
    claim_id: 'clm_4512',
    status: 'running',
    mode: 'deterministic',
    planner: 'scripted',
    started_at: at('2026-10-28', '10:31'),
    steps: [
      { idx: 0, name: 'gather_case', status: 'ok', output_summary: 'Aetna · 104 d · in process', progress_lines: [], evidence_ids: [] },
      { idx: 1, name: 'act:payer_rep_call', status: 'running', output_summary: 'On hold with Aetna provider services · 9 min', progress_lines: [], evidence_ids: [] },
    ],
    result_summary: null,
    audit_line: null,
    evidence: [],
    last_event_id: 0,
  }
  return {
    now: FROZEN_NOW,
    claims: buildClaims(),
    items: buildInbox(),
    evidence: Object.fromEntries(EVIDENCE.map((e) => [e.id, e])),
    runs: { [bgRun.id]: bgRun },
    runLog: { [bgRun.id]: [] },
    activity: buildActivity().map((r) => ({ ...r, ran_without_review: true })),
    views: [...VIEWS],
    proposals: PROPOSALS.map((p) => ({ ...p })),
    paused: null,
    advance: null,
    seq: 1,
    eventSeq: 0,
  }
}

const STATUS_ORDER = Object.fromEntries(CLAIM_STATUSES.map((s, i) => [s, i])) as Record<ClaimStatus, number>

export class MockDb {
  private s: State
  private readonly runSubs = new Map<string, Set<(r: SseRecord) => void>>()
  private readonly fireSubs = new Set<(r: SseRecord) => void>()
  private readonly plans = new Map<string, RunPlan>()
  private readonly opts: Required<Omit<MockDbOptions, 'onChange'>> & Pick<MockDbOptions, 'onChange'>

  constructor(opts: MockDbOptions = {}, snapshot?: string) {
    this.opts = { stepDelayMs: opts.stepDelayMs ?? 650, schedule: opts.schedule ?? ((fn, ms) => setTimeout(fn, ms)), onChange: opts.onChange }
    this.s = snapshot ? (JSON.parse(snapshot) as State) : initialState()
  }

  // ── persistence ────────────────────────────────────────────────────────────
  snapshot(): string {
    return JSON.stringify(this.s)
  }
  reset(): void {
    this.s = initialState()
    this.plans.clear()
    this.changed()
  }
  private changed() {
    this.opts.onChange?.(this)
  }
  private id(prefix: string): string {
    return `${prefix}_${(this.s.seq++).toString(36)}`
  }
  get now(): string {
    return this.s.now
  }

  // ── derived reads ──────────────────────────────────────────────────────────
  private openItems(): InboxItem[] {
    return this.s.items.filter((i) => i.state === 'open')
  }
  needsAction(claimId: string): boolean {
    return this.openItems().some((i) => i.claim_id === claimId)
  }
  private claimsAt(location?: string): MockClaim[] {
    return location ? this.s.claims.filter((c) => c.location_id === location) : this.s.claims
  }

  strip(location?: string): StripSummary {
    const claims = this.claimsAt(location)
    const tiles = CLAIM_STATUSES.map((status) => {
      const group = claims.filter((c) => c.status === status)
      return {
        status,
        count: group.length,
        cents: group.reduce((a, c) => a + c.billed_cents, 0),
        flagged: group.filter((c) => this.needsAction(c.id)).length,
        cents_basis: status === 'paid' ? ('paid' as const) : ('billed' as const),
      }
    })
    const paidOct = claims.filter((c) => c.status === 'paid')
    const open = this.openItems()
    return {
      tiles,
      inbox_open: open.length,
      paid_month_count: paidOct.length,
      paid_month_cents: paidOct.reduce((a, c) => a + c.billed_cents, 0),
      paid_month_label: 'Oct',
      nav_badges: {
        payments: 2,
        eligibility: open.filter((i) => i.kind === 'eligibility_flag').length,
        activity: this.s.activity.filter((r) => r.ran_without_review).length,
      },
    }
  }

  inbox(p: { state?: string | null; kind?: string | null; agent?: string | null }): InboxList {
    const state = p.state ?? 'open'
    const items = this.s.items.filter(
      (i) =>
        (state === 'done' ? !['open', 'snoozed'].includes(i.state) : i.state === state) &&
        (!p.kind || i.kind === p.kind) &&
        (!p.agent || i.agent === p.agent),
    )
    const groups: InboxGroup[] = []
    for (const item of items) {
      if (!item.group_key) continue
      let g = groups.find((x) => x.group_key === item.group_key)
      if (!g) {
        const meta = GROUP_META[item.group_key]
        g = { group_key: item.group_key, title: meta?.title ?? item.group_key, summary: meta?.summary ?? null, count: 0, cents: 0, item_ids: [] }
        groups.push(g)
      }
      g.count++
      g.cents += item.cents
      g.item_ids.push(item.id)
    }
    const kindFacet: Record<string, number> = {}
    for (const i of this.s.items.filter((x) => x.state === state)) kindFacet[i.kind] = (kindFacet[i.kind] ?? 0) + 1
    // A group of one is just an item.
    return { items, total: items.length, next_cursor: null, groups: groups.filter((g) => g.count > 1), facets: { kind: kindFacet } }
  }

  inboxItem(id: string): InboxItemDetail {
    const item = this.s.items.find((i) => i.id === id)
    if (!item) throw new MockError(404, 'not_found', `Inbox item ${id} not found`)
    const claim = item.claim_id ? this.s.claims.find((c) => c.id === item.claim_id) : undefined
    return {
      ...item,
      evidence: item.evidence.map((e) => this.s.evidence[e]).filter((e): e is Evidence => Boolean(e)),
      claim: claim ? this.row(claim) : null,
    }
  }

  private row(c: MockClaim): ClaimRow {
    return {
      id: c.id,
      number: c.number,
      patient_id: c.patient_id,
      patient_name: c.patient_name,
      payer_key: c.payer_key,
      status: c.status,
      needs_action: this.needsAction(c.id),
      dos: c.dos,
      billed_cents: c.billed_cents,
      denial: c.denial ?? null,
      provider_name: c.provider_name ?? null,
      procedures_label: c.procedures_label,
      reason_text: c.reason_text ?? null,
      in_flight: c.in_flight ?? null,
      age_days: c.age_days ?? null,
      agent_chip: c.agent_chip,
      last_activity: c.last_activity,
    }
  }

  claims(p: Partial<ClaimsApiParams> & { cursor?: string | null; limit?: number; location_id?: string | null }) {
    let rows = this.claimsAt(p.location_id ?? undefined)
    if (p.status?.length) rows = rows.filter((c) => p.status?.includes(c.status))
    if (p.needs_action) rows = rows.filter((c) => this.needsAction(c.id))
    if (p.payer) rows = rows.filter((c) => c.payer_key === p.payer)
    if (p.provider) rows = rows.filter((c) => c.provider_name === p.provider)
    if (p.age_bucket) {
      const bounds: Record<string, [number, number]> = { '0_30': [0, 30], '31_60': [31, 60], '61_90': [61, 90], '90_plus': [91, 99999] }
      const [lo, hi] = bounds[p.age_bucket] ?? [0, 99999]
      rows = rows.filter((c) => c.age_days !== null && c.age_days !== undefined && c.age_days >= lo && c.age_days <= hi)
    }
    if (p.q) {
      const q = p.q.toLowerCase().replace(/^#/, '')
      rows = rows.filter((c) => String(c.number).includes(q) || c.patient_name.toLowerCase().includes(q) || (c.icn ?? '').includes(q))
    }
    const sort = p.sort ?? '-age'
    const desc = sort.startsWith('-')
    const field = desc ? sort.slice(1) : sort
    const key = (c: MockClaim): number | string => {
      switch (field) {
        case 'number': return c.number
        case 'patient': return c.patient_name
        case 'payer': return c.payer_key
        case 'dos': return c.dos
        case 'billed': return c.billed_cents
        case 'status': return STATUS_ORDER[c.status]
        case 'last_activity': return c.last_activity?.at ?? ''
        default: return c.age_days ?? -1
      }
    }
    rows = [...rows].sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      const cmp = ka < kb ? -1 : ka > kb ? 1 : a.number - b.number
      return desc ? -cmp : cmp
    })
    const offset = Number(p.cursor ?? 0) || 0
    const limit = p.limit ?? 200
    const page = rows.slice(offset, offset + limit)
    return { items: page.map((c) => this.row(c)), total: rows.length, next_cursor: offset + limit < rows.length ? String(offset + limit) : null }
  }

  claim(id: string): ClaimDetail {
    const c = this.s.claims.find((x) => x.id === id)
    if (!c) throw new MockError(404, 'not_found', `Claim ${id} not found`)
    const { patient_name: _p, procedures_label: _pr, agent_chip: _a, last_activity: _la, ...detail } = c
    return { ...detail, needs_action: this.needsAction(id), open_inbox_items: this.openItems().filter((i) => i.claim_id === id) }
  }

  run(id: string): Run {
    const r = this.s.runs[id]
    if (!r) throw new MockError(404, 'not_found', `Run ${id} not found`)
    return r
  }

  agentsStatus() {
    const runs = Object.values(this.s.runs)
    return {
      paused: this.s.paused !== null,
      paused_by: this.s.paused?.by ?? null,
      paused_at: this.s.paused?.at ?? null,
      mode: 'deterministic' as const,
      live_agents: [] as AgentKind[],
      running: runs.filter((r) => r.status === 'running').length,
      queued: runs.filter((r) => r.status === 'queued').length,
      paused_runs: runs.filter((r) => r.status === 'paused').length,
    }
  }

  activity(p: { agent?: string | null }) {
    const rows = this.s.activity.filter((r) => !p.agent || r.agent === p.agent)
    return { items: rows.map(({ ran_without_review: _r, ...row }) => row), total: rows.length, next_cursor: null }
  }

  views() {
    return { items: this.s.views, total: this.s.views.length, next_cursor: null }
  }
  proposals() {
    return { items: this.s.proposals, total: this.s.proposals.length, next_cursor: null }
  }
  get clock() {
    return { now: this.s.now, frozen: true, advancing: this.s.advance && !this.s.advance.done ? { advance_id: this.s.advance.advance_id, to: this.s.now } : null }
  }
  advanceStatus(id: string): AdvanceSnapshot {
    if (this.s.advance?.advance_id !== id) throw new MockError(404, 'not_found', `Advance ${id} not found`)
    return this.s.advance
  }

  // ── inbox mutations ────────────────────────────────────────────────────────
  private openItem(id: string): InboxItem {
    const item = this.s.items.find((i) => i.id === id)
    if (!item) throw new MockError(404, 'not_found', `Inbox item ${id} not found`)
    if (item.state !== 'open') throw new MockError(409, 'already_resolved', `Already ${item.state} by ${item.resolved_by ?? 'someone'}.`)
    return item
  }

  private resolve(item: InboxItem, state: InboxItem['state'], user: UserId): InboxItem {
    const next = { ...item, state, resolved_by: user, resolved_at: this.s.now }
    this.s.items = this.s.items.map((i) => (i.id === item.id ? next : i))
    return next
  }

  approve(id: string, user: UserId, label?: string): { item: InboxItem; run: Run; meta: { counts: StripSummary } } {
    const item = this.openItem(id)
    if (item.tier === 3 && !isOwner(user)) throw new MockError(403, 'tier_requires_owner', 'Tier 3 commits the practice: Dr. Morgan acts on this one.')
    const params = item.proposed_action?.params ?? {}
    const fileLeft = typeof params.file_departed_at === 'string'
    if (fileLeft) {
      throw new MockError(409, 'file_departed', `#${item.subject?.claim_number ?? ''} left in the ${String(params.file_departed_at)} file. Your edits go as a corrected claim.`, { left_at: params.file_departed_at }, ['corrected_claim'])
    }
    const resolved = this.resolve(item, 'approved', user)
    const run = this.startRun({
      agent: item.agent ?? 'followup',
      trigger: 'approval',
      actor: user,
      inbox_item_id: item.id,
      claim_id: item.claim_id ?? null,
      plan: this.approvalPlan(item, user),
    })
    resolved.run_id = run.id
    if (item.claim_id) {
      this.pushTimeline(item.claim_id, { lane: 'human', actor: USER_NAME[user], title: `${USER_NAME[user]} approved${label ? ` · ${label}` : ''}: ${item.recommendation}` })
    }
    this.changed()
    return { item: resolved, run, meta: { counts: this.strip() } }
  }

  approveGroup(groupKey: string, user: UserId) {
    const members = this.openItems().filter((i) => i.group_key === groupKey)
    if (members.length === 0) throw new MockError(409, 'already_resolved', 'Nothing left to approve in this group.')
    const label = `Approve ${members.length} (${GROUP_META[groupKey]?.title ?? groupKey})`
    const results = members.map((m) => this.approve(m.id, user, label))
    return { items: results.map((r) => r.item), runs: results.map((r) => r.run), meta: { counts: this.strip() } }
  }

  reject(id: string, user: UserId, reason: string) {
    const item = this.resolve(this.openItem(id), 'rejected', user)
    if (item.claim_id) this.pushTimeline(item.claim_id, { lane: 'human', actor: USER_NAME[user], title: `${USER_NAME[user]} rejected the proposal: ${reason}` })
    this.changed()
    return { item, meta: { counts: this.strip() } }
  }

  snooze(id: string, user: UserId, until: string) {
    const item = { ...this.openItem(id), state: 'snoozed' as const, snoozed_until: until, resolved_by: user }
    this.s.items = this.s.items.map((i) => (i.id === id ? item : i))
    this.changed()
    return { item, meta: { counts: this.strip() } }
  }

  reopen(id: string) {
    const found = this.s.items.find((i) => i.id === id)
    if (!found) throw new MockError(404, 'not_found', `Inbox item ${id} not found`)
    const item = { ...found, state: 'open' as const, snoozed_until: null, resolved_by: null, resolved_at: null }
    this.s.items = this.s.items.map((i) => (i.id === id ? item : i))
    this.changed()
    return { item, meta: { counts: this.strip() } }
  }

  alwaysAutoRun(id: string) {
    const item = this.openItem(id)
    if (item.tier !== 1) throw new MockError(422, 'tier_not_learnable', `Tier ${item.tier ?? '—'} actions need an owner-signed rule, not a learned one.`)
    const action = item.proposed_action?.action ?? 'status_check'
    if (item.root_cause === 'ours') {
      throw new MockError(422, 'root_cause_guard', 'Root cause is ours (our Claims agent attached the BWX). Fix the upstream rule instead — this can never be learned into auto-run.')
    }
    const proposal: RuleProposal = {
      id: this.id('prop'),
      title: `${action.replace(/_/g, ' ')} · ${item.subject?.payer_key ?? 'all payers'}`,
      rule_draft: { action, mode: 'auto', scope: { payer_key: item.subject?.payer_key ?? null } },
      evidence: { approved: 7, total: 8, outcome_k: 7, outcome_n: 8 },
      root_cause_guard: false,
      state: 'open',
    }
    this.s.proposals = [...this.s.proposals, proposal]
    this.changed()
    return { proposal, meta: { counts: this.strip() } }
  }

  corrected(claimId: string, user: UserId) {
    const claim = this.s.claims.find((c) => c.id === claimId)
    if (!claim) throw new MockError(404, 'not_found', `Claim ${claimId} not found`)
    const item: InboxItem = {
      id: this.id('inb'),
      kind: 'review_draft',
      state: 'open',
      claim_id: claimId,
      agent: 'claims',
      title: `#${claim.number} · corrected claim (freq. 7)`,
      recommendation: 'Review the corrected claim built from your edits before it goes in the next file.',
      confidence: null,
      evidence: [],
      proposed_action: { action: 'corrected_claim', params: { requested_by: user }, cents: claim.billed_cents, requires_hold_window: false },
      plan_steps: [],
      tier: 2,
      created_at: this.s.now,
      cents: claim.billed_cents,
      subject: { claim_number: claim.number, patient_name: claim.patient_name, payer_key: claim.payer_key },
    }
    this.s.items = [...this.s.items, item]
    this.changed()
    const { open_inbox_items: _o, patient: _p, provider_name: _pn, plan_label: _pl, age_days: _a, lines: _li, attachments: _at, acks: _ac, timeline: _t, ...core } = this.claim(claimId)
    return { claim: core, item, meta: { counts: this.strip() } }
  }

  saveView(name: string, search_params: Record<string, unknown>, user: UserId): SavedView {
    const view = { id: this.id('view'), name, search_params, owner_user_id: user, builtin: false }
    this.s.views = [...this.s.views, view]
    this.changed()
    return view
  }

  // ── agents runtime ─────────────────────────────────────────────────────────
  triage(claimId: string, user: UserId) {
    const claim = this.s.claims.find((c) => c.id === claimId)
    if (!claim) throw new MockError(404, 'not_found', `Claim ${claimId} not found`)
    if (this.s.paused) throw new MockError(409, 'agents_paused', `Agents are paused by ${this.s.paused.by}.`)
    const busy = Object.values(this.s.runs).some((r) => r.claim_id === claimId && ['queued', 'running', 'paused'].includes(r.status))
    if (busy || this.needsAction(claimId)) throw new MockError(409, 'run_in_progress', `#${claim.number} already has a run or an open item.`)
    const run = this.startRun({ agent: 'followup', trigger: 'manual', actor: user, claim_id: claimId, inbox_item_id: null, plan: this.triagePlan(claim) })
    return { run, meta: { counts: this.strip() } }
  }

  pause(user: UserId) {
    if (!isOwner(user)) throw new MockError(403, 'owner_only', 'Only the practice owner can pause agents.')
    this.s.paused = { by: USER_NAME[user], at: this.s.now }
    this.fire('agents', { paused: true, by: USER_NAME[user], at: this.s.now })
    this.changed()
    return { meta: { counts: this.strip() } }
  }

  resume(user: UserId) {
    if (!isOwner(user)) throw new MockError(403, 'owner_only', 'Only the practice owner can resume agents.')
    this.s.paused = null
    this.fire('agents', { paused: false, by: USER_NAME[user], at: this.s.now })
    for (const run of Object.values(this.s.runs)) {
      if (run.status === 'paused') {
        this.setRunStatus(run, 'running')
        this.scheduleNext(run.id)
      }
    }
    this.changed()
    return { meta: { counts: this.strip() } }
  }

  advanceClock(to: string, user: UserId) {
    if (!isOwner(user)) throw new MockError(403, 'owner_only', 'The demo clock is owner-only.')
    if (this.s.advance && !this.s.advance.done) throw new MockError(409, 'advance_in_progress', 'The clock is already advancing.')
    const from = this.s.now
    const advance_id = this.id('adv')
    const ticks = 4
    this.s.advance = { advance_id, now: from, events_fired: 0, runs_started: 0, live_runs: 0, done: false }
    for (let i = 1; i <= ticks; i++) {
      this.opts.schedule(() => {
        const done = i === ticks
        if (done) this.s.now = to
        this.s.advance = {
          advance_id,
          now: done ? to : from,
          events_fired: done ? Array.from({ length: 9 }, (_, k) => ({ seq: k })) : i * 2,
          runs_started: i,
          live_runs: 0,
          done,
        }
        this.fire('advance', this.s.advance)
        this.changed()
      }, Math.max(1, this.opts.stepDelayMs) * i)
    }
    this.changed()
    return { advance_id, from, to }
  }

  // ── run engine ─────────────────────────────────────────────────────────────
  private startRun(r: { agent: AgentKind; trigger: Run['trigger']; actor: UserId; inbox_item_id: string | null; claim_id: string | null; plan: RunPlan }): Run {
    const id = this.id('run')
    const run: Run = {
      id,
      agent: r.agent,
      trigger: r.trigger,
      actor: r.actor,
      inbox_item_id: r.inbox_item_id,
      claim_id: r.claim_id,
      status: this.s.paused ? 'paused' : 'queued',
      mode: 'deterministic',
      planner: r.trigger === 'manual' ? 'recorded_plan' : 'scripted',
      started_at: this.s.now,
      steps: r.plan.steps.map((st, idx) => ({ idx, name: st.name, status: 'pending', progress_lines: [], evidence_ids: [] })),
      result_summary: null,
      audit_line: null,
      evidence: [],
      last_event_id: null,
    }
    this.s.runs[id] = run
    this.s.runLog[id] = []
    this.plans.set(id, r.plan)
    this.fire('run', { run_id: id, agent: run.agent, status: run.status, claim_id: run.claim_id })
    if (!this.s.paused) this.scheduleNext(id)
    return run
  }

  /** After a reload, re-attach plans to unfinished runs and continue from the last ok step. */
  resumeRuns(): void {
    for (const run of Object.values(this.s.runs)) {
      if (run.id === 'run_bg_hill_rep' || ['succeeded', 'failed', 'cancelled', 'would_have_run'].includes(run.status)) continue
      const plan = this.rebuildPlan(run)
      if (!plan) continue
      this.plans.set(run.id, plan)
      if (run.status !== 'paused') this.scheduleNext(run.id)
    }
  }

  private rebuildPlan(run: Run): RunPlan | null {
    if (run.trigger === 'manual' && run.claim_id) {
      const claim = this.s.claims.find((c) => c.id === run.claim_id)
      return claim ? this.triagePlan(claim) : null
    }
    const item = this.s.items.find((i) => i.id === run.inbox_item_id)
    return item ? this.approvalPlan(item, (run.actor as UserId | null) ?? 'usr_dana') : null
  }

  private emit(runId: string, event: string, data: unknown) {
    const rec: SseRecord = { id: ++this.s.eventSeq, event, data }
    this.s.runLog[runId] = [...(this.s.runLog[runId] ?? []), rec]
    const run = this.s.runs[runId]
    if (run) run.last_event_id = rec.id
    this.runSubs.get(runId)?.forEach((fn) => {
      fn(rec)
    })
  }

  private fire(event: string, data: unknown) {
    const rec: SseRecord = { id: ++this.s.eventSeq, event, data }
    this.fireSubs.forEach((fn) => {
      fn(rec)
    })
  }

  private setRunStatus(run: Run, status: Run['status']) {
    run.status = status
    this.emit(run.id, 'status', { status, planner: run.planner, model_situation_label: run.model_situation_label ?? null })
    this.fire('run', { run_id: run.id, agent: run.agent, status, claim_id: run.claim_id })
  }

  private scheduleNext(runId: string) {
    this.opts.schedule(() => {
      this.advanceRun(runId)
    }, this.opts.stepDelayMs)
  }

  /** One transition per tick: start the next pending step, or complete the running one, or finish. */
  private advanceRun(runId: string) {
    const run = this.s.runs[runId]
    const plan = this.plans.get(runId)
    if (!run || !plan || ['succeeded', 'failed', 'cancelled'].includes(run.status)) return
    if (this.s.paused) {
      if (run.status !== 'paused') this.setRunStatus(run, 'paused')
      this.changed()
      return
    }
    if (run.status === 'queued' || run.status === 'paused') this.setRunStatus(run, 'running')
    const running = run.steps.find((st) => st.status === 'running')
    if (running) {
      const sp = plan.steps[running.idx]
      const pending = (sp?.progress ?? []).filter((l) => !running.progress_lines.includes(l))
      if (pending[0] !== undefined) {
        running.progress_lines = [...running.progress_lines, pending[0]]
        this.emit(runId, 'step', { idx: running.idx, name: running.name, phase: 'progress', status: 'running', progress_line: pending[0] })
      } else {
        this.completeStep(run, running, sp)
      }
    } else {
      const next = run.steps.find((st) => st.status === 'pending')
      if (next) {
        next.status = 'running'
        next.started_at = this.s.now
        this.emit(runId, 'step', { idx: next.idx, name: next.name, phase: 'started', status: 'running' })
      } else {
        this.finishRun(run, plan)
        this.changed()
        return
      }
    }
    this.changed()
    this.scheduleNext(runId)
  }

  private completeStep(run: Run, step: RunStep, sp: StepPlan | undefined) {
    step.status = 'ok'
    step.finished_at = this.s.now
    step.output_summary = sp?.output ?? null
    step.policy_verdict = sp?.verdict ?? null
    if (sp?.evidence) {
      this.s.evidence[sp.evidence.id] = sp.evidence
      step.evidence_ids = [sp.evidence.id]
      run.evidence = [...run.evidence, sp.evidence]
    }
    this.emit(run.id, 'step', { idx: step.idx, name: step.name, phase: 'completed', status: 'ok', output_summary: step.output_summary, policy_verdict: step.policy_verdict, evidence: sp?.evidence ?? null })
    const situation = this.plans.get(run.id)?.situation
    if (step.name === 'decide' && situation) {
      run.model_situation_label = situation.label
      run.plan = { rationale: situation.rationale }
      this.emit(run.id, 'status', { status: run.status, planner: run.planner, model_situation_label: situation.label })
    }
  }

  private finishRun(run: Run, plan: RunPlan) {
    plan.onDone(this, run)
    run.finished_at = this.s.now
    this.emit(run.id, 'counts', this.strip())
    this.setRunStatus(run, 'succeeded')
    this.emit(run.id, 'done', { status: 'succeeded', audit_line: run.audit_line, result_summary: run.result_summary })
    this.plans.delete(run.id)
  }

  subscribeRun(runId: string, lastEventId: number | null, push: (r: SseRecord) => void): { replay: SseRecord[]; terminal: boolean; unsubscribe: () => void } {
    const log = this.s.runLog[runId]
    if (!log) throw new MockError(404, 'not_found', `Run ${runId} not found`)
    const replay = log.filter((r) => lastEventId === null || r.id > lastEventId)
    const run = this.s.runs[runId]
    const terminal = run ? ['succeeded', 'failed', 'cancelled', 'would_have_run'].includes(run.status) : true
    let subs = this.runSubs.get(runId)
    if (!subs) {
      subs = new Set()
      this.runSubs.set(runId, subs)
    }
    subs.add(push)
    return {
      replay,
      terminal,
      unsubscribe: () => {
        this.runSubs.get(runId)?.delete(push)
      },
    }
  }

  subscribeFirehose(push: (r: SseRecord) => void): () => void {
    this.fireSubs.add(push)
    return () => this.fireSubs.delete(push)
  }

  // ── recipes ────────────────────────────────────────────────────────────────
  private pushTimeline(claimId: string, e: Omit<ClaimDetail['timeline'][number], 'id' | 'at' | 'evidence'> & { evidence?: Evidence[] }) {
    const claim = this.s.claims.find((c) => c.id === claimId)
    if (!claim) return
    claim.timeline = [...claim.timeline, { id: this.id('tl'), at: this.s.now, evidence: [], ...e }]
    claim.last_activity = { at: this.s.now, label: e.title.slice(0, 40) }
  }

  private addActivity(run: Run, action: string, outcome: string, user: UserId | null) {
    const claim = this.s.claims.find((c) => c.id === run.claim_id)
    this.s.activity = [
      {
        id: this.id('act'),
        at: this.s.now,
        agent: run.agent,
        action,
        subject: claim ? `#${claim.number} ${claim.patient_name}` : '—',
        outcome: user ? `${outcome} · approved by ${USER_NAME[user]}` : outcome,
        status: 'succeeded',
        claim_id: run.claim_id ?? null,
        evidence_count: run.evidence.length,
        ran_without_review: false,
      },
      ...this.s.activity,
    ]
  }

  private approvalPlan(item: InboxItem, user: UserId): RunPlan {
    const claim = this.s.claims.find((c) => c.id === item.claim_id)
    const action = item.proposed_action?.action ?? 'status_check'
    if (action === 'resubmit_with_attachment' && claim) {
      const tooth = String(item.proposed_action?.params.tooth ?? '')
      const nea = String(47731820 + (claim.number % 97))
      const neaEvidence: Evidence = { id: `ev_${claim.number}_nea`, kind: 'nea_attachment', title: `PA #${tooth} uploaded to NEA FastAttach`, excerpt: `NEA# ${nea} · periapical #${tooth} · from PMS imaging`, captured_at: this.s.now, reference: nea, gathered_by: 'code' }
      return {
        steps: [
          { name: 'fetch_pa_from_pms_imaging', output: `PA #${tooth} · PMS imaging · ${claim.number === 4821 ? '10/12 10:41' : 'on file'}` },
          { name: 'upload_to_nea', output: `NEA# ${nea}`, evidence: neaEvidence },
          { name: 'write_nea_to_remarks', output: `Remarks: NEA# ${nea} · orig. ICN ${claim.icn ?? '—'}` },
          { name: 'queue_for_delta_file', output: 'Queued for the 11:15 Delta file via Vyne' },
        ],
        onDone: (db, run) => {
          run.result_summary = `Resubmit queued · leaves 11:15`
          run.audit_line = `Resubmitted #${claim.number} with PA #${tooth} (NEA# ${nea}) citing ICN ${claim.icn ?? '—'} · queued for the 11:15 Delta file · approved by ${USER_NAME[user]} · tier 1 · resubmit with attachment`
          claim.attachments = [...claim.attachments, { id: db.id('att'), claim_id: claim.id, kind: 'pa', nea_number: nea, source: 'pms_imaging', created_at: db.now, note: `PA #${tooth} · uploaded via NEA` }]
          claim.in_flight = 'resubmit queued · leaves 11:15'
          claim.agent_chip = { agent: 'followup', label: 'resubmit queued · 11:15' }
          db.pushTimeline(claim.id, { lane: 'agent', agent: 'followup', tier: 1, run_id: run.id, title: `Resubmitted with PA #${tooth} (NEA# ${nea}) · queued for the 11:15 Delta file`, evidence: [neaEvidence] })
          db.addActivity(run, 'Resubmit with attachment', 'queued for 11:15 Delta file', user)
        },
      }
    }
    return {
      steps: [
        { name: `act:${action}`, output: item.recommendation },
        { name: 'report', output: 'Audit line written' },
      ],
      onDone: (db, run) => {
        run.result_summary = 'Done'
        run.audit_line = `${action.replace(/_/g, ' ')} on ${claim ? `#${claim.number}` : (item.subject?.patient_name ?? item.id)} · approved by ${USER_NAME[user]} · tier ${item.tier ?? '—'}`
        if (claim) db.pushTimeline(claim.id, { lane: 'agent', agent: item.agent ?? null, tier: item.tier ?? null, run_id: run.id, title: run.audit_line })
        db.addActivity(run, action.replace(/_/g, ' '), 'done', user)
      },
    }
  }

  private triagePlan(claim: MockClaim): RunPlan {
    if (claim.number === 4744) {
      const portal: Evidence = { id: 'ev_4744_portal', kind: 'portal_screenshot', title: 'MetLife portal correspondence · 10/22', excerpt: '“Please provide the date of extraction of tooth #14 and indicate whether this is an initial placement or a replacement prosthesis.”', captured_at: at('2026-10-22', '09:12'), reference: 'ML-CORR-1022-4410', gathered_by: 'agent' }
      const note: Evidence = { id: 'ev_4744_note', kind: 'note_excerpt', title: 'PMS note · 2019-03-02 · D7140 #14', excerpt: 'Extraction #14, non-restorable fracture. Signed Dr. Morgan 2019-03-02.', captured_at: this.s.now, reference: 'VIS-2019-0302-14', gathered_by: 'agent' }
      return {
        steps: [
          { name: 'gather_case', output: 'Case file: claim, coverage (missing-tooth clause), 2 status checks, 1 correspondence' },
          { name: 'investigate', output: '3 reads chosen by the agent', progress: ['read portal correspondence 10/22', 'PMS visit 2019-03-02 · D7140 #14', 'coverage · missing-tooth clause'], evidence: portal },
          { name: 'decide', output: 'Records request · Ask Dana → inbox', verdict: 'propose', evidence: note },
          { name: 'report', output: 'New inbox item with 2 citations' },
        ],
        situation: {
          label: 'payer asks for missing-tooth history',
          rationale: 'MetLife’s 10/22 letter asks when #14 was extracted and whether the bridge is initial or a replacement. The signed 2019-03-02 D7140 #14 note answers both, so a records request with that note fits the reviewed envelope. The classifier could not name this situation, so it goes to Dana rather than running.',
        },
        onDone: (db, run) => {
          run.result_summary = 'Proposed: records request with the 2019 extraction note'
          run.audit_line = `Triage #${claim.number} · situation unknown → "payer asks for missing-tooth history" · proposed records request (tier 1) · sent to Inbox, not run · recorded agent plan`
          db.s.items = [
            ...db.s.items,
            {
              id: `inb_${claim.number}`,
              kind: 'approve_action',
              state: 'open',
              claim_id: claim.id,
              agent: 'followup',
              title: `#${claim.number} · ${claim.patient_name} · MetLife asks for #14 history`,
              recommendation: 'Send a records request via NEA with the 2019-03-02 extraction note for #14; answer: replacement prosthesis, extraction 03/02/2019.',
              summary: 'Pended for information (no CARC). The agent read the correspondence and found the 2019 extraction note.',
              confidence: null,
              evidence: [portal.id, note.id],
              proposed_action: { action: 'records_request', params: { note_visit_ids: ['VIS-2019-0302-14'] }, cents: claim.billed_cents, requires_hold_window: false },
              plan_steps: ['Upload the 2019-03-02 note via NEA', 'Reply to the correspondence citing the NEA#'],
              tier: 1,
              created_at: db.now,
              cents: claim.billed_cents,
              subject: { claim_number: claim.number, patient_name: claim.patient_name, payer_key: claim.payer_key },
              audit_note: 'unknown situation — proposals from an unknown triage never run without review',
              root_cause: 'unknown',
              run_id: run.id,
            },
          ]
          db.pushTimeline(claim.id, { lane: 'agent', agent: 'followup', run_id: run.id, title: 'Triage: payer asks for missing-tooth history → records request proposed', evidence: [portal, note] })
        },
      }
    }
    return {
      steps: [
        { name: 'gather_case', output: `Case file for #${claim.number}` },
        { name: 'investigate', output: 'Status read', progress: ['read payer status'] },
        { name: 'decide', output: 'Nothing to do now · next status check on schedule', verdict: 'observe' },
        { name: 'report', output: 'Audit line written' },
      ],
      situation: { label: 'routine · in process', rationale: 'The payer reports the claim in process inside its normal window; the scheduled status check covers it.' },
      onDone: (db, run) => {
        run.result_summary = 'No action needed'
        run.audit_line = `Triage #${claim.number} · in process · no action · next status check on schedule`
        db.pushTimeline(claim.id, { lane: 'agent', agent: 'followup', run_id: run.id, title: run.audit_line })
      },
    }
  }

  /** Test hook: mark an item's payer file as departed so approve returns 409 file_departed. */
  departFile(itemId: string, leftAt: string) {
    this.s.items = this.s.items.map((i) => (i.id === itemId && i.proposed_action ? { ...i, proposed_action: { ...i.proposed_action, params: { ...i.proposed_action.params, file_departed_at: leftAt } } } : i))
  }
}
