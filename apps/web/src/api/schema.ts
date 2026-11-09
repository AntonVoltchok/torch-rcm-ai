/**
 * Wire contract (Zod). Every HTTP shape comes from src/api/generated.ts, which `pnpm gen:api` writes from
 * apps/api/openapi.snapshot.json: this file only names those schemas for the app. Objects are `.strict()`, so a
 * field the API adds or renames fails the parse loudly (`schema_mismatch`) instead of rendering empty.
 *
 * Hand-written below, each with its reason: what OpenAPI cannot describe (SSE payloads, the error envelope, a query
 * enum the API leaves as a string) and the client-side RunView. Snake_case field names, integer cents, enums verbatim.
 *
 * Strictness follows how a failure shows (ADR-0005): a REST mismatch is loud, an SSE mismatch is a silently dropped frame.
 */
import { z } from 'zod'
import { schemas } from './generated'

export const {
  AckEvent,
  AckStage,
  ActivityOut,
  ActivityRow,
  ActivitySummary,
  AgentImpact,
  AgentKind,
  AgentMode,
  AgentsStatus,
  AgingBucket,
  Attachment,
  BenefitsPanel,
  Breakdown,
  CheckStatus,
  ClaimDetail,
  ClaimLine,
  ClaimList,
  ClaimMove,
  ClaimOutcome,
  ClaimRow,
  ClaimStatus,
  ClaimSummary,
  Confidence,
  CoverageOut,
  Deadline,
  Denial,
  DenialGroup,
  DenialMatrix,
  DenialMatrixCell,
  DenialMatrixRow,
  DenialReasonColumn,
  DenialRow,
  DenialsOut,
  EligibilityOut,
  EligibilityRow,
  EligibilityStatus,
  EventFired,
  Evidence,
  EvidenceKind,
  FileEntry,
  FrequencyRow,
  HeldRow,
  Hold,
  HoldReason,
  HoldWindow,
  HolderCount,
  InboxGroup,
  InboxItemDetail,
  InboxItemKind,
  InboxItemState,
  InboxList,
  Kpi,
  Learnable,
  LedgerRow,
  MoneyMath,
  MoveCount,
  MoveWho,
  NextAction,
  NotBillableRow,
  OutcomeMetric,
  PatientRef,
  PayerKey,
  PayerRef,
  PlannedProcedure,
  PlannerKind,
  PolicyVerdict,
  ProposalList,
  ProposedAction,
  ReadinessCheck,
  ReversesIn,
  Role,
  RootCause,
  Rule,
  RuleChange,
  RuleChangeList,
  RuleDigest,
  LedgerFile,
  LedgerTotals,
  EligibilityDay,
  ActivityDay,
  RuleMode,
  RuleProposal,
  RuleRow,
  RuleScope,
  RulesOut,
  Run,
  RunDetail,
  RunStatus,
  RunStep,
  SavedView,
  StatusCount,
  StripChange,
  Tier,
  TierGroup,
  TimelineEntry,
  ViewList,
  WorldPayer,
} = schemas

// The app's names for the API's `*Out` / `*In` models.
export const StripSummary = schemas.Strip
export const InboxItem = schemas.InboxItemOut
export const MutationMeta = schemas.Meta
export const ApproveResponse = schemas.ApproveOut
export const ApproveGroupResponse = schemas.GroupApproveOut
export const ItemResponse = schemas.ItemOut
export const CorrectedClaimResponse = schemas.ClaimMutationOut
export const TriageAccepted = schemas.TriageOut
export const ProposalResponse = schemas.ProposalOut
export const RulePatchResponse = schemas.RulePatchOut
export const PracticeSettings = schemas.PracticeSettingsOut
export const Preview = schemas.PreviewOut
export const Clock = schemas.ClockOut
export const ClockAdvanceAccepted = schemas.AdvanceAccepted
export const ClockReset = schemas.ReseedOut
export const Ledger = schemas.LedgerToday
export const CashSummary = schemas.CashOut
export const RunStepStatus = schemas.StepStatus
/** The API's rule action enum. */
export const ActionKind = schemas.RuleAction

export const CLAIM_STATUSES = ClaimStatus.options

