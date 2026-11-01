/**
 * Wire contract (Zod) — hand-written mirror of the API's Pydantic models (apps/api/torch/api/schemas.py,
 * apps/api/openapi.snapshot.json).
 *
 * `pnpm gen:api` will write src/api/generated.ts from the snapshot and this file should then re-export from it.
 * Until then: snake_case field names, integer cents, enums verbatim from the domain model.
 *
 * Reconciled with openapi.snapshot.json (web-s2): Strip, AgentsStatus, the clock advance, and every
 * Settings / static-screen shape (rules, changes, proposals, preview, ledger, activity, eligibility,
 * benefits, cash, denials). Still the S1 hand-written shapes, NOT yet the API's: InboxItem / InboxList,
 * ClaimRow, ClaimDetail, Run (the API wraps GET /runs/{id} as RunDetail {run, evidence, last_event_id}) —
 * see docs/plans/web-s2.md §3. Fields the UI needs that the API does not send are marked `// assumed`.
 */
import { z } from 'zod'

// ── Enums (verbatim) ─────────────────────────────────────────────────────────
export const ClaimStatus = z.enum(['ready', 'sent', 'rejected', 'accepted', 'pending', 'denied', 'partial', 'paid', 'appealed'])
export type ClaimStatus = z.infer<typeof ClaimStatus>
export const CLAIM_STATUSES = ClaimStatus.options

export const AckStage = z.enum([
  'none',
  'file_999_ok',
  'file_999_reject',
  'ch_277ca_a1',
  'ch_277ca_a7',
  'payer_277ca_a1',
  'payer_277ca_a7',
])
export type AckStage = z.infer<typeof AckStage>

export const Tier = z.union([z.literal(1), z.literal(2), z.literal(3)])
export type Tier = z.infer<typeof Tier>

export const RuleMode = z.enum(['observe', 'ask', 'auto', 'human_only'])
export type RuleMode = z.infer<typeof RuleMode>

export const Tier1Action = z.enum([
  'status_check',
  'records_request',
  'resubmit_with_attachment',
  'reprocessing_request',
  'request_835',
  'send_claim_pms_codes',
  'fix_demographics_resend',
  'eligibility_check',
  'payer_rep_call', // 07-agents §10.4 addition
])
export const Tier2Action = z.enum([
  'post_era_line',
  'update_pms_benefits',
  'send_claim_agent_text',
  'corrected_claim',
  'patient_transfer',
  'send_statement',
  'mechanical_refund',
  'cob_order_change',
])
export const Tier3Action = z.enum([
  'write_off',
  'formal_appeal',
  'void_claim',
  'discretionary_refund',
  'collections_referral',
  'waiver',
])
export const ActionKind = z.union([Tier1Action, Tier2Action, Tier3Action, z.literal('hold_claim')])
export type ActionKind = z.infer<typeof ActionKind>

export const InboxItemKind = z.enum([
  'approve_action',
  'review_draft',
  'eligibility_flag',
  'variance',
  'run_failed',
  'rule_proposal',
  'owner_signoff',
])
export type InboxItemKind = z.infer<typeof InboxItemKind>

export const InboxItemState = z.enum(['open', 'approved', 'edited', 'rejected', 'snoozed', 'expired', 'done'])
export type InboxItemState = z.infer<typeof InboxItemState>

