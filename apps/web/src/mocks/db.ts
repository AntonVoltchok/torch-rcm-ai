/**
 * The mock API's server side, in memory. Pure TypeScript (no MSW), so it is testable on its own and the
 * MSW handlers in ./handlers.ts stay a thin HTTP adapter.
 *
 * It behaves like the real server where the UI can tell the difference: counts are derived on every read
 * (strip = GROUP BY status; `needs_action` = an open item references the claim), mutations return
 * `meta.counts`, approvals start runs that stream step events with ids, and replay honours Last-Event-ID.
 */
import type {
  ActivityOut,
  ActivityRow,
  AdvanceSnapshot,
  AgentKind,
  BenefitsPanel,
  CashSummary,
  ClaimDetail,
  ClaimRow,
  ClaimStatus,
  ClaimSummary,
  DenialGroup,
  DenialRow,
  DenialsOut,
  EligibilityOut,
  EventFired,
  Evidence,
  FileEntry,
  HeldRow,
  InboxGroup,
  InboxItem,
  InboxItemDetail,
  InboxList,
  HoldWindow,
  PatientRef,
  Ledger,
  LedgerRow,
  NextAction,
  PolicyVerdict,
  Preview,
  Role,
  Rule,
  RuleChange,
  RuleMode,
  RulePatch,
  RuleProposal,
  RulesOut,
  Run,
  RunDetail,
  RunView,
  RunViewStep,
  SavedView,
  StripSummary,
  Tier,
} from './wire'
import { CLAIM_STATUSES, Evidence as EvidenceSchema } from '@/api/schema'
import type { ClaimsApiParams } from '@/features/claims/search'
import { at, buildClaims, FROZEN_NOW, OWENS_RUNS, paidTileCents, PROVIDER_ID, STATUS_CHECK_CLAIMS, type MockClaim, type MockTimelineEntry } from './fixtures/claims'
import { buildInbox, EVIDENCE, GROUP_META, type MockInboxItem } from './fixtures/inbox'
import { buildProposals, buildRuleChanges, buildRules, ITEM_RULE, PRACTICE_CAP_CENTS, TIER_TEXT } from './fixtures/settings'
import {
  benefitsFor,
  buildWeek,
  CASH,
  coverageFor,
  ELIGIBILITY,
  NEXT_ACTION_LABEL,
  NEXT_ACTION_ORDER,
  OVERNIGHT_DENIALS,
  PAYER_REF,
  patientBillableIfLost,
  plusMinutes,
  routeDenial,
  SELF_FUNDED_CLAIMS,
  THURSDAY_0710,
  VIEWS,
  weekRow,
  type WeekRow,
} from './fixtures/static'

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
const USER_ROLE: Record<UserId, Role> = { usr_dana: 'billing', usr_morgan: 'owner', usr_lee: 'dentist', usr_tasha: 'front_desk' }
const isOwner = (u: UserId) => u === 'usr_morgan'
const USERS_BY_ID: Record<string, UserId> = { usr_dana: 'usr_dana', usr_morgan: 'usr_morgan', usr_lee: 'usr_lee', usr_tasha: 'usr_tasha' }
const nameOf = (id: string | null | undefined): string | null => (id && id in USER_NAME ? USER_NAME[id as UserId] : (id ?? null))
/** Remittances awaiting review in the seed (the API's `nav_badges.payments` before the clock moves). */
const SEED_REMITS_TO_REVIEW = 3
/** Wednesday's sends whose payer 277CA is still due at Thu 07:10 (the corrected Haddad claim re-entered Vyne last). */
const PAYER_ACK_AFTER_0710 = new Set([4854])
/** What the six overnight 835s paid, in the order they are picked (oldest pending first); they sum to $3,446.46. */
const OVERNIGHT_PAID_CENTS = [58_125, 44_437, 86_624, 30_006, 65_678, 59_776]
const AR: readonly ClaimStatus[] = ['sent', 'rejected', 'accepted', 'pending', 'denied', 'appealed', 'partial']
const FILE_TIMES = Array.from({ length: 22 }, (_, i) => {
  const m = 7 * 60 + 45 + i * 30 // per-payer files every 30 min, 7:45 AM – 6:15 PM
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
})
const daysBetween = (fromDay: string, toDay: string) => Math.round((Date.parse(`${toDay}T12:00:00Z`) - Date.parse(`${fromDay}T12:00:00Z`)) / 86_400_000)

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
  onDone: (db: MockDb, run: RunView) => void
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
  items: MockInboxItem[]
  evidence: Record<string, Evidence>
  /** Stored runs carry RunDetail's evidence and cursor; `run()` / `wireRun()` split them back out. */
  runs: Record<string, RunView>
  runLog: Record<string, SseRecord[]>
  /** This week's runs and people's actions (Activity), incl. the decisions Settings previews against. */
  week: WeekRow[]
  views: SavedView[]
  proposals: RuleProposal[]
  rules: Rule[]
  ruleChanges: RuleChange[]
  practiceCapCents: number
  /** Demo step 8 has been applied (the overnight between Wed 10:40 and Thu 07:10). */
  overnight: boolean
  /** 835s delivered since the seed that no posting run has touched (Payments' nav badge counts them). */
  remitsToReview: number
  paused: { by: string; at: string } | null
  advance: AdvanceSnapshot | null
  advancePhase: number
  seq: number
  eventSeq: number
}

/** A step before it starts, with the API's defaults filled in. */
const newStep = (idx: number, name: string): RunViewStep => ({ idx, name, label: '', status: 'pending', tool: '', input_summary: '', output_summary: '', progress_lines: [], evidence_ids: [] })