export type AckEvent = z.infer<typeof AckEvent>
export type AckStage = z.infer<typeof AckStage>
export type ActionKind = z.infer<typeof ActionKind>
export type ActivityOut = z.infer<typeof ActivityOut>
export type ActivityRow = z.infer<typeof ActivityRow>
export type ActivitySummary = z.infer<typeof ActivitySummary>
export type AgentKind = z.infer<typeof AgentKind>
export type AgentMode = z.infer<typeof AgentMode>
export type AgentsStatus = z.infer<typeof AgentsStatus>
export type AgingBucket = z.infer<typeof AgingBucket>
export type Attachment = z.infer<typeof Attachment>
export type BenefitsPanel = z.infer<typeof BenefitsPanel>
export type Breakdown = z.infer<typeof Breakdown>
export type CashSummary = z.infer<typeof CashSummary>
export type CheckStatus = z.infer<typeof CheckStatus>
export type ClaimDetail = z.infer<typeof ClaimDetail>
export type ClaimLine = z.infer<typeof ClaimLine>
export type ClaimList = z.infer<typeof ClaimList>
export type ClaimMove = z.infer<typeof ClaimMove>
export type ClaimOutcome = z.infer<typeof ClaimOutcome>
export type ClaimRow = z.infer<typeof ClaimRow>
export type ClaimStatus = z.infer<typeof ClaimStatus>
export type ClaimSummary = z.infer<typeof ClaimSummary>
export type Clock = z.infer<typeof Clock>
export type Confidence = z.infer<typeof Confidence>
export type CoverageOut = z.infer<typeof CoverageOut>
export type Deadline = z.infer<typeof Deadline>
export type Denial = z.infer<typeof Denial>
export type DenialGroup = z.infer<typeof DenialGroup>
export type DenialMatrix = z.infer<typeof DenialMatrix>
export type DenialMatrixCell = z.infer<typeof DenialMatrixCell>
export type DenialMatrixRow = z.infer<typeof DenialMatrixRow>
export type DenialReasonColumn = z.infer<typeof DenialReasonColumn>
export type DenialReason = DenialReasonColumn['key']
export type DenialRow = z.infer<typeof DenialRow>
export type DenialsOut = z.infer<typeof DenialsOut>
export type EligibilityOut = z.infer<typeof EligibilityOut>
export type EligibilityRow = z.infer<typeof EligibilityRow>
export type EligibilityStatus = z.infer<typeof EligibilityStatus>
export type EventFired = z.infer<typeof EventFired>
export type Evidence = z.infer<typeof Evidence>
export type EvidenceKind = z.infer<typeof EvidenceKind>
export type FileEntry = z.infer<typeof FileEntry>
export type FrequencyRow = z.infer<typeof FrequencyRow>
export type HeldRow = z.infer<typeof HeldRow>
export type Hold = z.infer<typeof Hold>
export type HoldReason = z.infer<typeof HoldReason>
export type HoldWindow = z.infer<typeof HoldWindow>
export type HolderCount = z.infer<typeof HolderCount>
export type InboxGroup = z.infer<typeof InboxGroup>
export type InboxItem = z.infer<typeof InboxItem>
export type InboxItemDetail = z.infer<typeof InboxItemDetail>
export type InboxItemKind = z.infer<typeof InboxItemKind>
export type InboxItemState = z.infer<typeof InboxItemState>
export type InboxList = z.infer<typeof InboxList>
export type Kpi = z.infer<typeof Kpi>
export type Learnable = z.infer<typeof Learnable>
export type Ledger = z.infer<typeof Ledger>
export type LedgerRow = z.infer<typeof LedgerRow>
export type MoneyMath = z.infer<typeof MoneyMath>
export type MoveCount = z.infer<typeof MoveCount>
export type MoveWho = z.infer<typeof MoveWho>
export type NextAction = z.infer<typeof NextAction>
export type NotBillableRow = z.infer<typeof NotBillableRow>
export type OutcomeMetric = z.infer<typeof OutcomeMetric>
export type PatientRef = z.infer<typeof PatientRef>
export type PayerKey = z.infer<typeof PayerKey>
export type PayerRef = z.infer<typeof PayerRef>
export type PlannedProcedure = z.infer<typeof PlannedProcedure>
export type PlannerKind = z.infer<typeof PlannerKind>
export type PolicyVerdict = z.infer<typeof PolicyVerdict>
export type Preview = z.infer<typeof Preview>
export type ProposedAction = z.infer<typeof ProposedAction>
export type ReadinessCheck = z.infer<typeof ReadinessCheck>
export type ReversesIn = z.infer<typeof ReversesIn>
export type Role = z.infer<typeof Role>
export type RootCause = z.infer<typeof RootCause>
export type Rule = z.infer<typeof Rule>
export type RuleChange = z.infer<typeof RuleChange>
export type RuleDigest = z.infer<typeof RuleDigest>
export type LedgerFile = z.infer<typeof LedgerFile>
export type LedgerTotals = z.infer<typeof LedgerTotals>
export type EligibilityDay = z.infer<typeof EligibilityDay>
export type ActivityDay = z.infer<typeof ActivityDay>
export type RuleMode = z.infer<typeof RuleMode>
export type RulePatch = z.infer<typeof schemas.RulePatchIn>
export type RuleProposal = z.infer<typeof RuleProposal>
export type RuleRow = z.infer<typeof RuleRow>
export type RuleScope = z.infer<typeof RuleScope>
export type RulesOut = z.infer<typeof RulesOut>
export type Run = z.infer<typeof Run>
export type RunDetail = z.infer<typeof RunDetail>
export type RunStatus = z.infer<typeof RunStatus>
export type RunStep = z.infer<typeof RunStep>
export type RunStepStatus = z.infer<typeof RunStepStatus>
export type SavedView = z.infer<typeof SavedView>
export type StatusCount = z.infer<typeof StatusCount>
export type StripChange = z.infer<typeof StripChange>
export type StripSummary = z.infer<typeof StripSummary>
export type StripTile = StripSummary['tiles'][number]
export type Tier = z.infer<typeof Tier>
export type TierGroup = z.infer<typeof TierGroup>
export type TimelineEntry = z.infer<typeof TimelineEntry>
export type WorldPayer = z.infer<typeof WorldPayer>