export const RunStatus = z.enum(['queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'would_have_run'])
export type RunStatus = z.infer<typeof RunStatus>
export const RunStepStatus = z.enum(['pending', 'running', 'ok', 'failed', 'skipped'])
export type RunStepStatus = z.infer<typeof RunStepStatus>

export const AgentMode = z.enum(['deterministic', 'live'])
export type AgentMode = z.infer<typeof AgentMode>
export const PlannerKind = z.enum(['live', 'scripted', 'recorded_plan', 'scripted_fallback'])
export type PlannerKind = z.infer<typeof PlannerKind>
export const PolicyVerdict = z.enum(['observe', 'propose', 'execute', 'refuse', 'park'])
export type PolicyVerdict = z.infer<typeof PolicyVerdict>

export const AgentKind = z.enum(['eligibility', 'claims', 'followup', 'appeals', 'posting'])
export type AgentKind = z.infer<typeof AgentKind>
export const RootCause = z.enum(['ours', 'payer', 'patient', 'unknown'])
export type RootCause = z.infer<typeof RootCause>
export const DeadlineKind = z.enum(['timely_filing', 'appeal', 'none'])
export const EvidenceKind = z.enum([
  'portal_screenshot',
  'ivr_transcript',
  'rep_call',
  'era_line',
  'eob_pdf',
  'pms_record',
  'nea_attachment',
  'policy_clause',
  'prior_eob',
  'note_excerpt',
])
export type EvidenceKind = z.infer<typeof EvidenceKind>
export const PayerKey = z.enum(['delta_ny', 'metlife', 'cigna', 'aetna', 'guardian', 'ny_medicaid'])
export type PayerKey = z.infer<typeof PayerKey>
export const Role = z.enum(['owner', 'billing', 'dentist', 'front_desk'])
export type Role = z.infer<typeof Role>
export const ReadinessKey = z.enum([
  'note_signed',
  'procs_match_note',
  'fee_schedule',
  'subscriber_id_format',
  'eligibility_fresh',
  'remaining_max',
  'frequency',
  'tooth_validity',
  'attachment_rule',
  'narrative',
  'cob_order',
  'duplicate',
  'timely_filing',
])
export const CheckStatus = z.enum(['pass', 'warn', 'fail', 'na'])
export type CheckStatus = z.infer<typeof CheckStatus>
export const AttachmentKind = z.enum(['pa', 'bwx', 'fmx', 'perio_chart', 'narrative', 'eob'])
export const AdjGroup = z.enum(['CO', 'PR', 'OA'])

const Cents = z.number().int()
const IsoDateTime = z.string() // ISO-8601 with offset; formatted in lib/format.ts
const IsoDate = z.string() // YYYY-MM-DD

// ── Shared ───────────────────────────────────────────────────────────────────
export const StripTile = z.object({
  status: ClaimStatus,
  count: z.number().int(),
  cents: Cents,
  flagged: z.number().int(),
  cents_basis: z.enum(['billed', 'paid']).nullish(), // api-core D5: Paid tiles carry insurance paid
  label: z.string().nullish(), // the API sends it; the UI labels tiles from STATUS_LABEL
})
export type StripTile = z.infer<typeof StripTile>

/** GET /summary/strip and every mutation's `meta.counts`. */
export const StripSummary = z.object({
  tiles: z.array(StripTile),
  /** The viewer's open queue (shared items + items assigned to them), so it differs per user. */
  inbox_open: z.number().int(),
  inbox_open_cents: Cents,
  paid_month_cents: Cents,
  paid_month_count: z.number().int(),
  open_count: z.number().int(),
  open_cents: Cents,
  ar_count: z.number().int(),
  ar_cents: Cents,
  flagged_count: z.number().int(),
  flagged_cents: Cents,
  as_of: IsoDateTime,
  paid_month_label: z.string().nullish(), // assumed, e.g. "Oct" (not in the API; the UI falls back to "month")
  nav_badges: z.record(z.string(), z.number().int()).nullish(), // assumed: {payments, eligibility, activity}
})
export type StripSummary = z.infer<typeof StripSummary>

export const MutationMeta = z.object({ counts: StripSummary.nullish() }).passthrough()

export const Evidence = z.object({
  id: z.string(),
  kind: EvidenceKind,
  title: z.string(),
  excerpt: z.string(),
  uri: z.string().nullish(),
  captured_at: IsoDateTime,
  reference: z.string().nullish(),
  suspicious: z.boolean().nullish(),
  gathered_by: z.enum(['agent', 'code']).nullish(),
})
export type Evidence = z.infer<typeof Evidence>

/** `pct: null` = no base rate yet (n < 5): the UI says so instead of inventing a number. */
export const Confidence = z.object({ pct: z.number().nullable(), basis: z.string() })

export const ProposedAction = z.object({
  action: ActionKind,
  params: z.record(z.string(), z.unknown()).default({}),
  cents: Cents.default(0),
  requires_hold_window: z.boolean().default(false),
})
export type ProposedAction = z.infer<typeof ProposedAction>

// ── Claims ───────────────────────────────────────────────────────────────────
export const Denial = z.object({ carc: z.string(), rarc: z.string().nullish(), decoded: z.string(), root_cause: RootCause })
export const Deadline = z.object({ kind: DeadlineKind, due_on: IsoDate.nullish(), basis: z.string() })
export type Denial = z.infer<typeof Denial>
export type Deadline = z.infer<typeof Deadline>
export const ReadinessCheck = z.object({ key: ReadinessKey, status: CheckStatus, detail: z.string() })
export type ReadinessCheck = z.infer<typeof ReadinessCheck>

export const Claim = z.object({
  id: z.string(),
  number: z.number().int(),
  visit_id: z.string(),
  patient_id: z.string(),
  coverage_id: z.string(),
  payer_key: PayerKey,
  provider_id: z.string().nullish(),
  location_id: z.string().nullish(),
  status: ClaimStatus,
  needs_action: z.boolean(),
  dos: IsoDate,
  built_at: IsoDateTime,
  sent_at: IsoDateTime.nullish(),
  file_time: z.string().nullish(),
  icn: z.string().nullish(),
  ack_stage: AckStage,
  billed_cents: Cents,
  allowed_cents: Cents.nullish(),
  paid_cents: Cents.nullish(),
  writeoff_cents: Cents.nullish(),
  patient_resp_cents: Cents.nullish(),
  paid_at: IsoDateTime.nullish(),
  denial: Denial.nullish(),
  deadline: Deadline.nullish(),
  parent_claim_id: z.string().nullish(),
  frequency_code: z.union([z.literal(1), z.literal(7), z.literal(8)]).nullish(),
  readiness: z.array(ReadinessCheck).default([]),
  timely_filing_due: IsoDate.nullish(),
  in_flight: z.string().nullish(), // e.g. "resubmit queued · leaves 11:15"
  reason_text: z.string().nullish(), // CARC·RARC or reject reason shown in tables
  closed_reason: z.string().nullish(),
})
export type Claim = z.infer<typeof Claim>

/** A row of GET /claims. Claim plus the denormalised labels the table shows. */
export const ClaimRow = Claim.pick({
  id: true,
  number: true,
  patient_id: true,
  payer_key: true,
  status: true,
  needs_action: true,
  dos: true,
  billed_cents: true,
  denial: true,
  reason_text: true,
  in_flight: true,
}).extend({
  patient_name: z.string(), // assumed
  provider_name: z.string().nullish(), // assumed
  procedures_label: z.string().nullish(), // assumed, e.g. "D2740 #30 +2"
  age_days: z.number().int().nullish(), // assumed: days since sent
  agent_chip: z.object({ agent: AgentKind, label: z.string() }).nullish(), // assumed
  last_activity: z.object({ at: IsoDateTime, label: z.string() }).nullish(), // assumed
})
export type ClaimRow = z.infer<typeof ClaimRow>

export const ClaimLine = z.object({
  id: z.string(),
  claim_id: z.string().nullish(),
  cdt: z.string(),
  description: z.string().nullish(), // assumed
  tooth: z.string().nullish(),
  surface: z.string().nullish(),
  fee_cents: Cents,
  allowed_cents: Cents.nullish(),
  paid_cents: Cents.nullish(),
  adj: z.array(z.object({ group: AdjGroup, code: z.string(), cents: Cents })).default([]),
  patient_adj: z.array(z.object({ group: AdjGroup, code: z.string(), cents: Cents })).default([]),
  patient_cents: Cents.nullish(),
})
export type ClaimLine = z.infer<typeof ClaimLine>

export const Attachment = z.object({
  id: z.string(),
  claim_id: z.string().nullish(),
  kind: AttachmentKind,
  nea_number: z.string().nullish(),
  source: z.enum(['pms_imaging', 'agent', 'user']),
  image_id: z.string().nullish(),
  created_at: IsoDateTime,
  note: z.string().nullish(),
})
export type Attachment = z.infer<typeof Attachment>

export const AckEvent = z.object({
  id: z.string(),
  claim_id: z.string(),
  stage: AckStage,
  code: z.string().nullish(),
  message: z.string(),
  at: IsoDateTime,
  source: z.string().nullish(),
})
export type AckEvent = z.infer<typeof AckEvent>

/** Merged Runs / RunSteps / AuditEvents / AckEvents / human actions, newest last. */
export const TimelineEntry = z.object({
  id: z.string(),
  at: IsoDateTime,
  lane: z.enum(['agent', 'payer', 'human', 'system']), // assumed lane names
  title: z.string(),
  detail: z.string().nullish(),
  agent: AgentKind.nullish(),
  actor: z.string().nullish(),
  run_id: z.string().nullish(),
  tier: Tier.nullish(),
  root_cause: RootCause.nullish(),
  evidence: z.array(Evidence).default([]),
})
export type TimelineEntry = z.infer<typeof TimelineEntry>

// ── Inbox ────────────────────────────────────────────────────────────────────
export const InboxItem = z.object({
  id: z.string(),
  kind: InboxItemKind,
  state: InboxItemState,
  claim_id: z.string().nullish(),
  patient_id: z.string().nullish(),
  appointment_id: z.string().nullish(),
  remittance_id: z.string().nullish(),
  rule_id: z.string().nullish(),
  agent: AgentKind.nullish(),
  title: z.string(),
  summary: z.string().nullish(),
  recommendation: z.string(),
  plan_steps: z.array(z.string()).default([]),
  confidence: Confidence.nullish(),
  evidence: z.array(z.string()).default([]), // Evidence ids (hydrated on GET /inbox/{id})
  proposed_action: ProposedAction.nullish(),
  tier: Tier.nullish(),
  group_key: z.string().nullish(),
  group_title: z.string().nullish(),
  cents: Cents.default(0),
  deadline_on: IsoDate.nullish(),
  audit_note: z.string().nullish(),
  assignee_user_id: z.string().nullish(),
  required_role: Role.nullish(),
  created_at: IsoDateTime,
  snoozed_until: IsoDateTime.nullish(),
  resolved_by: z.string().nullish(),
  resolved_at: IsoDateTime.nullish(),
  resolution_note: z.string().nullish(),
  run_id: z.string().nullish(),
  // assumed denormalisations for the list row and detail header (degrade to `title` when absent)
  subject: z
    .object({
      claim_number: z.number().int().nullish(),
      patient_name: z.string().nullish(),
      payer_key: PayerKey.nullish(),
      label: z.string().nullish(),
    })
    .nullish(),
  root_cause: RootCause.nullish(),
  reversibility: z.object({ editable_until: z.string().nullish(), then: z.string().nullish() }).nullish(),
})
export type InboxItem = z.infer<typeof InboxItem>

export const InboxGroup = z.object({
  group_key: z.string(),
  title: z.string(),
  count: z.number().int(),
  cents: Cents,
  item_ids: z.array(z.string()),
  summary: z.string().nullish(), // assumed
})
export type InboxGroup = z.infer<typeof InboxGroup>

/** GET /inbox?group=true. Assumed: `items` holds every matching item; `groups` reference them by id. */
export const InboxList = z.object({
  items: z.array(InboxItem),
  total: z.number().int(),
  next_cursor: z.string().nullish(),
  groups: z.array(InboxGroup).default([]),
  facets: z.object({ kind: z.record(z.string(), z.number().int()) }).partial().nullish(), // assumed, optional
})
export type InboxList = z.infer<typeof InboxList>

export const InboxItemDetail = InboxItem.extend({
  evidence: z.array(Evidence),
  claim: ClaimRow.nullish(), // S1 shape; the API sends ClaimSummary (see the header note)
})
export type InboxItemDetail = z.infer<typeof InboxItemDetail>

export const ClaimDetail = Claim.extend({
  patient: z.object({ id: z.string(), name: z.string(), dob: IsoDate.nullish() }), // assumed
  provider_name: z.string().nullish(), // assumed
  plan_label: z.string().nullish(), // assumed, e.g. "Delta Dental PPO"
  age_days: z.number().int().nullish(), // assumed
  lines: z.array(ClaimLine),
  attachments: z.array(Attachment),
  acks: z.array(AckEvent),
  timeline: z.array(TimelineEntry),
  open_inbox_items: z.array(InboxItem),
})
export type ClaimDetail = z.infer<typeof ClaimDetail>

// ── Runs ─────────────────────────────────────────────────────────────────────
export const RunStep = z.object({
  idx: z.number().int(),
  name: z.string(),
  status: RunStepStatus,
  started_at: IsoDateTime.nullish(),
  finished_at: IsoDateTime.nullish(),
  tool: z.string().nullish(),
  input_summary: z.string().nullish(),
  output_summary: z.string().nullish(),
  progress_lines: z.array(z.string()).default([]),
  policy_verdict: PolicyVerdict.nullish(),
  evidence_ids: z.array(z.string()).default([]),
  label: z.string().nullish(), // display label from the recipe; falls back to the name
})
export type RunStep = z.infer<typeof RunStep>

export const Run = z.object({
  id: z.string(),
  agent: AgentKind,
  trigger: z.enum(['rule', 'approval', 'schedule', 'manual']),
  actor: z.string().nullish(),
  parent_run_id: z.string().nullish(),
  rule_id: z.string().nullish(),
  inbox_item_id: z.string().nullish(),
  claim_id: z.string().nullish(),
  status: RunStatus,
  mode: AgentMode.nullish(),
  planner: PlannerKind.nullish(),
  situation_key: z.string().nullish(),
  model_situation_label: z.string().nullish(),
  plan: z.object({ rationale: z.string().nullish() }).passthrough().nullish(),
  action: ActionKind.nullish(),
  action_label: z.string().nullish(),
  tier: Tier.nullish(),
  verdict: PolicyVerdict.nullish(),
  outcome: z.string().nullish(),
  started_at: IsoDateTime.nullish(),
  finished_at: IsoDateTime.nullish(),
  steps: z.array(RunStep),
  result_summary: z.string().nullish(),
  audit_line: z.string().nullish(),
  evidence: z.array(Evidence).default([]),
  last_event_id: z.number().int().nullish(), // assumed: snapshot cursor for Last-Event-ID
})
export type Run = z.infer<typeof Run>

/** SSE payloads of GET /runs/{id}/events. */
export const RunStepEvent = z.object({
  idx: z.number().int(),
  name: z.string(),
  phase: z.enum(['started', 'progress', 'completed', 'failed']).nullish(),
  status: RunStepStatus,
  output_summary: z.string().nullish(),
  progress_line: z.string().nullish(),
  policy_verdict: PolicyVerdict.nullish(), // assumed to ride along on `decide`
  evidence: Evidence.nullish(),
})
export type RunStepEvent = z.infer<typeof RunStepEvent>
export const RunStatusEvent = z.object({
  status: RunStatus,
  model_situation_label: z.string().nullish(), // assumed: decide may publish the label/planner with status
  planner: PlannerKind.nullish(),
})
export const RunDoneEvent = z
  .object({ status: RunStatus.nullish(), audit_line: z.string().nullish(), result_summary: z.string().nullish() })
  .passthrough()

/** SSE payloads of GET /runs/stream (firehose). */
export const FirehoseRunEvent = z.object({
  run_id: z.string(),
  agent: AgentKind.nullish(),
  status: RunStatus,
  claim_id: z.string().nullish(),
})
export const FirehoseAgentsEvent = z.object({ paused: z.boolean(), by: z.string().nullish(), at: IsoDateTime.nullish() })

/** One scheduler event of an advance (`EventFired`): "file_departed", "claim_denied", "era_arrived", … */
export const EventFired = z.object({
  at: IsoDateTime,
  kind: z.string(),
  summary: z.string(),
  job_id: z.string().default(''),
  data: z.record(z.string(), z.unknown()).default({}),
})
export type EventFired = z.infer<typeof EventFired>

/**
 * Both `event: advance` on the firehose and GET /clock/advance/{id} (`AdvanceOut`) land in ['advance', id].
 * The firehose sends `events_fired` as a count while running and the full list on `done`; the poll always
 * sends the list plus `state`/`from`/`to`/`error` and, once finished, `meta.counts`.
 */
export const AdvanceSnapshot = z.object({
  advance_id: z.string(),
  now: IsoDateTime,
  state: z.enum(['running', 'done', 'failed']).nullish(),
  from: IsoDateTime.nullish(),
  to: IsoDateTime.nullish(),
  events_fired: z.union([z.number().int(), z.array(EventFired)]),
  runs_started: z.number().int().nullish(),
  live_runs: z.number().int().nullish(),
  skipped_unhandled: z.record(z.string(), z.number().int()).nullish(),
  done: z.boolean(),
  error: z.string().nullish(),
})
export type AdvanceSnapshot = z.infer<typeof AdvanceSnapshot>

/** GET /agents/status — the sidebar "5 agents · 1 running" and the paused chip. */
export const AgentsStatus = z.object({
  paused: z.boolean(),
  paused_by: z.string().nullish(),
  paused_at: IsoDateTime.nullish(),
  mode: AgentMode,
  live_agents: z.array(AgentKind).default([]),
  agents: z.number().int().nullish(), // the API sends 5; the indicator falls back to the enum size
  running: z.number().int(),
  queued: z.number().int(),
  paused_runs: z.number().int().default(0),
})
export type AgentsStatus = z.infer<typeof AgentsStatus>

// ── Mutations ────────────────────────────────────────────────────────────────
/** `run` is null when approving starts no run (owner sign-off of a rule change, eligibility flag → front desk). */
export const ApproveResponse = z.object({ item: InboxItem, run: Run.nullable(), meta: MutationMeta.nullish() })
export const ApproveGroupResponse = z.object({ items: z.array(InboxItem), runs: z.array(Run), meta: MutationMeta.nullish() })
export const ItemResponse = z.object({ item: InboxItem, meta: MutationMeta.nullish() })

export const CorrectedClaimResponse = z.object({ claim: Claim, item: InboxItem.nullish(), meta: MutationMeta.nullish() })

export const SavedView = z.object({
  id: z.string(),
  name: z.string(),
  search_params: z.record(z.string(), z.unknown()),
  owner_user_id: z.string().nullish(),
  builtin: z.boolean().nullish(),
})
export type SavedView = z.infer<typeof SavedView>

export const Clock = z.object({
  now: IsoDateTime,
  frozen: z.boolean(),
  advancing: z.object({ advance_id: z.string(), to: IsoDateTime }).nullish(),
})
export type Clock = z.infer<typeof Clock>
/** POST /clock/advance → 202; progress arrives as `event: advance` on /runs/stream. */
export const ClockAdvanceAccepted = z.object({ advance_id: z.string(), from: IsoDateTime, to: IsoDateTime })
export const TriageAccepted = z.object({ run: Run, meta: MutationMeta.nullish() })

export const WorldStatus = z.object({
  outages: z.array(z.object({ system: z.string(), since: IsoDateTime, message: z.string() })),
}) // assumed: GET /_world/status

// ── Shared references (API: PatientRef, PayerRef, ClaimSummary) ─────────────────
export const PatientRef = z.object({ id: z.string(), name: z.string(), display_name: z.string(), dob: IsoDate.nullish() })
export type PatientRef = z.infer<typeof PatientRef>
export const PayerRef = z.object({ key: PayerKey, name: z.string(), short_name: z.string() })
export type PayerRef = z.infer<typeof PayerRef>

/** The claim as the static screens and the Denials worklist reference it (API `ClaimSummary`). */
export const ClaimSummary = z.object({
  id: z.string(),
  number: z.number().int(),
  status: ClaimStatus,
  needs_action: z.boolean(),
  patient: PatientRef,
  payer: PayerRef,
  dos: IsoDate,
  procedures: z.string(),
  billed_cents: Cents,
  allowed_cents: Cents.nullish(),
  paid_cents: Cents.nullish(),
  icn: z.string().nullish(),
  reason: z.string().nullish(),
  in_flight: z.string().nullish(),
  age_days: z.number().int().nullish(),
  file_time: IsoDateTime.nullish(),
})
export type ClaimSummary = z.infer<typeof ClaimSummary>

// ── Settings › Agents ────────────────────────────────────────────────────────
export const OutcomeMetric = z.enum(['paid_30d', 'accepted', 'balanced', 'none'])
export type OutcomeMetric = z.infer<typeof OutcomeMetric>
export const ReversesIn = z.enum(['until_file_leaves', 'until_day_close', 'void_only', 'none'])
export type ReversesIn = z.infer<typeof ReversesIn>
export const RuleScope = z.object({ payer_key: PayerKey.nullish(), item_type: z.string().default('all'), max_cents: Cents.nullish() })
export type RuleScope = z.infer<typeof RuleScope>
export const BaseRate = z.object({ n: z.number().int(), k: z.number().int() })

export const Rule = z.object({
  id: z.string(),
  label: z.string(),
  version: z.number().int().default(1),
  origin: z.enum(['authored', 'learned']).default('authored'),
  tier: Tier,
  agent: AgentKind,
  action: ActionKind,
  scope: RuleScope.default({}),
  mode: RuleMode,
  confidence_floor: z.number().nullish(),
  outcome_metric: OutcomeMetric.default('none'),
  reverses_in: ReversesIn.default('none'),
  requires_owner_signoff: z.boolean().default(false),
  signed_by: z.string().nullish(),
  signed_at: IsoDateTime.nullish(),
  changed_by: z.string(),
  changed_at: IsoDateTime,
  base_rate: BaseRate.default({ n: 0, k: 0 }),
  sort: z.number().int().default(0),
  description: z.string().default(''),
})
export type Rule = z.infer<typeof Rule>

/** One row of the rules table: the rule plus what the server counted for it this week. */
export const RuleRow = z.object({
  rule: Rule,
  ran_without_review_7d: z.number().int(),
  waiting: z.number().int(),
  confidence: Confidence.nullish(),
  signed_by_name: z.string().nullish(),
  locked: z.boolean(),
})
export type RuleRow = z.infer<typeof RuleRow>
export const TierGroup = z.object({ tier: Tier, label: z.string(), description: z.string(), rows: z.array(RuleRow) })
export type TierGroup = z.infer<typeof TierGroup>

/** GET /rules */
export const RulesOut = z.object({
  tiers: z.array(TierGroup),
  practice_cap_cents: Cents,
  this_week: z.object({ total: z.number().int(), ran: z.number().int(), to_you: z.number().int() }),
  changes_count: z.number().int(),
  proposals_open: z.number().int(),
})
export type RulesOut = z.infer<typeof RulesOut>

/** PATCH /rules/{id} body. Tier 2 by a non-owner → 409 owner_signoff_required {inbox_item_id, rule_id}; tier 3 → 403 human_only. */
export interface RulePatch {
  mode?: RuleMode
  max_cents?: number
  confidence_floor?: number
}

export const RuleChange = z.object({
  id: z.string(),
  rule_id: z.string(),
  at: IsoDateTime,
  by: z.string(),
  before: z.record(z.string(), z.unknown()),
  after: z.record(z.string(), z.unknown()),
  items_affected_since: z.number().int().default(0),
  summary: z.string().default(''),
})
export type RuleChange = z.infer<typeof RuleChange>
export const RuleChangeList = z.object({ items: z.array(RuleChange), total: z.number().int() })
export const RulePatchResponse = z.object({ rule: Rule, change: RuleChange, meta: MutationMeta.nullish() })

/**
 * GET /settings/preview?rule_id&mode&max_cents — this week's decisions replayed under the change.
 * `would_run` is net of holds; "by scope" = would_run + Σ held_by_root_cause (e.g. `{ours: 3}`).
 */
export const Preview = z.object({
  rule_id: z.string(),
  mode: RuleMode,
  max_cents: Cents.nullable(),
  would_run: z.number().int(),
  total: z.number().int(),
  baseline_would_run: z.number().int(),
  held_by_root_cause: z.record(z.string(), z.number().int()),
})
export type Preview = z.infer<typeof Preview>

export const RuleProposal = z.object({
  id: z.string(),
  title: z.string(),
  rule_draft: z.record(z.string(), z.unknown()),
  evidence: z.object({ approved: z.number().int(), total: z.number().int(), outcome_k: z.number().int(), outcome_n: z.number().int() }),
  root_cause_guard: z.boolean(),
  state: z.enum(['open', 'accepted', 'dismissed']),
  created_at: IsoDateTime,
  watching: z.boolean().default(false),
  source_item_id: z.string().nullish(),
  note: z.string().default(''),
})
export type RuleProposal = z.infer<typeof RuleProposal>
export const ProposalList = z.object({ items: z.array(RuleProposal), total: z.number().int() })
/** POST /proposals/{id}:accept|dismiss and POST /inbox/{id}:always-auto-run. Accept returns the new learned rule. */
export const ProposalResponse = z.object({ proposal: RuleProposal, rule: Rule.nullish(), meta: MutationMeta.nullish() })

/** assumed: PATCH /settings/practice {practice_cap_cents} (owner) — not in openapi.snapshot.json yet; see web-s2.md. */
export const PracticeSettings = z.object({ practice_cap_cents: Cents, meta: MutationMeta.nullish() })

// ── Today's claims (GET /ledger/today) ────────────────────────────────────────
export const HoldReason = z.enum([
  'note_unsigned',
  'procs_not_in_note',
  'rendering_mismatch',
  'awaiting_primary_eob',
  'missing_image',
  'subscriber_id_invalid',
  'other_documented',
  'reprocessing_requested',
])
export type HoldReason = z.infer<typeof HoldReason>
export const Hold = z.object({
  id: z.string(),
  subject: z.enum(['claim', 'patient_balance']),
  subject_id: z.string(),
  reason: HoldReason,
  detail: z.string(),
  held_since: IsoDateTime,
  clears_when: z.string(),
  owner_user_id: z.string().nullish(),
  timely_due: IsoDate.nullish(),
  cleared_at: IsoDateTime.nullish(),
})
export type Hold = z.infer<typeof Hold>

export const LedgerRow = z.object({
  claim: ClaimSummary,
  built_at: IsoDateTime,
  file_time: IsoDateTime.nullish(),
  editable_until: IsoDateTime.nullish(),
  ack_stage: z.string(),
  acks: z.array(AckEvent).default([]),
  checks_passed: z.number().int(),
  checks_total: z.number().int(),
  agent_text: z.boolean(),
  note: z.string().nullish(),
})
export type LedgerRow = z.infer<typeof LedgerRow>
export const HeldRow = z.object({ claim: ClaimSummary, hold: Hold, timely_days_left: z.number().int().nullish(), owner_name: z.string().nullish() })
export type HeldRow = z.infer<typeof HeldRow>
export const NotBillableRow = z.object({ patient: PatientRef, cdt: z.string(), quadrant: z.string().nullish(), fee_cents: Cents, reason: z.string() })
export type NotBillableRow = z.infer<typeof NotBillableRow>
export const Ledger = z.object({
  date: IsoDate,
  sent: z.array(LedgerRow),
  leaving_next_file: z.array(LedgerRow),
  held: z.array(HeldRow),
  not_billable: z.array(NotBillableRow),
  next_file_time: IsoDateTime.nullish(),
  last_file_time: IsoDateTime.nullish(),
})
export type Ledger = z.infer<typeof Ledger>

// ── Activity (GET /activity?day&agent&outcome) ────────────────────────────────
export const ActivityOutcome = z.enum(['ran', 'awaiting', 'would_have_run'])
export type ActivityOutcome = z.infer<typeof ActivityOutcome>
export const ActivityRow = z.object({
  run_id: z.string(),
  at: IsoDateTime,
  agent: AgentKind.nullable(), // null = a person's action (AuditEvent)
  actor: z.string().nullish(),
  action: z.string(),
  subject: z.string(),
  claim_id: z.string().nullish(),
  outcome: z.string(),
  would_have_run: z.boolean(),
  awaiting_you: z.boolean(),
  evidence_kinds: z.array(z.string()).default([]),
  audit_line: z.string().default(''),
  tier: Tier.nullish(),
})
export type ActivityRow = z.infer<typeof ActivityRow>
export const ActivitySummary = z.object({
  ran_without_you: z.number().int(),
  awaiting_you: z.number().int(),
  decisions: z.number().int(),
  status_checks: z.number().int(),
  payer_calls: z.number().int(),
  claims_sent: z.number().int(),
  remittances_posted: z.number().int(),
})
export type ActivitySummary = z.infer<typeof ActivitySummary>
const RanToYou = z.record(z.string(), z.record(z.string(), z.number().int()))
export const ActivityOut = z.object({ rows: z.array(ActivityRow), summary: ActivitySummary, by_agent: RanToYou, by_tier: RanToYou })
export type ActivityOut = z.infer<typeof ActivityOut>

// ── Eligibility (GET /eligibility?date, GET /eligibility/{appointment_id}) ────
export const EligibilityStatus = z.enum(['verified', 'issue', 'unverified', 'checking'])
export type EligibilityStatus = z.infer<typeof EligibilityStatus>
export const PlannedProcedure = z.object({ cdt: z.string(), tooth: z.string().nullish(), fee_cents: Cents })
export type PlannedProcedure = z.infer<typeof PlannedProcedure>
export const EligibilityRow = z.object({
  appointment_id: z.string(),
  start: IsoDateTime,
  patient: PatientRef,
  provider_name: z.string(),
  payer: PayerRef.nullable(),
  planned: z.array(PlannedProcedure),
  planned_fee_cents: Cents,
  remaining_max_cents: Cents.nullable(),
  status: EligibilityStatus,
  note: z.string().nullish(),
  inbox_item_id: z.string().nullish(),
})
export type EligibilityRow = z.infer<typeof EligibilityRow>
export const EligibilityOut = z.object({ date: IsoDate, rows: z.array(EligibilityRow), need_human: z.number().int() })
export type EligibilityOut = z.infer<typeof EligibilityOut>
export const Coverage = z.object({
  id: z.string(),
  payer_key: PayerKey,
  plan_name: z.string(),
  subscriber_id: z.string(),
  group_no: z.string(),
  order: z.string(),
  self_funded: z.boolean(),
  annual_max_cents: Cents,
  used_cents: Cents,
  remaining_max_cents: Cents,
  deductible_cents: Cents,
  deductible_met_cents: Cents,
  pct_preventive: z.number().int(),
  pct_basic: z.number().int(),
  pct_major: z.number().int(),
  verified_at: IsoDateTime.nullish(),
  verified_via: z.string().nullish(),
})
export type Coverage = z.infer<typeof Coverage>
export const FrequencyRow = z.object({ cdt: z.string(), rule: z.string(), last_done: IsoDate.nullish(), ok_from: IsoDate.nullish() })
export type FrequencyRow = z.infer<typeof FrequencyRow>
export const BenefitsPanel = z.object({
  appointment_id: z.string(),
  patient: PatientRef,
  coverage: Coverage,
  frequencies: z.array(FrequencyRow),
  planned: z.array(PlannedProcedure),
  planned_fee_cents: Cents,
  insurance_est_cents: Cents.nullish(),
  patient_est_cents: Cents.nullish(),
  basis: z.string(),
  agent_note: z.string().nullish(),
  inbox_item_id: z.string().nullish(),
})
export type BenefitsPanel = z.infer<typeof BenefitsPanel>

// ── Cash (GET /cash, owner) ───────────────────────────────────────────────────
export const Kpi = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.enum(['cents', 'days', 'pct', 'count']),
  formula: z.string(),
  basis: z.string(),
})
export type Kpi = z.infer<typeof Kpi>
export const AgingBucket = z.object({ bucket: z.string(), cents: Cents, count: z.number().int(), pct: z.number() })
export type AgingBucket = z.infer<typeof AgingBucket>
export const Breakdown = z.object({ key: z.string(), label: z.string(), cents: Cents, count: z.number().int() })
export type Breakdown = z.infer<typeof Breakdown>
export const CashSummary = z.object({
  kpis: z.array(Kpi),
  aging: z.array(AgingBucket),
  by_payer: z.array(Breakdown),
  by_provider: z.array(Breakdown),
  writeoffs_by_type: z.array(Breakdown),
  patient_aging: z.array(AgingBucket),
  agent_impact: z.object({ items_auto: z.number().int(), items_to_you: z.number().int(), hours_saved_est: Kpi }),
  appeals_12mo: z.record(z.string(), z.number().int()),
})
export type CashSummary = z.infer<typeof CashSummary>