function initialState(): State {
  const bgRun: RunView = {
    id: 'run_bg_hill_rep',
    agent: 'followup',
    trigger: 'rule',
    rule_id: 'rule_t1_payer_rep_call',
    claim_id: 'clm_4512',
    idempotency_key: 'seed:run_bg_hill_rep',
    status: 'running',
    mode: 'deterministic',
    planner: 'scripted',
    started_at: at('2026-10-28', '10:31'),
    steps: [
      { ...newStep(0, 'gather_case'), status: 'ok', output_summary: 'Aetna · 104 d · in process' },
      { ...newStep(1, 'act:payer_rep_call'), status: 'running', output_summary: 'On hold with Aetna provider services · 9 min' },
    ],
    action_label: '',
    result_summary: '',
    audit_line: '',
    outcome: '',
    evidence: [],
    last_event_id: 0,
  }
  const owensRuns: RunView[] = OWENS_RUNS.map(({ evidence, ...r }) => ({
    ...r,
    agent: 'followup',
    trigger: 'rule',
    idempotency_key: `seed:${r.id}`,
    status: 'succeeded',
    mode: 'deterministic',
    planner: 'scripted',
    steps: [{ ...newStep(0, 'act:status_check'), status: 'ok', evidence_ids: [evidence.id] }],
    result_summary: r.action_label,
    audit_line: '',
    outcome: '',
    evidence: [EvidenceSchema.parse(evidence)],
    last_event_id: 0,
  }))
  const claims = buildClaims()
  return {
    now: FROZEN_NOW,
    claims,
    items: buildInbox().map((i) => ({ ...i, rule_id: ITEM_RULE[i.id] ?? i.rule_id ?? null })),
    evidence: Object.fromEntries(EVIDENCE.map((e) => [e.id, e])),
    runs: Object.fromEntries([bgRun, ...owensRuns].map((r) => [r.id, r])),
    runLog: Object.fromEntries([bgRun, ...owensRuns].map((r) => [r.id, []])),
    week: buildWeek(claims),
    views: [...VIEWS],
    proposals: buildProposals(),
    rules: buildRules(),
    ruleChanges: buildRuleChanges(),
    practiceCapCents: PRACTICE_CAP_CENTS,
    overnight: false,
    remitsToReview: 0,
    paused: null,
    advance: null,
    advancePhase: 0,
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
  private openItems(): MockInboxItem[] {
    return this.s.items.filter((i) => i.state === 'open')
  }
  needsAction(claimId: string): boolean {
    return this.openItems().some((i) => i.claim_id === claimId)
  }
  // ── wire shapes, built as the API's read models build them (readmodels/inbox.py, api/runs) ──────────
  private claimOf(item: MockInboxItem): MockClaim | undefined {
    return item.claim_id ? this.s.claims.find((c) => c.id === item.claim_id) : undefined
  }
  /** The API sets an item's patient from its claim, or from the appointment for eligibility flags. */
  private patientOf(item: MockInboxItem): PatientRef | null {
    const claim = this.claimOf(item)
    if (claim) return this.summary(claim).patient
    return ELIGIBILITY.find((a) => a.appointment_id === item.appointment_id)?.patient ?? null
  }
  /** `InboxItemOut`. The mock keeps its rows in priority order, so `priority` is that rank (higher first). */
  private itemOut(item: MockInboxItem): InboxItem {
    const claim = this.claimOf(item)
    const evidence = item.evidence_ids.map((e) => this.s.evidence[e]).filter((e): e is Evidence => Boolean(e))
    const index = this.s.items.findIndex((i) => i.id === item.id)
    return {
      id: item.id,
      kind: item.kind,
      state: item.state,
      title: item.title,
      summary: item.summary ?? '',
      recommendation: item.recommendation,
      agent: item.agent ?? null,
      tier: item.tier ?? null,
      cents: item.cents,
      confidence: item.confidence ?? null,
      group_key: item.group_key ?? null,
      group_title: item.group_title ?? (item.group_key ? (GROUP_META[item.group_key]?.title ?? null) : null),
      claim: claim ? this.summary(claim) : null,
      patient: this.patientOf(item),
      appointment_id: item.appointment_id ?? null,
      remittance_id: item.remittance_id ?? null,
      rule_id: item.rule_id ?? null,
      run_id: item.run_id ?? null,
      evidence_ids: item.evidence_ids,
      proposed_action: item.proposed_action ?? null,
      required_role: item.required_role ?? null,
      assignee_user_id: item.assignee_user_id ?? null,
      deadline_on: item.deadline_on ?? null,
      created_at: item.created_at,
      snoozed_until: item.snoozed_until ?? null,
      resolved_by: item.resolved_by ?? null,
      resolved_at: item.resolved_at ?? null,
      priority: index === -1 ? 0 : this.s.items.length - index,
      root_cause: item.root_cause ?? claim?.denial?.root_cause ?? null,
      suspicious_evidence: evidence.some((e) => e.suspicious === true),
    }
  }
  /** As the API: the claim's queued payer file gives the window; once it has left, only a corrected claim is left. */
  private holdWindow(item: MockInboxItem): HoldWindow | null {
    const claim = this.claimOf(item)
    if (!claim) return null
    const leftAt = item.proposed_action?.params?.file_departed_at
    if (typeof leftAt === 'string') return { editable_until: null, file_time: claim.queued_file?.at ?? at(this.s.now.slice(0, 10), leftAt), departed: true, alternatives: ['corrected_claim'] }
    if (!claim.queued_file) return null
    return { editable_until: plusMinutes(claim.queued_file.at, -1), file_time: claim.queued_file.at, departed: false, alternatives: [] }
  }
  private itemDetail(item: MockInboxItem): InboxItemDetail {
    return {
      ...this.itemOut(item),
      plan_steps: item.plan_steps,
      audit_note: item.audit_note ?? null,
      evidence: item.evidence_ids.map((e) => this.s.evidence[e]).filter((e): e is Evidence => Boolean(e)),
      payload: item.payload ?? {},
      hold_window: this.holdWindow(item),
    }
  }
  /** API `Run`: the stored run without RunDetail's evidence and cursor. */
  private wireRun(run: RunView): Run {
    const { evidence: _e, last_event_id: _l, ...wire } = run
    return { ...wire, steps: run.steps.map((st) => ({ ...st })) }
  }

  private claimsAt(location?: string): MockClaim[] {
    return location ? this.s.claims.filter((c) => c.location_id === location) : this.s.claims
  }

  /**
   * The viewer's open queue, as the API's `visible_inbox`: billing and the owner see the shared queue plus
   * items assigned to them; the front desk sees eligibility flags; a dentist sees only items assigned to them.
   */
  visibleItems(user: UserId = 'usr_dana'): MockInboxItem[] {
    const role = USER_ROLE[user]
    return this.openItems().filter((i) => {
      const mine = i.assignee_user_id === user
      const shared = !i.assignee_user_id
      if (role === 'billing' || role === 'owner') return shared || mine
      if (role === 'front_desk') return mine || (shared && i.kind === 'eligibility_flag')
      return mine
    })
  }

  /** `meta.counts` for the acting user. */
  private counts(user: UserId = 'usr_dana'): StripSummary {
    return this.strip(undefined, user)
  }

  strip(location?: string, user: UserId = 'usr_dana'): StripSummary {
    const claims = this.claimsAt(location)
    const tiles = CLAIM_STATUSES.map((status) => {
      const group = claims.filter((c) => c.status === status)
      return {
        status,
        count: group.length,
        cents: group.reduce((a, c) => a + (status === 'paid' ? paidTileCents(c) : c.billed_cents), 0),
        flagged: group.filter((c) => this.needsAction(c.id)).length,
        cents_basis: status === 'paid' ? ('paid' as const) : ('billed' as const),
        label: status === 'paid' ? 'Paid · Oct' : status[0]?.toUpperCase() + status.slice(1),
      }
    })
    const sum = (rows: MockClaim[]) => rows.reduce((a, c) => a + c.billed_cents, 0)
    const paidOct = claims.filter((c) => c.status === 'paid')
    const open = claims.filter((c) => c.status !== 'paid')
    const ar = claims.filter((c) => AR.includes(c.status))
    const flagged = claims.filter((c) => this.needsAction(c.id))
    const inbox = this.visibleItems(user)
    return {
      tiles,
      inbox_open: inbox.length,
      inbox_open_cents: inbox.reduce((a, i) => a + i.cents, 0),
      paid_month_count: paidOct.length,
      paid_month_cents: paidOct.reduce((a, c) => a + paidTileCents(c), 0),
      open_count: open.length,
      open_cents: sum(open),
      ar_count: ar.length,
      ar_cents: sum(ar),
      flagged_count: flagged.length,
      flagged_cents: sum(flagged),
      as_of: this.s.now,
      paid_month_label: 'Oct',
      nav_badges: {
        payments: SEED_REMITS_TO_REVIEW + this.s.remitsToReview,
        eligibility: inbox.filter((i) => i.kind === 'eligibility_flag').length,
        activity: this.decisions().filter((r) => r.ran).length,
      },
    }
  }

  inbox(p: { state?: string | null; kind?: string | null; agent?: string | null }, user: UserId = 'usr_dana'): InboxList {
    const state = p.state ?? 'open'
    const visible = new Set(this.visibleItems(user).map((i) => i.id))
    const mineOrShared = (i: MockInboxItem) => (state === 'open' ? visible.has(i.id) : !i.assignee_user_id || i.assignee_user_id === user || isOwner(user))
    const items = this.s.items.filter(
      (i) =>
        (state === 'done' ? !['open', 'snoozed'].includes(i.state) : i.state === state) &&
        mineOrShared(i) &&
        (!p.kind || i.kind === p.kind) &&
        (!p.agent || i.agent === p.agent),
    )
    const groups: InboxGroup[] = []
    for (const item of items) {
      if (!item.group_key) continue
      let g = groups.find((x) => x.group_key === item.group_key)
      if (!g) {
        g = { group_key: item.group_key, title: GROUP_META[item.group_key]?.title ?? item.group_key, count: 0, cents: 0, item_ids: [] }
        groups.push(g)
      }
      g.count++
      g.cents += item.cents
      g.item_ids.push(item.id)
    }
    // A group of one is just an item.
    return {
      items: items.map((i) => this.itemOut(i)),
      total: items.length,
      total_cents: items.reduce((a, i) => a + i.cents, 0),
      next_cursor: null,
      // As the API titles a group: the count is in the string.
      groups: groups.filter((g) => g.count > 1).map((g) => ({ ...g, title: `${g.title} (${g.count})` })),
    }
  }

  inboxItem(id: string): InboxItemDetail {
    const item = this.s.items.find((i) => i.id === id)
    if (!item) throw new MockError(404, 'not_found', `Inbox item ${id} not found`)
    return this.itemDetail(item)
  }

  private row(c: MockClaim): ClaimRow {
    return {
      ...this.summary(c),
      provider_id: PROVIDER_ID[c.provider_name] ?? 'prv_morgan',
      provider_name: c.provider_name,
      location_id: c.location_id,
      agent_note: this.openItems().find((i) => i.claim_id === c.id)?.title ?? c.in_flight ?? c.agent_note,
      last_activity_at: c.last_activity?.at ?? null,
      last_activity: c.last_activity?.label ?? null,
    }
  }

  claims(p: Partial<ClaimsApiParams> & { cursor?: string | null; limit?: number; location_id?: string | null }) {
    let rows = this.claimsAt(p.location_id ?? undefined)
    if (p.status?.length) rows = rows.filter((c) => p.status?.includes(c.status))
    if (p.needs_action) rows = rows.filter((c) => this.needsAction(c.id))
    if (p.payer) rows = rows.filter((c) => c.payer_key === p.payer)
    if (p.provider) rows = rows.filter((c) => PROVIDER_ID[c.provider_name] === p.provider)
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

  /** GET /claims/{id}, as the API's `claim_detail`: the summary plus everything the page needs, in one request. */
  claim(id: string): ClaimDetail {
    const c = this.s.claims.find((x) => x.id === id)
    if (!c) throw new MockError(404, 'not_found', `Claim ${id} not found`)
    const summary = this.summary(c)
    const allowed = c.allowed_cents
    return {
      claim: summary,
      provider_name: c.provider_name,
      location_name: c.location_id === 'loc_riverside' ? 'Riverside' : 'Downtown',
      coverage: coverageFor(c),
      patient: summary.patient,
      payer: summary.payer,
      lines: c.lines,
      attachments: c.attachments,
      acks: c.acks,
      readiness: c.readiness,
      denial: c.denial,
      deadline: c.deadline ?? { kind: 'none', due_on: null, basis: '' },
      money: {
        billed_cents: c.billed_cents,
        allowed_cents: allowed,
        contractual_cents: allowed === null ? null : c.billed_cents - allowed,
        insurance_est_cents: null,
        patient_est_cents: c.patient_resp_cents,
        paid_cents: c.paid_cents,
        writeoff_cents: c.writeoff_cents,
        patient_resp_cents: c.patient_resp_cents,
        basis: c.status === 'paid' || c.status === 'partial' ? 'per 835' : `estimate from contract allowed · ${coverageFor(c).plan_name}`,
      },
      timeline: c.timeline.map((e) => ({ ...e, kind: e.lane })),
      timeline_next_cursor: null,
      open_inbox_items: this.openItems().filter((i) => i.claim_id === id).map((i) => this.itemOut(i)),
      holds: c.hold ? [c.hold] : [],
      file_entries: c.queued_file ? [this.fileEntry(c, c.queued_file)] : [],
      parent_claim_id: c.parent_claim_id,
      frequency_code: c.frequency_code,
      closed_reason: c.closed_reason ?? null,
      timely_filing_due: c.timely_filing_due,
    }
  }

  private fileEntry(c: MockClaim, f: NonNullable<MockClaim['queued_file']>): FileEntry {
    return { id: `fe_${c.number}`, claim_id: c.id, payer_key: c.payer_key, file_time: f.at, kind: f.kind, state: 'queued', queued_at: c.built_at, queued_by: 'system' }
  }

  /** GET /runs/{id} → `RunDetail {run, evidence, last_event_id}`. */
  run(id: string): RunDetail {
    const r = this.s.runs[id]
    if (!r) throw new MockError(404, 'not_found', `Run ${id} not found`)
    return { run: this.wireRun(r), evidence: r.evidence.flatMap((e) => (e.excerpt === undefined ? [] : [EvidenceSchema.parse(e)])), last_event_id: r.last_event_id ?? 0 }
  }

  agentsStatus() {
    const runs = Object.values(this.s.runs)
    return {
      paused: this.s.paused !== null,
      paused_by: this.s.paused?.by ?? null,
      paused_at: this.s.paused?.at ?? null,
      mode: 'deterministic' as const,
      live_agents: [] as AgentKind[],
      agents: 5,
      running: runs.filter((r) => r.status === 'running').length,
      queued: runs.filter((r) => r.status === 'queued').length,
      paused_runs: runs.filter((r) => r.status === 'paused').length,
    }
  }

  /** This week's decisions (API `this_week`): what Settings previews and Activity's header counts. */
  private decisions(): WeekRow[] {
    return this.s.week.filter((r) => r.decision)
  }

  /** GET /activity?day&agent&outcome — newest first; `awaiting_you` is read live from the open items. */
  activity(p: { day?: string | null; agent?: string | null; outcome?: string | null }, user: UserId = 'usr_dana'): ActivityOut {
    const open = new Set(this.openItems().map((i) => i.id))
    const toRow = (r: WeekRow): ActivityRow => ({
      run_id: r.run_id,
      at: r.at,
      agent: r.agent,
      actor: r.actor,
      action: r.action,
      subject: r.subject,
      claim_id: r.claim_id && this.s.claims.some((c) => c.id === r.claim_id) ? r.claim_id : null,
      outcome: r.inbox_item_id && !open.has(r.inbox_item_id) && r.outcome === 'Awaiting you' ? 'Resolved' : r.outcome,
      would_have_run: r.status === 'would_have_run',
      awaiting_you: r.inbox_item_id !== null && open.has(r.inbox_item_id),
      evidence_kinds: r.evidence_kinds,
      audit_line: r.audit_line,
      tier: r.tier,
    })
    let rows = this.s.week
      .filter((r) => (!p.day || r.at.slice(0, 10) === p.day) && (!p.agent || r.agent === p.agent))
      .filter((r) => !(p.agent && r.agent === null))
      .map(toRow)
    if (p.outcome === 'awaiting') rows = rows.filter((r) => r.awaiting_you)
    else if (p.outcome === 'ran') rows = rows.filter((r) => !r.awaiting_you && r.agent !== null)
    else if (p.outcome === 'would_have_run') rows = rows.filter((r) => r.would_have_run)
    rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    const by_agent: Record<string, Record<string, number>> = {}
    const by_tier: Record<string, Record<string, number>> = {}
    for (const r of this.decisions()) {
      const bucket = r.ran ? 'ran' : 'to_dana'
      const a = (by_agent[r.agent ?? 'none'] ??= { ran: 0, to_dana: 0 })
      a[bucket] = (a[bucket] ?? 0) + 1
      const t = (by_tier[r.tier === null ? 'none' : String(r.tier)] ??= { ran: 0, to_dana: 0 })
      t[bucket] = (t[bucket] ?? 0) + 1
    }
    const week = this.s.week
    return {
      rows,
      summary: {
        ran_without_you: this.decisions().filter((r) => r.ran).length,
        awaiting_you: this.visibleItems(user).length,
        decisions: this.decisions().length,
        status_checks: week.filter((r) => r.action_kind === 'status_check').length,
        payer_calls: week.filter((r) => r.action_kind === 'payer_rep_call').length,
        claims_sent: week.filter((r) => (r.action_kind === 'send_claim_pms_codes' || r.action_kind === 'send_claim_agent_text') && r.ran).length,
        remittances_posted: week.filter((r) => r.action_kind === 'post_era_line' && r.ran).length,
      },
      by_agent,
      by_tier,
    }
  }

  views() {
    return { items: this.s.views, total: this.s.views.length }
  }
  get clock() {
    const adv = this.s.advance
    return { now: this.s.now, frozen: true, advancing: adv && !adv.done ? { advance_id: adv.advance_id, to: adv.to ?? this.s.now } : null }
  }
  advanceStatus(id: string): AdvanceSnapshot {
    if (this.s.advance?.advance_id !== id) throw new MockError(404, 'not_found', `Advance ${id} not found`)
    return this.s.advance
  }

  // ── inbox mutations ────────────────────────────────────────────────────────
  private openItem(id: string): MockInboxItem {
    const item = this.s.items.find((i) => i.id === id)
    if (!item) throw new MockError(404, 'not_found', `Inbox item ${id} not found`)
    if (item.state !== 'open') throw new MockError(409, 'already_resolved', `Already ${item.state} by ${item.resolved_by ?? 'someone'}.`)
    return item
  }

  private resolve(item: MockInboxItem, state: MockInboxItem['state'], user: UserId): MockInboxItem {
    const next = { ...item, state, resolved_by: user, resolved_at: this.s.now }
    this.s.items = this.s.items.map((i) => (i.id === item.id ? next : i))
    return next
  }

  approve(id: string, user: UserId, label?: string): { item: InboxItem; run: Run | null; rule?: Rule; meta: { counts: StripSummary } } {
    const item = this.openItem(id)
    if (item.kind === 'owner_signoff') return this.approveSignoff(item, user)
    const { item: resolved, run } = this.approveItem(item, user, label)
    return { item: this.itemOut(resolved), run: this.wireRun(run), meta: { counts: this.counts(user) } }
  }

  private approveItem(item: MockInboxItem, user: UserId, label?: string): { item: MockInboxItem; run: RunView } {
    if (item.tier === 3 && !isOwner(user)) throw new MockError(403, 'tier_requires_owner', 'Tier 3 commits the practice: Dr. Morgan acts on this one.')
    const params = item.proposed_action?.params ?? {}
    const fileLeft = typeof params.file_departed_at === 'string'
    if (fileLeft) {
      throw new MockError(409, 'file_departed', `#${this.claimOf(item)?.number ?? ''} left in the ${String(params.file_departed_at)} file. Your edits go as a corrected claim.`, { left_at: params.file_departed_at }, ['corrected_claim'])
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
    return { item: resolved, run }
  }

  /** Dr. Morgan signs a tier-2 rule change someone else asked for: the change applies, signed; no run. */
  private approveSignoff(item: MockInboxItem, user: UserId) {
    if (!isOwner(user)) throw new MockError(403, 'tier_requires_owner', 'Only the owner signs tier-2 rules.')
    const rule = this.s.rules.find((r) => r.id === item.rule_id)
    if (!rule) throw new MockError(404, 'not_found', `Rule ${item.rule_id ?? ''} not found`)
    const change = (item.proposed_action?.params?.change ?? {}) as RulePatch
    const { rule: next } = this.applyRuleChange(rule, change, user, true)
    const resolved = this.resolve(item, 'approved', user)
    this.changed()
    return { item: this.itemOut(resolved), run: null, rule: next, meta: { counts: this.counts(user) } }
  }

  approveGroup(groupKey: string, user: UserId) {
    const members = this.openItems().filter((i) => i.group_key === groupKey)
    if (members.length === 0) throw new MockError(409, 'already_resolved', 'Nothing left to approve in this group.')
    const label = `Approve ${members.length} (${GROUP_META[groupKey]?.title ?? groupKey})`
    const results = members.map((m) => this.approve(m.id, user, label))
    return { items: results.map((r) => r.item), runs: results.flatMap((r) => (r.run ? [r.run] : [])), meta: { counts: this.counts(user) } }
  }

  reject(id: string, user: UserId, reason: string) {
    const item = this.resolve(this.openItem(id), 'rejected', user)
    if (item.claim_id) this.pushTimeline(item.claim_id, { lane: 'human', actor: USER_NAME[user], title: `${USER_NAME[user]} rejected the proposal: ${reason}` })
    this.changed()
    return { item: this.itemOut(item), meta: { counts: this.counts(user) } }
  }

  snooze(id: string, user: UserId, until: string) {
    const item = { ...this.openItem(id), state: 'snoozed' as const, snoozed_until: until, resolved_by: user }
    this.s.items = this.s.items.map((i) => (i.id === id ? item : i))
    this.changed()
    return { item: this.itemOut(item), meta: { counts: this.counts(user) } }
  }

  reopen(id: string, user: UserId = 'usr_dana') {
    const found = this.s.items.find((i) => i.id === id)
    if (!found) throw new MockError(404, 'not_found', `Inbox item ${id} not found`)
    const item = { ...found, state: 'open' as const, snoozed_until: null, resolved_by: null, resolved_at: null }
    this.s.items = this.s.items.map((i) => (i.id === id ? item : i))
    this.changed()
    return { item: this.itemOut(item), meta: { counts: this.counts(user) } }
  }

  alwaysAutoRun(id: string, user: UserId = 'usr_dana') {
    const item = this.openItem(id)
    if (item.tier !== 1) throw new MockError(422, 'tier_not_learnable', `Tier ${item.tier ?? '—'} actions need an owner-signed rule, not a learned one.`)
    const action = item.proposed_action?.action ?? 'status_check'
    if (item.root_cause === 'ours') {
      throw new MockError(422, 'root_cause_guard', 'Root cause is ours (our Claims agent attached the BWX). Fix the upstream rule instead — this can never be learned into auto-run.')
    }
    const proposal: RuleProposal = {
      id: this.id('prop'),
      title: `${action.replace(/_/g, ' ')} · ${this.claimOf(item)?.payer_key ?? 'all payers'}`,
      rule_draft: { rule_id: item.rule_id ?? null, action, mode: 'auto', scope: { payer_key: this.claimOf(item)?.payer_key ?? null } },
      evidence: { approved: 7, total: 8, outcome_k: 7, outcome_n: 8 },
      root_cause_guard: false,
      state: 'open',
      created_at: this.s.now,
      watching: false,
      source_item_id: item.id,
      note: `Proposed from ${item.title}.`,
    }
    this.s.proposals = [...this.s.proposals, proposal]
    this.changed()
    return { proposal, meta: { counts: this.counts(user) } }
  }

  corrected(claimId: string, user: UserId) {
    const claim = this.s.claims.find((c) => c.id === claimId)
    if (!claim) throw new MockError(404, 'not_found', `Claim ${claimId} not found`)
    const item: MockInboxItem = {
      id: this.id('itm'),
      kind: 'review_draft',
      state: 'open',
      claim_id: claimId,
      agent: 'claims',
      title: `#${claim.number} · corrected claim (freq. 7)`,
      recommendation: 'Review the corrected claim built from your edits before it goes in the next file.',
      confidence: null,
      evidence_ids: [],
      proposed_action: { action: 'corrected_claim', params: { requested_by: user }, cents: claim.billed_cents, requires_hold_window: false },
      plan_steps: [],
      tier: 2,
      created_at: this.s.now,
      cents: claim.billed_cents,
    }
    this.s.items = [...this.s.items, item]
    this.changed()
    return { claim: this.summary(claim), run: null, meta: { counts: this.counts(user) } }
  }

  saveView(name: string, search_params: Record<string, unknown>, user: UserId): SavedView {
    const view = { id: this.id('view'), name, search_params, owner_user_id: user, created_at: this.s.now, builtin: false }
    this.s.views = [...this.s.views, view]
    this.changed()
    return view
  }

  // ── agents runtime ─────────────────────────────────────────────────────────
  triage(claimId: string, user: UserId) {
    const claim = this.s.claims.find((c) => c.id === claimId)
    if (!claim) throw new MockError(404, 'not_found', `Claim ${claimId} not found`)
    if (this.s.paused) throw new MockError(409, 'agents_paused', `Agents are paused by ${nameOf(this.s.paused.by) ?? ''}.`)
    const busy = Object.values(this.s.runs).some((r) => r.claim_id === claimId && ['queued', 'running', 'paused'].includes(r.status))
    if (busy || this.needsAction(claimId)) throw new MockError(409, 'run_in_progress', `#${claim.number} already has a run or an open item.`)
    const run = this.startRun({ agent: 'followup', trigger: 'manual', actor: user, claim_id: claimId, inbox_item_id: null, plan: this.triagePlan(claim) })
    return { run: this.wireRun(run), meta: { counts: this.counts(user) } }
  }

  pause(user: UserId) {
    if (!isOwner(user)) throw new MockError(403, 'forbidden', 'Only the owner can pause or resume agents.')
    this.s.paused = { by: user, at: this.s.now }
    this.fire('agents', { paused: true, by: user, at: this.s.now })
    this.changed()
    return this.agentsStatus()
  }

  resume(user: UserId) {
    if (!isOwner(user)) throw new MockError(403, 'forbidden', 'Only the owner can pause or resume agents.')
    this.s.paused = null
    this.fire('agents', { paused: false, by: user, at: this.s.now })
    for (const run of Object.values(this.s.runs)) {
      if (run.status === 'paused') {
        this.setRunStatus(run, 'running')
        this.scheduleNext(run.id)
      }
    }
    this.changed()
    return this.agentsStatus()
  }

  advanceClock(to: string, user: UserId) {
    if (!isOwner(user)) throw new MockError(403, 'owner_only', 'The demo clock is owner-only.')
    if (this.s.advance && !this.s.advance.done) throw new MockError(409, 'advance_in_progress', 'The clock is already advancing.')
    if (Date.parse(to) <= Date.parse(this.s.now)) throw new MockError(422, 'invalid_target', 'The demo clock only moves forward.')
    const from = this.s.now
    const advance_id = this.id('adv')
    this.s.advance = { advance_id, now: from, state: 'running', from, to, events_fired: [], runs_started: 0, live_runs: 0, skipped_unhandled: {}, done: false, error: null }
    this.s.advancePhase = 0
    this.scheduleAdvance()
    this.changed()
    return { advance_id, from, to }
  }

  /**
   * The scheduler, scripted: one tick per phase, each publishing `event: advance` with the running count.
   * Crossing Thu 07:10 for the first time plays demo step 8 (docs/spec/06-demo-script.md) against this DB.
   */
  private scheduleAdvance() {
    const adv = this.s.advance
    if (!adv || adv.done) return
    const to = adv.to ?? this.s.now
    const scripted = !this.s.overnight && Date.parse(adv.from ?? this.s.now) < Date.parse(THURSDAY_0710) && Date.parse(to) >= Date.parse(THURSDAY_0710)
    const phases: { now: string; run: () => EventFired[] }[] = scripted
      ? [
          { now: at('2026-10-28', '18:15'), run: () => this.phaseFiles() },
          { now: at('2026-10-29', '06:10'), run: () => this.phaseOvernight() },
          { now: at('2026-10-29', '07:00'), run: () => this.phaseMorning() },
        ]
      : []
    const total = phases.length + 1
    const tick = (i: number) => {
      const cur = this.s.advance
      if (!cur || cur.advance_id !== adv.advance_id || cur.done) return
      const phase = phases[i]
      const fired = Array.isArray(cur.events_fired) ? cur.events_fired : []
      if (phase) {
        this.s.now = phase.now
        const events = phase.run()
        this.s.advance = { ...cur, now: phase.now, events_fired: [...fired, ...events], runs_started: (cur.runs_started ?? 0) + events.filter((e) => e.kind.startsWith('run.')).length }
        this.s.advancePhase = i + 1
        this.fire('advance', { ...this.s.advance, events_fired: fired.length + events.length })
      } else {
        this.s.now = to
        if (scripted) this.s.overnight = true
        this.s.advance = { ...cur, now: to, state: 'done', done: true }
        this.fire('advance', this.s.advance)
      }
      this.changed()
      if (i + 1 < total) this.opts.schedule(() => tick(i + 1), Math.max(1, this.opts.stepDelayMs))
    }
    this.opts.schedule(() => tick(this.s.advancePhase), Math.max(1, this.opts.stepDelayMs))
  }

  // ── demo step 8, phase by phase ─────────────────────────────────────────────
  private event(kind: string, summary: string, data: Record<string, unknown> = {}): EventFired {
    return { at: this.s.now, kind, summary, job_id: this.id('job'), data }
  }

  private ack(c: MockClaim, stage: MockClaim['acks'][number]['stage'], code: string | null, message: string, when: string) {
    c.acks = [...c.acks, { id: this.id('ack'), claim_id: c.id, stage, code, message, at: when }]
    c.ack_stage = stage
  }

  /** Wed 10:45 and 11:15: the queued files leave; Vyne answers each with a 277CA A1 within minutes. */
  private phaseFiles(): EventFired[] {
    const out: EventFired[] = []
    const day = '2026-10-28'
    for (const c of this.s.claims) {
      const original = c.status === 'ready' && !c.hold
      const queued = c.queued_file
      if (!original && !queued) continue
      const left = queued?.at ?? at(day, c.file_time ?? '10:45')
      const hhmm = left.slice(11, 16)
      const payer = PAYER_REF[c.payer_key].short_name
      this.ack(c, 'file_999_ok', null, `${hhmm} ${payer} file accepted (999)`, plusMinutes(left, 1))
      this.ack(c, 'ch_277ca_a1', 'A1', `Vyne 277CA accepted, forwarded to ${payer}`, plusMinutes(left, 4))
      c.queued_file = null
      if (queued?.kind === 'resubmit') {
        c.in_flight = `resubmitted · left in the ${hhmm} ${payer} file · Vyne A1 · awaiting reprocessing`
        c.agent_note = `resubmit left ${hhmm}`
        this.pushTimelineAt(c, left, { lane: 'system', title: `Resubmit left in the ${hhmm} ${payer} file via Vyne · 999 accepted · 277CA A1` })
      } else {
        c.status = 'sent'
        c.sent_at = left
        c.file_time = null
        c.age_days = 0
        c.agent_note = null
        this.pushTimelineAt(c, left, { lane: 'system', title: `Left in the ${hhmm} ${payer} file via Vyne · 999 accepted · 277CA A1` })
      }
      out.push(this.event('file_departed', `#${c.number} left in the ${hhmm} ${payer} file`, { claim_id: c.id }))
      out.push(this.event('clearinghouse_ack', `#${c.number} Vyne 277CA A1`, { claim_id: c.id, code: 'A1' }))
    }
    return out
  }

  /**
   * Overnight: yesterday's accepted claims go "in process" at 05:00, Wednesday's sends get their payer 277CA, then the
   * 835s land (four denials, six paid). Nothing posts them: the posting agent has no run on `era.arrived` yet, so the
   * remittances wait in Payments, and no ERA line is held.
   */
  private phaseOvernight(): EventFired[] {
    const out: EventFired[] = []
    for (const c of this.s.claims.filter((x) => x.status === 'accepted')) {
      c.status = 'pending'
      c.timeline = [...c.timeline, { id: this.id('tl'), at: at('2026-10-29', '05:00'), lane: 'payer', title: `${PAYER_REF[c.payer_key].short_name} 277: in process` }]
      out.push(this.event('payer_in_process', `#${c.number} in process at ${PAYER_REF[c.payer_key].short_name}`, { claim_id: c.id }))
    }
    for (const c of this.s.claims.filter((x) => x.status === 'sent' && !PAYER_ACK_AFTER_0710.has(x.number))) {
      c.icn = c.icn ?? `26302-${String(100000 + c.number * 13).slice(-6)}`
      this.ack(c, 'payer_277ca_a1', 'A1', `${PAYER_REF[c.payer_key].short_name} accepted · ICN ${c.icn}`, at('2026-10-29', '05:12'))
      c.status = 'accepted'
      out.push(this.event('payer_ack', `#${c.number} ${PAYER_REF[c.payer_key].short_name} 277CA A1 · ICN ${c.icn}`, { claim_id: c.id }))
    }
    for (const payer of ['guardian', 'metlife', 'aetna', 'delta_ny'] as const) {
      this.s.remitsToReview += 1
      out.push(this.event('era_arrived', `${PAYER_REF[payer].short_name} 835 received`, { payer }))
    }
    for (const d of OVERNIGHT_DENIALS) {
      const c = this.s.claims.find((x) => x.number === d.number)
      if (!c || c.status === 'denied') continue
      c.status = 'denied'
      c.denial = { carc: d.carc, rarc: d.rarc, decoded: d.decoded, root_cause: d.root_cause }
      c.deadline = d.deadline
      c.reason_text = `${d.carc}${d.rarc ? ` · ${d.rarc}` : ''}`
      c.agent_note = d.item.tier === 3 ? 'appeal drafted · person signs' : d.root_cause === 'ours' ? 'held · root cause ours' : 'fix proposed'
      this.pushTimelineAt(c, at('2026-10-29', '05:40'), { lane: 'payer', title: `Denied ${c.reason_text} · ${d.decoded}` })
      this.addItem({ id: `itm_${d.number}`, kind: d.item.tier === 3 ? 'review_draft' : 'approve_action', claim: c, agent: d.item.agent, tier: d.item.tier, title: d.item.title, recommendation: d.item.recommendation, summary: d.item.summary, action: d.item.action, ruleId: d.item.rule_id, rootCause: d.root_cause, created: at('2026-10-29', '06:05'), requiredRole: d.item.required_role ?? null })
      out.push(this.event('claim_denied', `#${c.number} ${c.patient_name} denied ${c.reason_text}`, { claim_id: c.id, carc: d.carc, rarc: d.rarc }))
    }
    // Six paid on contract.
    const pinned = new Set([4705, 4512, 4744, 4709, 4731, 4796, 4797, 4800, 3561, ...STATUS_CHECK_CLAIMS.map((k) => k.number)])
    const paid = this.s.claims
      .filter((c) => c.status === 'pending' && !pinned.has(c.number) && !c.in_flight && ['delta_ny', 'metlife', 'aetna', 'guardian'].includes(c.payer_key))
      .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0) || a.number - b.number)
      .slice(0, OVERNIGHT_PAID_CENTS.length)
    for (const [i, c] of paid.entries()) {
      c.status = 'paid'
      c.allowed_cents = Math.round(c.billed_cents * 0.8)
      c.paid_cents = OVERNIGHT_PAID_CENTS[i] ?? Math.round(c.billed_cents * 0.76)
      c.remit_paid_cents = c.paid_cents
      c.agent_note = null
      this.pushTimelineAt(c, at('2026-10-29', '05:40'), { lane: 'payer', title: `835 paid on contract · ${PAYER_REF[c.payer_key].short_name}` })
      out.push(this.event('claim_paid', `#${c.number} paid`, { claim_id: c.id }))
    }
    return out
  }

  /**
   * Thu 07:00: day-30 status checks come due on #4690, #4764 (Delta) and #4760 (Cigna). The Status check rule is Ask, so
   * Follow-up proposes each one for Dana instead of calling the payer.
   */
  private phaseMorning(): EventFired[] {
    const out: EventFired[] = []
    for (const k of STATUS_CHECK_CLAIMS) {
      const c = this.s.claims.find((x) => x.number === k.number)
      if (!c) continue
      const payer = PAYER_REF[c.payer_key].short_name
      this.addItem({ id: `itm_${c.number}`, kind: 'approve_action', claim: c, agent: 'followup', tier: 1, title: `#${c.number} · ${c.patient_name} · ${payer} · status check due`, recommendation: `Check #${c.number} with ${payer} (portal, then IVR). The Status check rule is Ask, so nothing contacts the payer until you approve.`, summary: `Day ${c.age_days ?? 30} with no 835: the status-check cadence came due at 07:00.`, action: 'status_check', ruleId: 'rule_t1_status_check', rootCause: 'unknown', created: at('2026-10-29', '07:00') })
      out.push(this.event('run.followup', `#${c.number} status check due · proposed → Inbox`, { claim_id: c.id }))
    }
    return out
  }

  private pushTimelineAt(c: MockClaim, when: string, e: Pick<MockTimelineEntry, 'lane' | 'title'>) {
    c.timeline = [...c.timeline, { id: this.id('tl'), at: when, ...e }]
    c.last_activity = { at: when, label: e.title.slice(0, 40) }
  }

  private addItem(p: { id: string; kind: MockInboxItem['kind']; claim: MockClaim; agent: AgentKind; tier: Tier; title: string; recommendation: string; summary: string; action: NonNullable<MockInboxItem['proposed_action']>['action']; ruleId: string | null; rootCause: MockInboxItem['root_cause']; created: string; requiredRole?: Role | null; cents?: number }) {
    if (this.s.items.some((i) => i.id === p.id)) return
    const item: MockInboxItem = {
      id: p.id,
      kind: p.kind,
      state: 'open',
      claim_id: p.claim.id,
      agent: p.agent,
      rule_id: p.ruleId,
      title: p.title,
      summary: p.summary,
      recommendation: p.recommendation,
      plan_steps: [],
      confidence: null,
      evidence_ids: [],
      proposed_action: { action: p.action, params: {}, cents: p.cents ?? p.claim.billed_cents, requires_hold_window: false },
      tier: p.tier,
      cents: p.cents ?? p.claim.billed_cents,
      created_at: p.created,
      required_role: p.requiredRole ?? null,
      root_cause: p.rootCause,
      audit_note: p.rootCause === 'ours' ? 'root cause: ours — never learned into auto-run' : null,
    }
    this.s.items = [...this.s.items, item]
    this.s.week = [
      ...this.s.week,
      weekRow({ run_id: this.id('run'), at: p.created, agent: p.agent, action_kind: p.action, action: p.summary, subject: `#${p.claim.number} · ${p.claim.patient_name}`, claim_id: p.claim.id, outcome: 'Awaiting you', inbox_item_id: item.id, rule_id: p.ruleId, tier: p.tier, root_cause: p.rootCause, cents: item.cents, decision: true, ran: false }),
    ]
  }

  // ── Settings › Agents ──────────────────────────────────────────────────────
  private confidenceOf(r: Rule) {
    const { n, k } = r.base_rate ?? { n: 0, k: 0 }
    if (!n) return null
    const pct = n < 5 ? null : Math.round((100 * k) / n)
    return { pct, basis: pct === null ? 'no base rate' : `${k} of ${n}` }
  }

  rules(): RulesOut {
    const open = this.openItems()
    const decisions = this.decisions()
    const tiers = ([1, 2, 3] as const).map((tier) => ({
      tier,
      label: TIER_TEXT[tier].label,
      description: TIER_TEXT[tier].description,
      rows: this.s.rules
        .filter((r) => r.tier === tier)
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.id.localeCompare(b.id))
        .map((rule) => ({
          rule,
          ran_without_review_7d: decisions.filter((d) => d.rule_id === rule.id && d.ran).length,
          waiting: open.filter((i) => i.rule_id === rule.id).length,
          confidence: this.confidenceOf(rule),
          signed_by_name: nameOf(rule.signed_by),
          locked: tier === 3,
        })),
    }))
    return {
      tiers,
      practice_cap_cents: this.s.practiceCapCents,
      this_week: { total: decisions.length, ran: decisions.filter((d) => d.ran).length, to_you: decisions.filter((d) => !d.ran).length },
      changes_count: this.s.ruleChanges.length,
      proposals_open: this.s.proposals.filter((p) => p.state === 'open').length,
    }
  }

  ruleChanges() {
    const items = [...this.s.ruleChanges].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    return { items, total: items.length }
  }

  /** PATCH /rules/{id}: tier 3 is human only; a tier-2 change by anyone but the owner becomes a sign-off request. */
  patchRule(id: string, patch: RulePatch, user: UserId) {
    const rule = this.s.rules.find((r) => r.id === id)
    if (!rule) throw new MockError(404, 'not_found', `Rule ${id} not found`)
    const change: RulePatch = {}
    if (patch.mode !== undefined) change.mode = patch.mode
    if (patch.max_cents !== undefined) change.max_cents = patch.max_cents
    if (patch.confidence_floor !== undefined) change.confidence_floor = patch.confidence_floor
    if (Object.keys(change).length === 0) throw new MockError(422, 'empty_patch', 'Give mode, max_cents or confidence_floor.')
    if (rule.tier === 3) throw new MockError(403, 'human_only', 'Tier-3 rules are human-only; they cannot be changed.')
    if (!['owner', 'billing'].includes(USER_ROLE[user])) throw new MockError(403, 'forbidden', `${USER_NAME[user]} cannot change agent rules`)
    if (rule.tier === 2 && !isOwner(user)) {
      const item = this.requestSignoff(rule, change, user)
      this.changed()
      throw new MockError(409, 'owner_signoff_required', 'Tier-2 rules need Dr. Morgan’s signature; sent to her for sign-off.', { inbox_item_id: item.id, rule_id: rule.id })
    }
    const out = this.applyRuleChange(rule, change, user, rule.tier === 2)
    this.changed()
    return { ...out, meta: { counts: this.counts(user) } }
  }

  /** Apply, bump the version, log a RuleChange. Tier-2 edits drop the signature (and fall back to Ask) unless signed now. */
  private applyRuleChange(rule: Rule, change: RulePatch, user: UserId, sign: boolean): { rule: Rule; change: RuleChange } {
    const before = { mode: rule.mode, max_cents: rule.scope?.max_cents ?? null, confidence_floor: rule.confidence_floor ?? null, signed_by: rule.signed_by ?? null }
    const scope = { ...rule.scope }
    const next: Rule = { ...rule, scope }
    if (change.mode) next.mode = change.mode
    if (change.max_cents !== undefined) scope.max_cents = change.max_cents
    if (change.confidence_floor !== undefined) next.confidence_floor = change.confidence_floor
    if (next.tier === 2) {
      if (sign) {
        next.signed_by = user
        next.signed_at = this.s.now
      } else {
        next.signed_by = null
        next.signed_at = null
        if (next.mode === 'auto') next.mode = 'ask'
      }
    }
    const version = (next.version ?? 1) + 1
    next.version = version
    next.changed_by = user
    next.changed_at = this.s.now
    const after = { mode: next.mode, max_cents: scope.max_cents ?? null, confidence_floor: next.confidence_floor ?? null, signed_by: next.signed_by ?? null }
    const parts = (['mode', 'max_cents', 'confidence_floor'] as const).filter((k) => before[k] !== after[k]).map((k) => `${k}: ${String(before[k])} → ${String(after[k])}`)
    if (after.signed_by && after.signed_by !== before.signed_by) parts.push(`signed by ${after.signed_by}`)
    const rc: RuleChange = {
      id: `rch_${next.id}_${version}`,
      rule_id: next.id,
      at: this.s.now,
      by: user,
      before,
      after,
      items_affected_since: this.s.week.filter((r) => r.rule_id === next.id).length,
      summary: `${next.label} · ${parts.join(', ') || 'no change'}`,
    }
    this.s.rules = this.s.rules.map((r) => (r.id === next.id ? next : r))
    this.s.ruleChanges = [...this.s.ruleChanges, rc]
    return { rule: next, change: rc }
  }

  private requestSignoff(rule: Rule, change: RulePatch, user: UserId): MockInboxItem {
    const pending = this.openItems().find((i) => i.kind === 'owner_signoff' && i.rule_id === rule.id && JSON.stringify(i.proposed_action?.params?.change) === JSON.stringify(change))
    if (pending) return pending
    const preview = this.preview(rule.id, change.mode ?? rule.mode, change.max_cents ?? rule.scope?.max_cents ?? null)
    const item: MockInboxItem = {
      id: this.id('itm_signoff'),
      kind: 'owner_signoff',
      state: 'open',
      claim_id: null,
      agent: null,
      rule_id: rule.id,
      title: `Sign-off · ${rule.label}`,
      summary: `${USER_NAME[user]} asked to change a tier-2 rule: ${Object.entries(change).map(([k, v]) => `${k} → ${String(v)}`).join(', ')}`,
      recommendation: `This week, ${preview.would_run} of ${preview.total} decisions would have run without review (now ${preview.baseline_would_run}).`,
      plan_steps: [],
      confidence: null,
      evidence_ids: [],
      proposed_action: { action: rule.action, params: { change, requested_by: user }, cents: 0, requires_hold_window: false },
      tier: 2,
      cents: 0,
      created_at: this.s.now,
      assignee_user_id: 'usr_morgan',
      required_role: 'owner',
      root_cause: null,
      audit_note: null,
    }
    this.s.items = [...this.s.items, item]
    return item
  }

  /** GET /settings/preview: this week's decisions replayed with `rule_id` at (mode, max_cents) — API `preview_counts`. */
  preview(ruleId: string, mode?: RuleMode | null, maxCents?: number | null): Preview {
    const target = this.s.rules.find((r) => r.id === ruleId)
    if (!target) throw new MockError(404, 'not_found', `Rule ${ruleId} not found`)
    const m = mode ?? target.mode
    const cap = maxCents === undefined || maxCents === null ? (target.scope?.max_cents ?? null) : maxCents
    const decisions = this.decisions()
    const held: Record<string, number> = {}
    let count = 0
    for (const d of decisions) {
      let ok: boolean
      let reason: string | null = null
      if (d.rule_id !== ruleId) ok = d.ran
      else if (m !== 'auto' || target.tier === 3) ok = false
      else if (d.root_cause === 'ours') [ok, reason] = [false, 'ours']
      else if (cap !== null && d.cents > cap) [ok, reason] = [false, 'over_cap']
      else ok = true
      if (ok) count++
      if (reason) held[reason] = (held[reason] ?? 0) + 1
    }
    return { rule_id: ruleId, mode: m, max_cents: cap, would_run: count, total: decisions.length, baseline_would_run: decisions.filter((d) => d.ran).length, held_by_root_cause: held }
  }

  setPracticeCap(cents: number, user: UserId) {
    if (!isOwner(user)) throw new MockError(403, 'owner_only', 'Only Dr. Morgan sets the practice cap.')
    if (!Number.isInteger(cents) || cents < 0) throw new MockError(422, 'invalid_cap', 'The cap is a whole number of cents, zero or more.')
    this.s.practiceCapCents = cents
    this.changed()
    return { practice_cap_cents: cents, meta: { counts: this.counts(user) } }
  }

  proposals() {
    const items = [...this.s.proposals].sort(
      (a, b) => Number(a.state !== 'open') - Number(b.state !== 'open') || Number(a.root_cause_guard) - Number(b.root_cause_guard) || a.created_at.localeCompare(b.created_at),
    )
    return { items, total: items.length }
  }

  private openProposal(id: string): RuleProposal {
    const p = this.s.proposals.find((x) => x.id === id)
    if (!p) throw new MockError(404, 'not_found', `Proposal ${id} not found`)
    if (p.state !== 'open') throw new MockError(409, 'already_resolved', `proposal is ${p.state}`)
    return p
  }

  acceptProposal(id: string, user: UserId) {
    const proposal = this.openProposal(id)
    if (proposal.root_cause_guard) throw new MockError(422, 'root_cause_guard', 'Root cause is ours: fix the upstream rule. This slice can never run without review.')
    if (proposal.watching) throw new MockError(422, 'not_enough_evidence', 'Watching · n = 1: a proposal needs 20 resolved items before it can be accepted.')
    if (!['owner', 'billing'].includes(USER_ROLE[user])) throw new MockError(403, 'forbidden', `${USER_NAME[user]} cannot accept rule proposals`)
    const draft = proposal.rule_draft
    const base = this.s.rules.find((r) => r.id === draft.rule_id)
    if (!base) throw new MockError(422, 'no_base_rule', 'This proposal does not name a rule to learn from.')
    const scopeIn = (draft.scope ?? {}) as NonNullable<Rule['scope']>
    const scope = { payer_key: scopeIn.payer_key ?? null, item_type: scopeIn.item_type ?? 'all', max_cents: scopeIn.max_cents ?? null }
    const dollars = Math.round((scope.max_cents ?? 0) / 100)
    const rule: Rule = {
      ...base,
      id: `${base.id}_learned_${dollars}`,
      label: scope.max_cents ? `${base.label} · under $${dollars.toLocaleString('en-US')}` : base.label,
      version: 1,
      origin: 'learned',
      scope,
      mode: 'auto',
      confidence_floor: typeof draft.confidence_floor === 'number' ? draft.confidence_floor : 0.9,
      outcome_metric: (draft.outcome_metric as Rule['outcome_metric'] | undefined) ?? base.outcome_metric,
      signed_by: user,
      signed_at: this.s.now,
      changed_by: user,
      changed_at: this.s.now,
      description: `Learned from ${proposal.evidence.approved} of ${proposal.evidence.total} approvals; ${proposal.evidence.outcome_k} of ${proposal.evidence.outcome_n} paid within 30 d.`,
    }
    const accepted = { ...proposal, state: 'accepted' as const }
    this.s.proposals = this.s.proposals.map((p) => (p.id === id ? accepted : p))
    this.s.rules = [...this.s.rules.filter((r) => r.id !== rule.id), rule]
    this.s.ruleChanges = [...this.s.ruleChanges, { id: `rch_${rule.id}_1`, rule_id: rule.id, at: this.s.now, by: user, before: {}, after: { mode: 'auto', max_cents: scope.max_cents, origin: 'learned' }, items_affected_since: 0, summary: `Accepted proposal: ${proposal.title}` }]
    this.changed()
    return { proposal: accepted, rule, meta: { counts: this.counts(user) } }
  }

  dismissProposal(id: string, user: UserId) {
    const dismissed = { ...this.openProposal(id), state: 'dismissed' as const }
    this.s.proposals = this.s.proposals.map((p) => (p.id === id ? dismissed : p))
    this.changed()
    return { proposal: dismissed, meta: { counts: this.counts(user) } }
  }

  // ── static screens ─────────────────────────────────────────────────────────
  summary(c: MockClaim): ClaimSummary {
    const [first, ...rest] = c.patient_name.split(' ')
    return {
      id: c.id,
      number: c.number,
      status: c.status,
      needs_action: this.needsAction(c.id),
      patient: { id: c.patient_id, name: [first, ...rest].join(' '), display_name: c.patient_name, dob: c.patient.dob ?? null },
      payer: PAYER_REF[c.payer_key],
      dos: c.dos,
      procedures: c.procedures_label,
      billed_cents: c.billed_cents,
      allowed_cents: c.allowed_cents ?? null,
      paid_cents: c.paid_cents ?? null,
      icn: c.icn ?? null,
      reason: c.reason_text ?? null,
      in_flight: c.in_flight ?? null,
      age_days: c.age_days ?? null,
      file_time: c.queued_file?.at ?? (c.status === 'ready' && c.file_time ? at(c.built_at.slice(0, 10), c.file_time) : (c.sent_at ?? null)),
    }
  }

  /** GET /ledger/today — Today's claims, as the API's `ledger_today`. */
  ledger(): Ledger {
    const today = this.s.now.slice(0, 10)
    const agentText = new Set(this.s.week.filter((r) => r.action_kind === 'send_claim_agent_text').map((r) => r.claim_id))
    const row = (c: MockClaim): LedgerRow => {
      const fileAt = c.queued_file?.at ?? (c.status === 'ready' && c.file_time ? at(c.built_at.slice(0, 10), c.file_time) : (c.sent_at ?? null))
      const pending = Boolean(c.queued_file) || c.status === 'ready'
      const passed = c.readiness.filter((x) => x.status === 'pass' || x.status === 'na').length
      return {
        claim: this.summary(c),
        built_at: c.built_at,
        file_time: fileAt,
        editable_until: pending && fileAt ? plusMinutes(fileAt, -1) : null,
        ack_stage: c.ack_stage,
        acks: c.acks,
        checks_passed: c.readiness.length ? passed : 13,
        checks_total: c.readiness.length || 13,
        agent_text: agentText.has(c.id),
        note: c.reason_text ?? null,
      }
    }
    const held = (c: MockClaim): HeldRow => ({
      claim: this.summary(c),
      hold: c.hold as NonNullable<MockClaim['hold']>,
      timely_days_left: c.hold?.timely_due ? daysBetween(today, c.hold.timely_due) : null,
      owner_name: nameOf(c.hold?.owner_user_id),
    })
    const builtToday = this.s.claims.filter((c) => c.built_at.slice(0, 10) === today).sort((a, b) => a.built_at.localeCompare(b.built_at))
    const isLeaving = (c: MockClaim) => c.status === 'ready' || Boolean(c.queued_file)
    const sent = builtToday.filter((c) => !c.hold && !isLeaving(c))
    const leaving = [...builtToday.filter((c) => !c.hold && isLeaving(c)), ...this.s.claims.filter((c) => c.built_at.slice(0, 10) < today && !c.hold && c.queued_file?.at.slice(0, 10) === today)]
    const holds = this.s.claims.filter((c) => c.hold && !c.hold.cleared_at).map(held)
    holds.sort((a, b) => (a.timely_days_left ?? 1e6) - (b.timely_days_left ?? 1e6))
    const hhmm = this.s.now.slice(11, 16)
    const next = FILE_TIMES.find((t) => t > hhmm)
    const lastSent = sent.map((c) => c.sent_at ?? '').filter(Boolean).sort().at(-1)
    return {
      date: today,
      sent: sent.map(row),
      leaving_next_file: leaving.map(row),
      held: holds,
      not_billable: today === '2026-10-28' ? [{ patient: { id: 'pat_ortega_j', name: 'Javier Ortega', display_name: 'J. Ortega', dob: '1966-08-08' }, cdt: 'D4341', quadrant: 'UR', fee_cents: 24000, reason: 'no pocket depths charted for this quadrant · not billable (Torch never nudges documentation)' }] : [],
      next_file_time: next ? at(today, next) : null,
      last_file_time: lastSent ?? null,
    }
  }

  /** GET /eligibility?date — the next business day through +3 (or exactly `date`), as the API. */
  eligibility(date?: string | null): EligibilityOut {
    const today = this.s.now.slice(0, 10)
    const start = date ?? ELIGIBILITY.map((r) => r.start.slice(0, 10)).filter((d) => d > today).sort()[0] ?? today
    const span = date ? 0 : 3
    const open = new Set(this.openItems().map((i) => i.id))
    const rows = ELIGIBILITY.filter((r) => {
      const d = daysBetween(start, r.start.slice(0, 10))
      return d >= 0 && d <= span && r.start > this.s.now
    }).map((r) => ({ ...r, inbox_item_id: r.inbox_item_id && open.has(r.inbox_item_id) ? r.inbox_item_id : null }))
    return { date: start, rows, need_human: rows.filter((r) => r.inbox_item_id).length }
  }

  benefits(appointmentId: string): BenefitsPanel {
    const row = ELIGIBILITY.find((r) => r.appointment_id === appointmentId)
    if (!row) throw new MockError(404, 'not_found', `Appointment ${appointmentId} not found`)
    const panel = benefitsFor(row)
    const open = this.openItems().some((i) => i.id === panel.inbox_item_id)
    return { ...panel, inbox_item_id: open ? panel.inbox_item_id : null }
  }

  /** GET /cash (owner). A/R numbers are computed from the claims so Cash and the strip never disagree. */
  cash(user: UserId): CashSummary {
    if (!isOwner(user)) throw new MockError(403, 'owner_only', 'Cash is owner-only.')
    const ar = this.s.claims.filter((c) => AR.includes(c.status))
    const arCents = ar.reduce((a, c) => a + c.billed_cents, 0)
    const PATIENT_AR = 3_310_000
    const DAILY = 402_000
    const buckets: [string, number, number][] = [['0_30', 0, 30], ['31_60', 31, 60], ['61_90', 61, 90], ['90_plus', 91, 1e6]]
    const aging = buckets.map(([bucket, lo, hi]) => {
      const rows = ar.filter((c) => (c.age_days ?? 0) >= lo && (c.age_days ?? 0) <= hi)
      const cents = rows.reduce((a, c) => a + c.billed_cents, 0)
      return { bucket, cents, count: rows.length, pct: arCents ? Math.round((1000 * cents) / arCents) / 10 : 0 }
    })
    const payers = [...new Set(ar.map((c) => c.payer_key))]
    const by_payer = payers
      .map((k) => {
        const rows = ar.filter((c) => c.payer_key === k)
        return { key: k, label: PAYER_REF[k].short_name, cents: rows.reduce((a, c) => a + c.billed_cents, 0), count: rows.length }
      })
      .sort((a, b) => b.cents - a.cents)
    const paidOct = this.s.claims.filter((c) => c.status === 'paid')
    const insurancePaid = paidOct.reduce((a, c) => a + paidTileCents(c), 0)
    const patientCollections = CASH.kpis.find((k) => k.key === 'patient_collections_month')?.value ?? 0
    const days = Math.round((arCents + PATIENT_AR) / DAILY)
    const dollars = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`
    const kpis = CASH.kpis.map((k) => {
      if (k.key === 'days_in_ar') return { ...k, value: days, basis: `(${dollars(arCents)} + ${dollars(PATIENT_AR)}) ÷ ${dollars(DAILY)}/day` }
      if (k.key === 'insurance_ar') return { ...k, value: arCents, basis: `${ar.length} claims` }
      // Same rows and pricing as the strip's Paid tile, so Cash and the strip agree after the Thursday advance.
      if (k.key === 'insurance_collections_month') return { ...k, value: insurancePaid, basis: `${paidOct.length} claims paid` }
      if (k.key === 'collections_month') return { ...k, value: insurancePaid + patientCollections }
      return k
    })
    const ran = this.decisions().filter((d) => d.ran).length
    return {
      ...CASH,
      kpis,
      aging,
      by_payer,
      agent_impact: {
        items_auto: ran,
        items_to_you: this.decisions().filter((d) => !d.ran).length,
        hours_saved_est: { key: 'hours_saved', label: 'Hours saved (estimate)', value: Math.round((ran * 9) / 6) / 10, unit: 'count', formula: 'items run without review × 9 min', basis: 'estimate: median manual handling time from the 12-month approval log' },
      },
    }
  }

  /** GET /denials — denied claims grouped by next action (routing = the API's `route_denial`). */
  denials(user: UserId): DenialsOut {
    if (USER_ROLE[user] === 'front_desk') throw new MockError(403, 'forbidden', 'Denials are for billing, dentists and the owner.')
    const open = this.openItems()
    const groups = new Map<NextAction, DenialRow[]>()
    const inFlight: ClaimSummary[] = []
    for (const c of this.s.claims) {
      if (c.status !== 'denied' || !c.denial || c.closed_reason) continue
      if (c.in_flight) inFlight.push(this.summary(c))
      const route = routeDenial(c.denial.carc, c.denial.rarc, c.payer_key, SELF_FUNDED_CLAIMS.has(c.id))
      const signer = route.signer_role === 'rendering_dentist' ? (c.provider_name ?? 'the rendering dentist') : route.signer_role === 'owner' ? 'Dr. Morgan' : null
      const rows = groups.get(route.next_action) ?? []
      rows.push({
        claim: this.summary(c),
        carc: c.denial.carc,
        rarc: c.denial.rarc ?? null,
        decoded: c.denial.decoded,
        root_cause: c.denial.root_cause,
        next_action: route.next_action,
        agent: route.agent,
        signer,
        deadline: c.deadline ?? { kind: 'none', due_on: null, basis: '' },
        patient_billable_if_lost: patientBillableIfLost(c.denial.carc, c.payer_key),
        erisa: SELF_FUNDED_CLAIMS.has(c.id),
        checklist: route.checklist,
        inbox_item_id: open.find((i) => i.claim_id === c.id)?.id ?? null,
      })
      groups.set(route.next_action, rows)
    }
    const out: DenialGroup[] = NEXT_ACTION_ORDER.flatMap((k) => {
      const rows = (groups.get(k) ?? []).sort((a, b) => a.claim.number - b.claim.number)
      return rows.length ? [{ next_action: k, label: NEXT_ACTION_LABEL[k], count: rows.length, cents: rows.reduce((a, r) => a + r.claim.billed_cents, 0), rows }] : []
    })
    return { groups: out, total: out.reduce((a, g) => a + g.count, 0), in_flight: inFlight }
  }

  // ── run engine ─────────────────────────────────────────────────────────────
  private startRun(r: { agent: AgentKind; trigger: Run['trigger']; actor: UserId; inbox_item_id: string | null; claim_id: string | null; plan: RunPlan }): RunView {
    const id = this.id('run')
    const run: RunView = {
      idempotency_key: r.trigger === 'approval' && r.inbox_item_id ? `approval:${r.inbox_item_id}` : `${r.trigger}:${id}`,
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
      steps: r.plan.steps.map((st, idx) => newStep(idx, st.name)),
      action_label: '',
      result_summary: '',
      audit_line: '',
      outcome: '',
      evidence: [],
      last_event_id: null,
    }
    this.s.runs[id] = run
    this.s.runLog[id] = []
    this.plans.set(id, r.plan)
    this.fire('status', { run_id: id, agent: run.agent, status: run.status, claim_id: run.claim_id, planner: run.planner })
    if (!this.s.paused) this.scheduleNext(id)
    return run
  }

  /** After a reload, re-attach plans to unfinished runs and continue from the last ok step. */
  resumeRuns(): void {
    if (this.s.advance && !this.s.advance.done) this.scheduleAdvance()
    for (const run of Object.values(this.s.runs)) {
      if (run.id === 'run_bg_hill_rep' || ['succeeded', 'failed', 'cancelled', 'would_have_run'].includes(run.status)) continue
      const plan = this.rebuildPlan(run)
      if (!plan) continue
      this.plans.set(run.id, plan)
      if (run.status !== 'paused') this.scheduleNext(run.id)
    }
  }

  private rebuildPlan(run: RunView): RunPlan | null {
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

  private setRunStatus(run: RunView, status: Run['status']) {
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

  private completeStep(run: RunView, step: RunViewStep, sp: StepPlan | undefined) {
    step.status = 'ok'
    step.finished_at = this.s.now
    step.output_summary = sp?.output ?? ''
    step.policy_verdict = sp?.verdict ?? null
    if (sp?.evidence) {
      this.s.evidence[sp.evidence.id] = sp.evidence
      step.evidence_ids = [sp.evidence.id]
      run.evidence = [...run.evidence, EvidenceSchema.parse(sp.evidence)]
    }
    const evidence = sp?.evidence ? [{ id: sp.evidence.id, kind: sp.evidence.kind, title: sp.evidence.title }] : []
    this.emit(run.id, 'step', { run_id: run.id, idx: step.idx, name: step.name, label: step.label, phase: 'completed', status: 'ok', output_summary: step.output_summary, progress_lines: step.progress_lines, policy_verdict: step.policy_verdict, evidence_ids: step.evidence_ids, evidence, planner: run.planner, model_situation_label: run.model_situation_label })
    const situation = this.plans.get(run.id)?.situation
    if (step.name === 'decide' && situation) {
      run.model_situation_label = situation.label
      run.plan = { rationale: situation.rationale }
      this.emit(run.id, 'status', { status: run.status, planner: run.planner, model_situation_label: situation.label })
    }
  }

  private finishRun(run: RunView, plan: RunPlan) {
    plan.onDone(this, run)
    run.finished_at = this.s.now
    this.emit(run.id, 'counts', this.counts(USERS_BY_ID[run.actor ?? ''] ?? 'usr_dana'))
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
  private pushTimeline(claimId: string, e: Omit<MockTimelineEntry, 'id' | 'at'>) {
    const claim = this.s.claims.find((c) => c.id === claimId)
    if (!claim) return
    claim.timeline = [...claim.timeline, { id: this.id('tl'), at: this.s.now, ...e }]
    claim.last_activity = { at: this.s.now, label: e.title.slice(0, 40) }
  }

  /** An approval run (trigger approval): logged in Activity, not one of the week's decisions. */
  private addActivity(run: RunView, action: string, outcome: string, user: UserId | null) {
    const claim = this.s.claims.find((c) => c.id === run.claim_id)
    this.s.week = [
      ...this.s.week,
      weekRow({
        run_id: run.id,
        at: this.s.now,
        agent: run.agent,
        actor: user,
        action,
        action_kind: run.action ?? null,
        subject: claim ? `#${claim.number} · ${claim.patient_name}` : '—',
        claim_id: run.claim_id ?? null,
        outcome: user ? `${outcome} · approved by ${USER_NAME[user]}` : outcome,
        evidence_kinds: [...new Set(run.evidence.map((e) => e.kind))],
        audit_line: run.audit_line ?? '',
        tier: run.tier ?? null,
        decision: false,
      }),
    ]
  }

  private approvalPlan(item: MockInboxItem, user: UserId): RunPlan {
    const claim = this.s.claims.find((c) => c.id === item.claim_id)
    const action = item.proposed_action?.action ?? 'status_check'
    if (action === 'resubmit_with_attachment' && claim) {
      const tooth = item.proposed_action?.params?.tooth
      if (typeof tooth !== 'string') throw new MockError(422, 'invalid_params', `${item.id} names no tooth`)
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
          claim.attachments = [...claim.attachments, { id: db.id('att'), kind: 'pa', nea_number: nea, source: 'pms_imaging', created_at: db.now, note: `PA #${tooth} · uploaded via NEA` }]
          claim.in_flight = 'resubmit queued · leaves 11:15'
          claim.queued_file = { at: at(db.now.slice(0, 10), '11:15'), kind: 'resubmit' }
          claim.agent_note = 'resubmit queued · 11:15'
          db.pushTimeline(claim.id, { lane: 'agent', run_id: run.id, title: item.recommendation, detail: run.audit_line, evidence_ids: [neaEvidence.id] })
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
        run.audit_line = `${action.replace(/_/g, ' ')} on ${claim ? `#${claim.number}` : (db.patientOf(item)?.display_name ?? item.id)} · approved by ${USER_NAME[user]} · tier ${item.tier ?? '—'}`
        if (claim) db.pushTimeline(claim.id, { lane: 'agent', run_id: run.id, title: run.audit_line })
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
              id: `itm_${claim.number}`,
              kind: 'approve_action',
              state: 'open',
              claim_id: claim.id,
              agent: 'followup',
              title: `#${claim.number} · ${claim.patient_name} · MetLife asks for #14 history`,
              recommendation: 'Send a records request via NEA with the 2019-03-02 extraction note for #14; answer: replacement prosthesis, extraction 03/02/2019.',
              summary: 'Pended for information (no CARC). The agent read the correspondence and found the 2019 extraction note.',
              confidence: null,
              evidence_ids: [portal.id, note.id],
              proposed_action: { action: 'records_request', params: { note_visit_ids: ['VIS-2019-0302-14'] }, cents: claim.billed_cents, requires_hold_window: false },
              plan_steps: ['Upload the 2019-03-02 note via NEA', 'Reply to the correspondence citing the NEA#'],
              tier: 1,
              created_at: db.now,
              cents: claim.billed_cents,
              audit_note: 'unknown situation — proposals from an unknown triage never run without review',
              root_cause: 'unknown',
              run_id: run.id,
            },
          ]
          db.pushTimeline(claim.id, { lane: 'agent', run_id: run.id, title: 'Triage: payer asks for missing-tooth history → records request proposed', evidence_ids: [portal.id, note.id] })
          db.s.week = [
            ...db.s.week,
            weekRow({
              run_id: run.id,
              at: db.now,
              agent: 'followup',
              actor: run.actor ?? null,
              action_kind: 'records_request',
              action: 'Triage: payer asks for missing-tooth history → records request proposed (never runs without review).',
              subject: `#${claim.number} · ${claim.patient_name}`,
              claim_id: claim.id,
              outcome: 'Awaiting you',
              inbox_item_id: `itm_${claim.number}`,
              tier: 1,
              root_cause: 'unknown',
              cents: claim.billed_cents,
              evidence_kinds: ['portal_screenshot', 'note_excerpt'],
              audit_line: run.audit_line ?? '',
              decision: true,
              ran: false,
            }),
          ]
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
        db.pushTimeline(claim.id, { lane: 'agent', run_id: run.id, title: run.audit_line })
      },
    }
  }

  /** Test hook: mark an item's payer file as departed so approve returns 409 file_departed. */
  departFile(itemId: string, leftAt: string) {
    this.s.items = this.s.items.map((i) => (i.id === itemId && i.proposed_action ? { ...i, proposed_action: { ...i.proposed_action, params: { ...i.proposed_action.params, file_departed_at: leftAt } } } : i))
  }
}
