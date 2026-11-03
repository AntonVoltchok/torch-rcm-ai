import { z } from 'zod'

const kind = z.union([z.string(), z.null()]).optional()
const InboxItemKind = z.enum([
  'approve_action',
  'review_draft',
  'eligibility_flag',
  'variance',
  'run_failed',
  'rule_proposal',
  'owner_signoff',
])
const InboxItemState = z.enum(['open', 'approved', 'edited', 'rejected', 'snoozed', 'expired', 'done'])
const AgentKind = z.enum(['eligibility', 'claims', 'followup', 'appeals', 'posting'])
const Tier = z.union([z.literal(1), z.literal(2), z.literal(3)])
const Confidence = z.object({ pct: z.union([z.number(), z.null()]), basis: z.string() }).strict()
const ClaimStatus = z.enum([
  'ready',
  'sent',
  'rejected',
  'accepted',
  'pending',
  'denied',
  'partial',
  'paid',
  'appealed',
])
const PatientRef = z
  .object({
    id: z.string(),
    name: z.string(),
    display_name: z.string(),
    dob: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
const PayerKey = z.enum(['delta_ny', 'metlife', 'cigna', 'aetna', 'guardian', 'ny_medicaid'])
const PayerRef = z.object({ key: PayerKey, name: z.string(), short_name: z.string() }).strict()
const ClaimSummary = z
  .object({
    id: z.string(),
    number: z.number().int(),
    status: ClaimStatus,
    needs_action: z.boolean(),
    patient: PatientRef,
    payer: PayerRef,
    dos: z.string(),
    procedures: z.string(),
    billed_cents: z.number().int(),
    allowed_cents: z.union([z.number().int(), z.null()]),
    paid_cents: z.union([z.number().int(), z.null()]),
    icn: z.union([z.string(), z.null()]),
    reason: z.union([z.string(), z.null()]),
    in_flight: z.union([z.string(), z.null()]),
    age_days: z.union([z.number(), z.null()]),
    file_time: z.union([z.string(), z.null()]),
  })
  .strict()
const RuleAction = z.enum([
  'status_check',
  'payer_rep_call',
  'records_request',
  'resubmit_with_attachment',
  'reprocessing_request',
  'request_835',
  'send_claim_pms_codes',
  'fix_demographics_resend',
  'eligibility_check',
  'post_era_line',
  'update_pms_benefits',
  'send_claim_agent_text',
  'corrected_claim',
  'patient_transfer',
  'send_statement',
  'mechanical_refund',
  'cob_order_change',
  'write_off',
  'formal_appeal',
  'void_claim',
  'discretionary_refund',
  'collections_referral',
  'waiver',
])
const ProposedAction = z
  .object({
    action: RuleAction,
    params: z.object({}).partial().strict().passthrough().optional(),
    cents: z.number().int().optional().default(0),
    requires_hold_window: z.boolean().optional().default(false),
  })
  .strict()
const Role = z.enum(['owner', 'billing', 'dentist', 'front_desk'])
const RootCause = z.enum(['ours', 'payer', 'patient', 'unknown'])
const InboxItemOut = z
  .object({
    id: z.string(),
    kind: InboxItemKind,
    state: InboxItemState,
    title: z.string(),
    summary: z.string(),
    recommendation: z.string(),
    agent: z.union([AgentKind, z.null()]),
    tier: z.union([Tier, z.null()]),
    cents: z.number().int(),
    confidence: z.union([Confidence, z.null()]),
    group_key: z.union([z.string(), z.null()]),
    group_title: z.union([z.string(), z.null()]),
    claim: z.union([ClaimSummary, z.null()]),
    patient: z.union([PatientRef, z.null()]),
    appointment_id: z.union([z.string(), z.null()]),
    remittance_id: z.union([z.string(), z.null()]),
    rule_id: z.union([z.string(), z.null()]),
    run_id: z.union([z.string(), z.null()]),
    evidence_ids: z.array(z.string()),
    proposed_action: z.union([ProposedAction, z.null()]),
    required_role: z.union([Role, z.null()]),
    assignee_user_id: z.union([z.string(), z.null()]),
    deadline_on: z.union([z.string(), z.null()]),
    created_at: z.string().datetime({ offset: true }),
    snoozed_until: z.union([z.string(), z.null()]),
    resolved_by: z.union([z.string(), z.null()]),
    resolved_at: z.union([z.string(), z.null()]),
    priority: z.number(),
    root_cause: z.union([RootCause, z.null()]),
    stopped_by: z.string(),
    suspicious_evidence: z.boolean().optional().default(false),
  })
  .strict()
const InboxGroup = z
  .object({
    group_key: z.string(),
    title: z.string(),
    count: z.number().int(),
    cents: z.number().int(),
    item_ids: z.array(z.string()),
  })
  .strict()
const InboxList = z
  .object({
    items: z.array(InboxItemOut),
    total: z.number().int(),
    total_cents: z.number().int(),
    next_cursor: z.union([z.string(), z.null()]).optional(),
    groups: z.union([z.array(InboxGroup), z.null()]).optional(),
  })
  .strict()
const ValidationError = z
  .object({
    loc: z.array(z.union([z.string(), z.number()])),
    msg: z.string(),
    type: z.string(),
    input: z.unknown().optional(),
    ctx: z.object({}).partial().strict().passthrough().optional(),
  })
  .strict()
  .passthrough()
const HTTPValidationError = z
  .object({ detail: z.array(ValidationError) })
  .partial()
  .strict()
  .passthrough()
const EvidenceKind = z.enum([
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
const GatheredBy = z.enum(['agent', 'code'])
const Evidence = z
  .object({
    id: z.string(),
    kind: EvidenceKind,
    title: z.string(),
    excerpt: z.string(),
    uri: z.union([z.string(), z.null()]).optional(),
    captured_at: z.string().datetime({ offset: true }),
    reference: z.union([z.string(), z.null()]).optional(),
    suspicious: z.boolean().optional().default(false),
    gathered_by: GatheredBy.optional(),
    claim_id: z.union([z.string(), z.null()]).optional(),
    run_id: z.union([z.string(), z.null()]).optional(),
    world_call_id: z.union([z.string(), z.null()]).optional(),
    source: z.string().optional().default(''),
    data: z.object({}).partial().strict().passthrough().optional(),
  })
  .strict()
const HoldWindow = z
  .object({
    editable_until: z.union([z.string(), z.null()]),
    file_time: z.union([z.string(), z.null()]),
    departed: z.boolean(),
    alternatives: z.array(z.string()),
  })
  .strict()
const InboxItemDetail = z
  .object({
    id: z.string(),
    kind: InboxItemKind,
    state: InboxItemState,
    title: z.string(),
    summary: z.string(),
    recommendation: z.string(),
    agent: z.union([AgentKind, z.null()]),
    tier: z.union([Tier, z.null()]),
    cents: z.number().int(),
    confidence: z.union([Confidence, z.null()]),
    group_key: z.union([z.string(), z.null()]),
    group_title: z.union([z.string(), z.null()]),
    claim: z.union([ClaimSummary, z.null()]),
    patient: z.union([PatientRef, z.null()]),
    appointment_id: z.union([z.string(), z.null()]),
    remittance_id: z.union([z.string(), z.null()]),
    rule_id: z.union([z.string(), z.null()]),
    run_id: z.union([z.string(), z.null()]),
    evidence_ids: z.array(z.string()),
    proposed_action: z.union([ProposedAction, z.null()]),
    required_role: z.union([Role, z.null()]),
    assignee_user_id: z.union([z.string(), z.null()]),
    deadline_on: z.union([z.string(), z.null()]),
    created_at: z.string().datetime({ offset: true }),
    snoozed_until: z.union([z.string(), z.null()]),
    resolved_by: z.union([z.string(), z.null()]),
    resolved_at: z.union([z.string(), z.null()]),
    priority: z.number(),
    root_cause: z.union([RootCause, z.null()]),
    stopped_by: z.string(),
    suspicious_evidence: z.boolean().optional().default(false),
    plan_steps: z.array(z.string()),
    audit_note: z.union([z.string(), z.null()]),
    evidence: z.array(Evidence),
    payload: z.object({}).partial().strict().passthrough(),
    hold_window: z.union([HoldWindow, z.null()]),
  })
  .strict()
const ApproveIn = z
  .object({ edits: z.union([z.object({}).partial().strict().passthrough(), z.null()]) })
  .partial()
  .strict()
const approve_api_v1_inbox__item_id__approve_post_Body = z.union([ApproveIn, z.null()])
const RunTrigger = z.enum(['rule', 'approval', 'schedule', 'manual'])
const RunStatus = z.enum(['queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled', 'would_have_run'])
const AgentMode = z.enum(['deterministic', 'live'])
const PlannerKind = z.enum(['live', 'scripted', 'recorded_plan', 'scripted_fallback'])
const PolicyVerdict = z.enum(['observe', 'propose', 'execute', 'refuse', 'park'])
const StepStatus = z.enum(['pending', 'running', 'ok', 'failed', 'skipped'])
const RunStep = z
  .object({
    idx: z.number().int(),
    name: z.string(),
    label: z.string().optional().default(''),
    status: StepStatus,
    started_at: z.union([z.string(), z.null()]).optional(),
    finished_at: z.union([z.string(), z.null()]).optional(),
    tool: z.string().optional().default(''),
    input_summary: z.string().optional().default(''),
    output_summary: z.string().optional().default(''),
    progress_lines: z.array(z.string()).optional(),
    policy_verdict: z.union([PolicyVerdict, z.null()]).optional(),
    evidence_ids: z.array(z.string()).optional(),
  })
  .strict()
const Usage = z
  .object({
    model_calls: z.number().int().default(0),
    input: z.number().int().default(0),
    output: z.number().int().default(0),
    cache_read: z.number().int().default(0),
    cache_write: z.number().int().default(0),
    cost_usd_micros: z.number().int().default(0),
  })
  .partial()
  .strict()
const Run = z
  .object({
    id: z.string(),
    agent: AgentKind,
    trigger: RunTrigger,
    actor: z.union([z.string(), z.null()]).optional(),
    rule_id: z.union([z.string(), z.null()]).optional(),
    rule_version: z.union([z.number(), z.null()]).optional(),
    inbox_item_id: z.union([z.string(), z.null()]).optional(),
    claim_id: z.union([z.string(), z.null()]).optional(),
    patient_id: z.union([z.string(), z.null()]).optional(),
    remittance_id: z.union([z.string(), z.null()]).optional(),
    parent_run_id: z.union([z.string(), z.null()]).optional(),
    idempotency_key: z.string(),
    status: RunStatus,
    mode: AgentMode.optional(),
    planner: PlannerKind.optional(),
    situation_key: z.union([z.string(), z.null()]).optional(),
    model_situation_label: z.union([z.string(), z.null()]).optional(),
    plan: z.union([z.object({}).partial().strict().passthrough(), z.null()]).optional(),
    action: z.union([RuleAction, z.null()]).optional(),
    action_label: z.string().optional().default(''),
    tier: z.union([Tier, z.null()]).optional(),
    verdict: z.union([PolicyVerdict, z.null()]).optional(),
    started_at: z.string().datetime({ offset: true }),
    finished_at: z.union([z.string(), z.null()]).optional(),
    steps: z.array(RunStep).optional(),
    result_summary: z.string().optional().default(''),
    audit_line: z.string().optional().default(''),
    usage: Usage.optional(),
    outcome: z.string().optional().default(''),
  })
  .strict()
const RuleOrigin = z.enum(['authored', 'learned'])
const RuleScope = z
  .object({
    payer_key: z.union([PayerKey, z.null()]),
    item_type: z.string().default('all'),
    max_cents: z.union([z.number().int(), z.null()]),
  })
  .partial()
  .strict()
const RuleMode = z.enum(['observe', 'ask', 'auto', 'human_only'])
const OutcomeMetric = z.enum(['paid_30d', 'accepted', 'balanced', 'none'])
const ReversesIn = z.enum(['until_file_leaves', 'until_day_close', 'void_only', 'none'])
const BaseRate = z.object({ n: z.number().int(), k: z.number().int() }).strict()
const Rule = z
  .object({
    id: z.string(),
    label: z.string(),
    version: z.number().int().optional().default(1),
    origin: RuleOrigin.optional(),
    tier: Tier,
    agent: AgentKind,
    action: RuleAction,
    scope: RuleScope.optional(),
    mode: RuleMode,
    confidence_floor: z.union([z.number(), z.null()]).optional(),
    outcome_metric: OutcomeMetric.optional(),
    reverses_in: ReversesIn.optional(),
    requires_owner_signoff: z.boolean().optional().default(false),
    signed_by: z.union([z.string(), z.null()]).optional(),
    signed_at: z.union([z.string(), z.null()]).optional(),
    changed_by: z.string(),
    changed_at: z.string().datetime({ offset: true }),
    base_rate: BaseRate.optional(),
    sort: z.number().int().optional().default(0),
    description: z.string().optional().default(''),
  })
  .strict()
const StripTile = z
  .object({
    status: ClaimStatus,
    count: z.number().int(),
    cents: z.number().int(),
    flagged: z.number().int(),
    cents_basis: z.enum(['billed', 'paid']).optional().default('billed'),
    label: z.string(),
  })
  .strict()
const NavBadges = z
  .object({ payments: z.number().int(), eligibility: z.number().int(), activity: z.number().int() })
  .strict()
const Strip = z
  .object({
    tiles: z.array(StripTile),
    inbox_open: z.number().int(),
    inbox_open_cents: z.number().int(),
    paid_month_count: z.number().int(),
    paid_month_cents: z.number().int(),
    open_count: z.number().int(),
    open_cents: z.number().int(),
    ar_count: z.number().int(),
    ar_cents: z.number().int(),
    flagged_count: z.number().int(),
    flagged_cents: z.number().int(),
    as_of: z.string().datetime({ offset: true }),
    paid_month_label: z.string(),
    nav_badges: NavBadges,
  })
  .strict()
const Meta = z.object({ counts: Strip }).strict()
const ApproveOut = z
  .object({ item: InboxItemOut, run: z.union([Run, z.null()]), rule: z.union([Rule, z.null()]).optional(), meta: Meta })
  .strict()
const GroupApproveIn = z.object({ group_key: z.string() }).strict()
const GroupApproveOut = z.object({ items: z.array(InboxItemOut), runs: z.array(Run), meta: Meta }).strict()
const RejectIn = z.object({ reason: z.string().min(1).max(500) }).strict()
const ItemOut = z.object({ item: InboxItemOut, meta: Meta }).strict()
const SnoozeIn = z.object({ until: z.string().datetime({ offset: true }) }).strict()
const ProposalEvidence = z
  .object({
    approved: z.number().int(),
    total: z.number().int(),
    outcome_k: z.number().int(),
    outcome_n: z.number().int(),
  })
  .strict()
const ProposalState = z.enum(['open', 'accepted', 'dismissed'])
const RuleProposal = z
  .object({
    id: z.string(),
    title: z.string(),
    rule_draft: z.object({}).partial().strict().passthrough(),
    evidence: ProposalEvidence,
    root_cause_guard: z.boolean(),
    state: ProposalState,
    created_at: z.string().datetime({ offset: true }),
    watching: z.boolean().optional().default(false),
    source_item_id: z.union([z.string(), z.null()]).optional(),
    note: z.string().optional().default(''),
  })
  .strict()
const ProposalOut = z
  .object({ proposal: RuleProposal, rule: z.union([Rule, z.null()]).optional(), meta: Meta })
  .strict()
const status_ = z.union([z.array(ClaimStatus), z.null()]).optional()
const needs_action = z.union([z.boolean(), z.null()]).optional()
const ClaimRow = z
  .object({
    id: z.string(),
    number: z.number().int(),
    status: ClaimStatus,
    needs_action: z.boolean(),
    patient: PatientRef,
    payer: PayerRef,
    dos: z.string(),
    procedures: z.string(),
    billed_cents: z.number().int(),
    allowed_cents: z.union([z.number().int(), z.null()]),
    paid_cents: z.union([z.number().int(), z.null()]),
    icn: z.union([z.string(), z.null()]),
    reason: z.union([z.string(), z.null()]),
    in_flight: z.union([z.string(), z.null()]),
    age_days: z.union([z.number(), z.null()]),
    file_time: z.union([z.string(), z.null()]),
    provider_id: z.string(),
    provider_name: z.string(),
    location_id: z.string(),
    agent_note: z.union([z.string(), z.null()]),
    last_activity_at: z.union([z.string(), z.null()]),
    last_activity: z.union([z.string(), z.null()]),
  })
  .strict()
const ClaimList = z
  .object({
    items: z.array(ClaimRow),
    total: z.number().int(),
    total_cents: z.number().int(),
    flagged_count: z.number().int(),
    flagged_cents: z.number().int(),
    next_cursor: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
const CoverageOut = z
  .object({
    id: z.string(),
    payer_key: PayerKey,
    plan_name: z.string(),
    subscriber_id: z.string(),
    group_no: z.string(),
    order: z.string(),
    self_funded: z.boolean(),
    annual_max_cents: z.number().int(),
    used_cents: z.number().int(),
    remaining_max_cents: z.number().int(),
    deductible_cents: z.number().int(),
    deductible_met_cents: z.number().int(),
    pct_preventive: z.number().int(),
    pct_basic: z.number().int(),
    pct_major: z.number().int(),
    verified_at: z.union([z.string(), z.null()]),
    verified_via: z.union([z.string(), z.null()]),
  })
  .strict()
const AdjGroup = z.enum(['CO', 'PR', 'OA'])
const Adjustment = z.object({ group: AdjGroup, code: z.string(), cents: z.number().int() }).strict()
const ClaimLine = z
  .object({
    id: z.string(),
    cdt: z.string(),
    tooth: z.union([z.string(), z.null()]).optional(),
    surface: z.union([z.string(), z.null()]).optional(),
    fee_cents: z.number().int(),
    allowed_cents: z.union([z.number().int(), z.null()]).optional(),
    paid_cents: z.union([z.number().int(), z.null()]).optional(),
    adj: z.array(Adjustment).optional(),
    patient_adj: z.array(Adjustment).optional(),
    patient_cents: z.union([z.number().int(), z.null()]).optional(),
    procedure_line_id: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
const AttachmentKind = z.enum(['pa', 'bwx', 'fmx', 'perio_chart', 'narrative', 'eob'])
const AttachmentSource = z.enum(['pms_imaging', 'agent', 'user'])
const Attachment = z
  .object({
    id: z.string(),
    kind: AttachmentKind,
    nea_number: z.union([z.string(), z.null()]).optional(),
    source: AttachmentSource,
    image_id: z.union([z.string(), z.null()]).optional(),
    created_at: z.string().datetime({ offset: true }),
    note: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
const AckStage = z.enum([
  'none',
  'file_999_ok',
  'file_999_reject',
  'ch_277ca_a1',
  'ch_277ca_a7',
  'payer_277ca_a1',
  'payer_277ca_a7',
])
const AckEvent = z
  .object({
    id: z.string(),
    claim_id: z.string(),
    stage: AckStage,
    code: z.union([z.string(), z.null()]).optional(),
    message: z.string(),
    at: z.string().datetime({ offset: true }),
    source: z.string().optional().default('vyne'),
  })
  .strict()
const ReadinessKey = z.enum([
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
const CheckStatus = z.enum(['pass', 'warn', 'fail', 'na'])
const ReadinessCheck = z.object({ key: ReadinessKey, status: CheckStatus, detail: z.string() }).strict()
const Denial = z
  .object({ carc: z.string(), rarc: z.union([z.string(), z.null()]), decoded: z.string(), root_cause: RootCause })
  .strict()
const DeadlineKind = z.enum(['timely_filing', 'appeal', 'none'])
const Deadline = z.object({ kind: DeadlineKind, due_on: z.union([z.string(), z.null()]), basis: z.string() }).strict()
const MoneyMath = z
  .object({
    billed_cents: z.number().int(),
    allowed_cents: z.union([z.number().int(), z.null()]),
    contractual_cents: z.union([z.number().int(), z.null()]),
    insurance_est_cents: z.union([z.number().int(), z.null()]),
    patient_est_cents: z.union([z.number().int(), z.null()]),
    paid_cents: z.union([z.number().int(), z.null()]),
    writeoff_cents: z.union([z.number().int(), z.null()]),
    patient_resp_cents: z.union([z.number().int(), z.null()]),
    basis: z.string(),
  })
  .strict()
const TimelineEntry = z
  .object({
    id: z.string(),
    at: z.string().datetime({ offset: true }),
    lane: z.enum(['agent', 'payer', 'human', 'system']),
    kind: z.string(),
    title: z.string(),
    detail: z.union([z.string(), z.null()]).optional(),
    actor: z.union([z.string(), z.null()]).optional(),
    run_id: z.union([z.string(), z.null()]).optional(),
    evidence_ids: z.array(z.string()).optional(),
    root_cause: z.union([RootCause, z.null()]).optional(),
  })
  .strict()
const HoldSubject = z.enum(['claim', 'patient_balance'])
const HoldReason = z.enum([
  'note_unsigned',
  'procs_not_in_note',
  'rendering_mismatch',
  'awaiting_primary_eob',
  'missing_image',
  'subscriber_id_invalid',
  'other_documented',
  'reprocessing_requested',
])
const Hold = z
  .object({
    id: z.string(),
    subject: HoldSubject,
    subject_id: z.string(),
    reason: HoldReason,
    detail: z.string(),
    held_since: z.string().datetime({ offset: true }),
    clears_when: z.string(),
    owner_user_id: z.union([z.string(), z.null()]),
    timely_due: z.union([z.string(), z.null()]).optional(),
    cleared_at: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
const FileEntryKind = z.enum(['original', 'resubmit', 'corrected'])
const FileEntryState = z.enum(['queued', 'departed', 'withdrawn'])
const FileEntry = z
  .object({
    id: z.string(),
    claim_id: z.string(),
    payer_key: PayerKey,
    file_time: z.string().datetime({ offset: true }),
    kind: FileEntryKind,
    state: FileEntryState,
    queued_at: z.string().datetime({ offset: true }),
    queued_by: z.string(),
    departed_at: z.union([z.string(), z.null()]).optional(),
    remarks: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
const ClaimDetail = z
  .object({
    claim: ClaimSummary,
    provider_name: z.string(),
    location_name: z.string(),
    coverage: CoverageOut,
    patient: PatientRef,
    payer: PayerRef,
    lines: z.array(ClaimLine),
    attachments: z.array(Attachment),
    acks: z.array(AckEvent),
    readiness: z.array(ReadinessCheck),
    denial: z.union([Denial, z.null()]),
    deadline: Deadline,
    money: MoneyMath,
    timeline: z.array(TimelineEntry),
    timeline_next_cursor: z.union([z.string(), z.null()]),
    open_inbox_items: z.array(InboxItemOut),
    holds: z.array(Hold),
    file_entries: z.array(FileEntry),
    parent_claim_id: z.union([z.string(), z.null()]),
    frequency_code: z.union([z.number(), z.null()]),
    closed_reason: z.union([z.string(), z.null()]),
    timely_filing_due: z.union([z.string(), z.null()]),
  })
  .strict()
const TimelinePage = z
  .object({ items: z.array(TimelineEntry), next_cursor: z.union([z.string(), z.null()]).optional() })
  .strict()
const VoidIn = z.object({ reason: z.string().min(1).max(500) }).strict()
const ClaimMutationOut = z
  .object({ claim: ClaimSummary, run: z.union([Run, z.null()]).optional(), meta: Meta })
  .strict()
const CorrectedIn = z.object({ changes: z.object({}).partial().strict().passthrough() }).strict()
const TriageIn = z
  .object({ agent: z.union([z.enum(['claims', 'followup']), z.null()]) })
  .partial()
  .strict()
const triage_api_v1_claims__claim_id__triage_post_Body = z.union([TriageIn, z.null()])
const TriageOut = z.object({ run: Run, meta: Meta }).strict()
const SavedView = z
  .object({
    id: z.string(),
    name: z.string(),
    search_params: z.object({}).partial().strict().passthrough(),
    owner_user_id: z.union([z.string(), z.null()]),
    created_at: z.string().datetime({ offset: true }),
    builtin: z.boolean().optional().default(false),
  })
  .strict()
const ViewList = z.object({ items: z.array(SavedView), total: z.number().int() }).strict()
const ViewIn = z
  .object({ name: z.string().min(1).max(80), search_params: z.object({}).partial().strict().passthrough() })
  .strict()
const LedgerRow = z
  .object({
    claim: ClaimSummary,
    built_at: z.string().datetime({ offset: true }),
    file_time: z.union([z.string(), z.null()]),
    editable_until: z.union([z.string(), z.null()]),
    ack_stage: z.string(),
    acks: z.array(AckEvent),
    checks_passed: z.number().int(),
    checks_total: z.number().int(),
    agent_text: z.boolean(),
    note: z.union([z.string(), z.null()]),
  })
  .strict()
const HeldRow = z
  .object({
    claim: ClaimSummary,
    hold: Hold,
    timely_days_left: z.union([z.number(), z.null()]),
    owner_name: z.union([z.string(), z.null()]),
  })
  .strict()
const NotBillableRow = z
  .object({
    patient: PatientRef,
    cdt: z.string(),
    quadrant: z.union([z.string(), z.null()]),
    fee_cents: z.number().int(),
    reason: z.string(),
  })
  .strict()
const LedgerToday = z
  .object({
    date: z.string(),
    sent: z.array(LedgerRow),
    leaving_next_file: z.array(LedgerRow),
    held: z.array(HeldRow),
    not_billable: z.array(NotBillableRow),
    next_file_time: z.union([z.string(), z.null()]),
    last_file_time: z.union([z.string(), z.null()]),
  })
  .strict()
const RuleRow = z
  .object({
    rule: Rule,
    ran_without_review_7d: z.number().int(),
    routine_runs_7d: z.number().int(),
    waiting: z.number().int(),
    confidence: z.union([Confidence, z.null()]),
    signed_by_name: z.union([z.string(), z.null()]),
    locked: z.boolean(),
  })
  .strict()
const TierGroup = z.object({ tier: Tier, label: z.string(), description: z.string(), rows: z.array(RuleRow) }).strict()
const WeekDecisions = z.object({ total: z.number().int(), ran: z.number().int(), to_you: z.number().int() }).strict()
const RulesOut = z
  .object({
    tiers: z.array(TierGroup),
    practice_cap_cents: z.number().int(),
    this_week: WeekDecisions,
    changes_count: z.number().int(),
    proposals_open: z.number().int(),
  })
  .strict()
const RuleChange = z
  .object({
    id: z.string(),
    rule_id: z.string(),
    at: z.string().datetime({ offset: true }),
    by: z.string(),
    before: z.object({}).partial().strict().passthrough(),
    after: z.object({}).partial().strict().passthrough(),
    items_affected_since: z.number().int().optional().default(0),
    summary: z.string().optional().default(''),
  })
  .strict()
const RuleChangeList = z.object({ items: z.array(RuleChange), total: z.number().int() }).strict()
const RulePatchIn = z
  .object({
    mode: z.union([RuleMode, z.null()]),
    max_cents: z.union([z.number().int(), z.null()]),
    confidence_floor: z.union([z.number(), z.null()]),
  })
  .partial()
  .strict()
const RulePatchOut = z.object({ rule: Rule, change: RuleChange, meta: Meta }).strict()
const mode = z.union([RuleMode, z.null()]).optional()
const max_cents = z.union([z.number(), z.null()]).optional()
const PreviewOut = z
  .object({
    rule_id: z.string(),
    mode: RuleMode,
    max_cents: z.union([z.number().int(), z.null()]),
    would_run: z.number().int(),
    total: z.number().int(),
    baseline_would_run: z.number().int(),
    held_by_root_cause: z.record(z.number().int()),
  })
  .strict()
const PracticeSettingsIn = z.object({ practice_cap_cents: z.number().int() }).strict()
const PracticeSettingsOut = z.object({ practice_cap_cents: z.number().int(), meta: Meta }).strict()
const ProposalList = z.object({ items: z.array(RuleProposal), total: z.number().int() }).strict()
const ActivityRow = z
  .object({
    run_id: z.string(),
    at: z.string().datetime({ offset: true }),
    agent: z.union([AgentKind, z.null()]),
    actor: z.union([z.string(), z.null()]),
    action: z.string(),
    subject: z.string(),
    claim_id: z.union([z.string(), z.null()]),
    outcome: z.string(),
    would_have_run: z.boolean(),
    awaiting_you: z.boolean(),
    evidence_kinds: z.array(z.string()),
    audit_line: z.string(),
    tier: z.union([Tier, z.null()]),
  })
  .strict()
const ActivitySummary = z
  .object({
    ran_without_you: z.number().int(),
    awaiting_you: z.number().int(),
    decisions: z.number().int(),
    status_checks: z.number().int(),
    payer_calls: z.number().int(),
    claims_sent: z.number().int(),
    remittances_posted: z.number().int(),
  })
  .strict()
const ActivityOut = z
  .object({
    rows: z.array(ActivityRow),
    summary: ActivitySummary,
    by_agent: z.record(z.record(z.number().int())),
    by_tier: z.record(z.record(z.number().int())),
  })
  .strict()
const PlannedProcedure = z
  .object({ cdt: z.string(), tooth: z.union([z.string(), z.null()]).optional(), fee_cents: z.number().int() })
  .strict()
const EligibilityStatus = z.enum(['verified', 'issue', 'unverified', 'checking'])
const EligibilityRow = z
  .object({
    appointment_id: z.string(),
    start: z.string().datetime({ offset: true }),
    patient: PatientRef,
    provider_name: z.string(),
    payer: z.union([PayerRef, z.null()]),
    planned: z.array(PlannedProcedure),
    planned_fee_cents: z.number().int(),
    remaining_max_cents: z.union([z.number().int(), z.null()]),
    status: EligibilityStatus,
    note: z.union([z.string(), z.null()]),
    inbox_item_id: z.union([z.string(), z.null()]),
  })
  .strict()
const EligibilityOut = z
  .object({ date: z.string(), rows: z.array(EligibilityRow), need_human: z.number().int() })
  .strict()
const FrequencyRow = z
  .object({
    cdt: z.string(),
    rule: z.string(),
    last_done: z.union([z.string(), z.null()]),
    ok_from: z.union([z.string(), z.null()]),
  })
  .strict()
const BenefitsPanel = z
  .object({
    appointment_id: z.string(),
    patient: PatientRef,
    coverage: CoverageOut,
    frequencies: z.array(FrequencyRow),
    planned: z.array(PlannedProcedure),
    planned_fee_cents: z.number().int(),
    insurance_est_cents: z.union([z.number().int(), z.null()]),
    patient_est_cents: z.union([z.number().int(), z.null()]),
    basis: z.string(),
    agent_note: z.union([z.string(), z.null()]),
    inbox_item_id: z.union([z.string(), z.null()]),
  })
  .strict()
const Kpi = z
  .object({
    key: z.string(),
    label: z.string(),
    value: z.number(),
    unit: z.enum(['cents', 'days', 'pct', 'count']),
    formula: z.string(),
    basis: z.string(),
  })
  .strict()
const AgingBucket = z
  .object({ bucket: z.string(), cents: z.number().int(), count: z.number().int(), pct: z.number() })
  .strict()
const Breakdown = z
  .object({ key: z.string(), label: z.string(), cents: z.number().int(), count: z.number().int() })
  .strict()
const AgentImpact = z
  .object({ items_auto: z.number().int(), items_to_you: z.number().int(), hours_saved_est: Kpi })
  .strict()
const CashOut = z
  .object({
    kpis: z.array(Kpi),
    aging: z.array(AgingBucket),
    by_payer: z.array(Breakdown),
    by_provider: z.array(Breakdown),
    writeoffs_by_type: z.array(Breakdown),
    patient_aging: z.array(AgingBucket),
    agent_impact: AgentImpact,
    appeals_12mo: z.record(z.number().int()),
  })
  .strict()
const NextAction = z.enum(['reconsideration', 'corrected', 'formal_appeal', 'bill_patient_link', 'write_off'])
const DenialRow = z
  .object({
    claim: ClaimSummary,
    carc: z.string(),
    rarc: z.union([z.string(), z.null()]),
    decoded: z.string(),
    root_cause: RootCause,
    next_action: NextAction,
    agent: AgentKind,
    signer: z.union([z.string(), z.null()]),
    deadline: Deadline,
    patient_billable_if_lost: z.union([z.boolean(), z.null()]),
    erisa: z.boolean(),
    checklist: z.array(z.string()),
    inbox_item_id: z.union([z.string(), z.null()]),
  })
  .strict()
const DenialGroup = z
  .object({
    next_action: NextAction,
    label: z.string(),
    count: z.number().int(),
    cents: z.number().int(),
    rows: z.array(DenialRow),
  })
  .strict()
const DenialsOut = z
  .object({ groups: z.array(DenialGroup), total: z.number().int(), in_flight: z.array(ClaimSummary) })
  .strict()
const RemitKind = z.enum(['835', 'paper_eob'])
const DepositStatus = z.enum(['deposited', 'expected', 'not_deposited'])
const LineMatch = z.enum(['auto', 'review', 'unmatched'])
const RemitLine = z
  .object({
    id: z.string(),
    claim_id: z.union([z.string(), z.null()]),
    claim_line_id: z.union([z.string(), z.null()]),
    cdt: z.string(),
    billed: z.number().int(),
    allowed: z.number().int(),
    paid: z.number().int(),
    adj: z.array(Adjustment).optional(),
    patient_adj: z.array(Adjustment).optional(),
    patient_cents: z.number().int(),
    match: LineMatch.optional(),
    variance_cents: z.union([z.number().int(), z.null()]).optional(),
    rarc: z.union([z.string(), z.null()]).optional(),
    note: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
const RemitStatus = z.enum(['auto_posted', 'needs_review', 'unmatched'])
const Remittance = z
  .object({
    id: z.string(),
    payer_key: PayerKey,
    kind: RemitKind,
    trace: z.string(),
    amount_cents: z.number().int(),
    received_at: z.string().datetime({ offset: true }),
    deposit_status: DepositStatus,
    lines: z.array(RemitLine),
    status: RemitStatus,
    check_number: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
const RemittanceList = z.object({ items: z.array(Remittance), total: z.number().int() }).strict()
const PatientBalanceRow = z
  .object({
    patient: PatientRef,
    balance_cents: z.number().int(),
    oldest_dos: z.union([z.string(), z.null()]),
    aging_bucket: z.string(),
    last_payment_on: z.union([z.string(), z.null()]),
    on_hold: z.boolean(),
  })
  .strict()
const PatientBalances = z
  .object({
    items: z.array(PatientBalanceRow),
    total: z.number().int(),
    ar_cents: z.number().int(),
    credits_cents: z.number().int(),
    credit_count: z.number().int(),
  })
  .strict()
const Advancing = z.object({ advance_id: z.string(), to: z.string().datetime({ offset: true }) }).strict()
const ClockOut = z
  .object({
    now: z.string().datetime({ offset: true }),
    frozen: z.boolean().optional().default(true),
    advancing: z.union([Advancing, z.null()]).optional(),
  })
  .strict()
const AdvanceIn = z
  .object({ minutes: z.union([z.number(), z.null()]), to: z.union([z.string(), z.null()]) })
  .partial()
  .strict()
const AdvanceAccepted = z
  .object({
    advance_id: z.string(),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .strict()
const EventFired = z
  .object({
    at: z.string().datetime({ offset: true }),
    kind: z.string(),
    summary: z.string(),
    job_id: z.string(),
    data: z.object({}).partial().strict().passthrough().optional(),
  })
  .strict()
const AdvanceOut = z
  .object({
    advance_id: z.string(),
    state: z.enum(['running', 'done', 'failed']),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    now: z.string().datetime({ offset: true }),
    events_fired: z.array(EventFired),
    runs_started: z.number().int(),
    live_runs: z.number().int(),
    skipped_unhandled: z.record(z.number().int()),
    done: z.boolean(),
    error: z.union([z.string(), z.null()]).optional(),
    meta: z.union([Meta, z.null()]).optional(),
  })
  .strict()
const ReseedOut = z.object({ scenario: z.string(), now: z.string().datetime({ offset: true }), meta: Meta }).strict()
const RunList = z
  .object({ items: z.array(Run), total: z.number().int(), next_cursor: z.union([z.string(), z.null()]).optional() })
  .strict()
const RunDetail = z.object({ run: Run, evidence: z.array(Evidence), last_event_id: z.number().int() }).strict()
const AgentsStatus = z
  .object({
    paused: z.boolean(),
    paused_by: z.union([z.string(), z.null()]),
    paused_at: z.union([z.string(), z.null()]),
    mode: z.enum(['deterministic', 'live']),
    live_agents: z.array(AgentKind),
    agents: z.number().int(),
    running: z.number().int(),
    queued: z.number().int(),
    paused_runs: z.number().int(),
  })
  .strict()
const ReseedIn = z
  .object({ scenario: z.union([z.string(), z.null()]) })
  .partial()
  .strict()
const world_reseed_api_v1__world_reseed_post_Body = z.union([ReseedIn, z.null()])
const WorldPayer = z
  .object({
    key: PayerKey,
    name: z.string(),
    payer_id: z.string(),
    type: z.string(),
    timely_filing_days: z.number().int(),
    appeal_window_days: z.number().int(),
    era_weekdays: z.array(z.number().int()),
    latency_bd: z.array(z.any()).min(2).max(2),
    rules: z.array(z.string()),
    portal_down: z.boolean(),
  })
  .strict()
const InjectIn = z
  .object({
    event: z.enum(['clearinghouse_reject', 'portal_outage', 'portal_restore', 'era_now']),
    claim_id: z.union([z.string(), z.null()]).optional(),
    payer_key: z.union([PayerKey, z.null()]).optional(),
    code: z.union([z.string(), z.null()]).optional(),
  })
  .strict()
const InjectOut = z.object({ ok: z.boolean(), detail: z.string(), meta: Meta }).strict()

export const schemas = {
  kind,
  InboxItemKind,
  InboxItemState,
  AgentKind,
  Tier,
  Confidence,
  ClaimStatus,
  PatientRef,
  PayerKey,
  PayerRef,
  ClaimSummary,
  RuleAction,
  ProposedAction,
  Role,
  RootCause,
  InboxItemOut,
  InboxGroup,
  InboxList,
  ValidationError,
  HTTPValidationError,
  EvidenceKind,
  GatheredBy,
  Evidence,
  HoldWindow,
  InboxItemDetail,
  ApproveIn,
  approve_api_v1_inbox__item_id__approve_post_Body,
  RunTrigger,
  RunStatus,
  AgentMode,
  PlannerKind,
  PolicyVerdict,
  StepStatus,
  RunStep,
  Usage,
  Run,
  RuleOrigin,
  RuleScope,
  RuleMode,
  OutcomeMetric,
  ReversesIn,
  BaseRate,
  Rule,
  StripTile,
  NavBadges,
  Strip,
  Meta,
  ApproveOut,
  GroupApproveIn,
  GroupApproveOut,
  RejectIn,
  ItemOut,
  SnoozeIn,
  ProposalEvidence,
  ProposalState,
  RuleProposal,
  ProposalOut,
  status_,
  needs_action,
  ClaimRow,
  ClaimList,
  CoverageOut,
  AdjGroup,
  Adjustment,
  ClaimLine,
  AttachmentKind,
  AttachmentSource,
  Attachment,
  AckStage,
  AckEvent,
  ReadinessKey,
  CheckStatus,
  ReadinessCheck,
  Denial,
  DeadlineKind,
  Deadline,
  MoneyMath,
  TimelineEntry,
  HoldSubject,
  HoldReason,
  Hold,
  FileEntryKind,
  FileEntryState,
  FileEntry,
  ClaimDetail,
  TimelinePage,
  VoidIn,
  ClaimMutationOut,
  CorrectedIn,
  TriageIn,
  triage_api_v1_claims__claim_id__triage_post_Body,
  TriageOut,
  SavedView,
  ViewList,
  ViewIn,
  LedgerRow,
  HeldRow,
  NotBillableRow,
  LedgerToday,
  RuleRow,
  TierGroup,
  WeekDecisions,
  RulesOut,
  RuleChange,
  RuleChangeList,
  RulePatchIn,
  RulePatchOut,
  mode,
  max_cents,
  PreviewOut,
  PracticeSettingsIn,
  PracticeSettingsOut,
  ProposalList,
  ActivityRow,
  ActivitySummary,
  ActivityOut,
  PlannedProcedure,
  EligibilityStatus,
  EligibilityRow,
  EligibilityOut,
  FrequencyRow,
  BenefitsPanel,
  Kpi,
  AgingBucket,
  Breakdown,
  AgentImpact,
  CashOut,
  NextAction,
  DenialRow,
  DenialGroup,
  DenialsOut,
  RemitKind,
  DepositStatus,
  LineMatch,
  RemitLine,
  RemitStatus,
  Remittance,
  RemittanceList,
  PatientBalanceRow,
  PatientBalances,
  Advancing,
  ClockOut,
  AdvanceIn,
  AdvanceAccepted,
  EventFired,
  AdvanceOut,
  ReseedOut,
  RunList,
  RunDetail,
  AgentsStatus,
  ReseedIn,
  world_reseed_api_v1__world_reseed_post_Body,
  WorldPayer,
  InjectIn,
  InjectOut,
}