// ── Denials (GET /denials) ────────────────────────────────────────────────────
export const NextAction = z.enum(['reconsideration', 'corrected', 'formal_appeal', 'bill_patient_link', 'write_off'])
export type NextAction = z.infer<typeof NextAction>
export const DenialRow = z.object({
  claim: ClaimSummary,
  carc: z.string(),
  rarc: z.string().nullish(),
  decoded: z.string(),
  root_cause: RootCause,
  next_action: NextAction,
  agent: AgentKind,
  signer: z.string().nullish(),
  deadline: Deadline,
  patient_billable_if_lost: z.boolean().nullable(),
  erisa: z.boolean(),
  checklist: z.array(z.string()).default([]),
  inbox_item_id: z.string().nullish(),
})
export type DenialRow = z.infer<typeof DenialRow>
export const DenialGroup = z.object({ next_action: NextAction, label: z.string(), count: z.number().int(), cents: Cents, rows: z.array(DenialRow) })
export type DenialGroup = z.infer<typeof DenialGroup>
export const DenialsOut = z.object({ groups: z.array(DenialGroup), total: z.number().int(), in_flight: z.array(ClaimSummary) })
export type DenialsOut = z.infer<typeof DenialsOut>

export const listOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int(), next_cursor: z.string().nullish() })

export const ClaimList = listOf(ClaimRow)
export type ClaimList = z.infer<typeof ClaimList>

export const ErrorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).nullish() }),
  alternatives: z.array(z.string()).nullish(),
})