/** GET /activity?outcome: the API takes a free string, so OpenAPI has no enum to generate. */
export const ActivityOutcome = z.enum(['ran', 'awaiting', 'would_have_run'])
export type ActivityOutcome = z.infer<typeof ActivityOutcome>

// ── Client-side view of a run ────────────────────────────────────────────────
/** What SSE knows about a piece of evidence until the snapshot hydrates it: `{id, kind, title}`. */
export const RunEvidenceRef = z.object({ id: z.string(), kind: EvidenceKind, title: z.string() })
export type RunEvidenceRef = z.infer<typeof RunEvidenceRef>
export type RunViewEvidence = RunEvidenceRef & Partial<Evidence>

/** A step with the lists Pydantic always sends (OpenAPI marks `default_factory` fields optional). */
export type RunViewStep = Omit<RunStep, 'progress_lines' | 'evidence_ids'> & { progress_lines: string[]; evidence_ids: string[] }

/**
 * What ['run', id] caches: the API's Run with RunDetail's evidence and cursor folded in, so the SSE reducer
 * patches one object. Built only by `runViewOf` (lib/runEvents.ts) from a RunDetail or a mutation's Run.
 */
export type RunView = Omit<Run, 'steps'> & { steps: RunViewStep[]; evidence: RunViewEvidence[]; last_event_id: number | null }

// ── SSE: FastAPI documents these routes as a bare 200, so their payloads are not in OpenAPI ───────────────
// Mirrors of agents/runtime.py `step_event` / `done_event` and executor `_status_event`. Deliberately not strict:
// a frame that fails to parse is dropped, and an extra field must not stall the ProgressPanel.

/** `event: step` on GET /runs/{id}/events. Seeded runs replay stored steps with `phase` = the step's status. */
export const RunStepEvent = z.object({
  idx: z.number().int(),
  name: z.string(),
  label: z.string().nullish(),
  phase: z.string().nullish(),
  status: RunStepStatus,
  output_summary: z.string().nullish(),
  progress_line: z.string().nullish(),
  progress_lines: z.array(z.string()).nullish(),
  policy_verdict: PolicyVerdict.nullish(),
  evidence_ids: z.array(z.string()).nullish(),
  evidence: z.array(RunEvidenceRef).nullish(),
  model_situation_label: z.string().nullish(),
  planner: PlannerKind.nullish(),
})
export type RunStepEvent = z.infer<typeof RunStepEvent>

/** `event: status`; a cancel publishes `{status}` alone. */
export const RunStatusEvent = z.object({ status: RunStatus, planner: PlannerKind.nullish() })

/** `event: done`. The closing frame of a stream carries `{run_id}` alone, so the status is optional. */
export const RunDoneEvent = z.object({
  status: RunStatus.nullish(),
  audit_line: z.string().nullish(),
  result_summary: z.string().nullish(),
  model_situation_label: z.string().nullish(),
  planner: PlannerKind.nullish(),
})

/** `event: status` on GET /runs/stream: every run's status changes, on one channel. */
export const FirehoseStatusEvent = z.object({
  run_id: z.string(),
  agent: AgentKind.nullish(),
  status: RunStatus,
  claim_id: z.string().nullish(),
  planner: PlannerKind.nullish(),
})
export const FirehoseAgentsEvent = z.object({ paused: z.boolean(), by: z.string().nullish(), at: z.string().nullish() })

/** GET /clock/advance/{id}. */
export const AdvanceOut = schemas.AdvanceOut

/**
 * `event: advance` on the firehose. It and the poll both land in ['advance', id]. It sends `events_fired` as a count while
 * running, the list on `done`, and none of the poll-only fields. Lenient like every frame here, and more so: this frame
 * is what ends an advance, and polling is off while the firehose is live, so dropping it would spin the sidebar forever.
 */
export const AdvanceSnapshot = schemas.AdvanceOut.omit({ meta: true })
  .partial({ state: true, from: true, to: true, skipped_unhandled: true, error: true })
  .extend({ events_fired: z.union([z.number().int(), z.array(z.unknown())]) })
  .strip()
export type AdvanceSnapshot = z.infer<typeof AdvanceSnapshot>

/** The API's exception handlers write this envelope; FastAPI's OpenAPI only knows its default 422 body. */
export const ErrorEnvelope = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).nullish() }),
  alternatives: z.array(z.string()).nullish(),
})
