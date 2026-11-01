"""Shared vocabulary of the agent runtime: enums from 01-domain-model and the value objects that flow
between case builder, planner, policy, executor and run store.

Principle: the model proposes; code gates and executes. Nothing here carries a confidence, tier, root
cause or amount that a model produced: those fields are filled by code (`policy`, `catalog`, `case`).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

type JsonValue = str | int | float | bool | None | list[JsonValue] | dict[str, JsonValue]

AgentKind = Literal["eligibility", "claims", "followup", "appeals", "posting"]
AGENT_KINDS: tuple[AgentKind, ...] = ("eligibility", "claims", "followup", "appeals", "posting")
Tier = Literal[1, 2, 3]
RuleMode = Literal["observe", "ask", "auto", "human_only"]
Verdict = Literal["observe", "propose", "execute", "refuse", "park"]
PlannerKind = Literal["live", "scripted", "recorded_plan", "scripted_fallback"]
AgentMode = Literal["deterministic", "live"]
RunStatus = Literal["queued", "running", "paused", "succeeded", "failed", "cancelled", "would_have_run"]
StepStatus = Literal["pending", "running", "ok", "failed", "skipped"]
Trigger = Literal["rule", "approval", "schedule", "manual"]
RootCause = Literal["ours", "payer", "patient", "unknown"]
DeadlineKind = Literal["timely_filing", "appeal", "none"]
EvidenceKind = Literal[
    "portal_screenshot",
    "ivr_transcript",
    "rep_call",
    "era_line",
    "eob_pdf",
    "pms_record",
    "nea_attachment",
    "policy_clause",
    "prior_eob",
    "note_excerpt",
]
PayerKey = Literal["delta_ny", "metlife", "cigna", "aetna", "guardian", "ny_medicaid"]
Role = Literal["owner", "billing", "dentist", "front_desk"]
InboxItemKind = Literal[
    "approve_action",
    "review_draft",
    "eligibility_flag",
    "variance",
    "run_failed",
    "rule_proposal",
    "owner_signoff",
]
OutcomeMetric = Literal["paid_30d", "accepted", "balanced", "none"]
ReversesIn = Literal["until_file_leaves", "until_day_close", "void_only", "none"]
DraftKind = Literal["claim_narrative", "reconsideration_note", "appeal_letter"]
FactType = Literal["clinical", "financial", "administrative", "none"]
ResultOutcome = Literal["executed", "sent_to_person", "observed", "no_action_needed", "cannot_decide"]
HoldReason = Literal[
    "note_unsigned",
    "procs_not_in_note",
    "rendering_mismatch",
    "awaiting_primary_eob",
    "missing_image",
    "subscriber_id_invalid",
    "other_documented",
]
SubjectKind = Literal["claim", "appointment", "remittance", "patient"]
ThinkingType = Literal["disabled", "between_tools", "adaptive"]
Effort = Literal["low", "medium", "high"]
SseEventName = Literal["step", "status", "counts", "advance", "done", "agents"]
StepPhase = Literal["started", "progress", "completed", "failed"]

UNKNOWN: str = "unknown"


class Frozen(BaseModel):
    """Immutable value object; unknown fields are an error, not silently dropped."""

    model_config = ConfigDict(frozen=True, extra="forbid")


# ---------------------------------------------------------------- case views (read models, code facts)


class Subject(Frozen):
    kind: SubjectKind
    id: str


class ClaimLineView(Frozen):
    id: str
    cdt: str
    tooth: str | None = None
    surface: str | None = None
    fee_cents: int


class DenialView(Frozen):
    group: Literal["CO", "PR", "OA"]
    carc: str
    rarc: str | None
    line_id: str | None
    decoded: str
    remittance_id: str | None = None
    denied_on: date | None = None


class AttachmentView(Frozen):
    id: str
    kind: str
    source: Literal["pms_imaging", "agent", "user"]
    image_id: str | None = None
    nea_number: str | None = None
    created_at: datetime


class ClaimView(Frozen):
    id: str
    number: int
    patient_id: str
    visit_id: str
    coverage_id: str
    payer_key: PayerKey
    status: str
    dos: date
    billed_cents: int
    sent_at: datetime | None = None
    icn: str | None = None
    rendering_provider_id: str | None = None
    lines: tuple[ClaimLineView, ...] = ()
    attachments: tuple[AttachmentView, ...] = ()
    denial: DenialView | None = None
    timely_filing_due: date | None = None
    status_category: str | None = None  # structured 277 category from the last status check, if any
    has_free_text_status: bool = False  # payer correspondence on file that maps to no structured category
    location_id: str | None = None


class PriorProcedureView(Frozen):
    """A procedure from the patient's PMS history (code fact; the note text itself is read by a tool)."""

    visit_id: str
    dos: date
    cdt: str
    tooth: str | None = None
    note_signed: bool = False


class PatientView(Frozen):
    id: str
    first: str
    last: str

    @property
    def display(self) -> str:
        return f"{self.first[:1]}. {self.last}"


class CoverageView(Frozen):
    id: str
    patient_id: str
    payer_key: PayerKey
    order: Literal["primary", "secondary"]
    subscriber_id: str
    group_no: str
    plan_type: Literal["ppo", "self_funded_erisa", "medicaid"] = "ppo"
    missing_tooth_clause: bool = False
    verified_at: datetime | None = None
    verified_via: str | None = None


class PayerView(Frozen):
    key: PayerKey
    name: str
    short: str
    file_times: tuple[str, ...] = ()
    appeal_window_days: int = 180
    timely_filing_days: int = 365


class PayerRuleView(Frozen):
    id: str
    payer_key: PayerKey
    topic: str
    cdt_prefixes: tuple[str, ...]
    text: str
    requires_attachment: str | None = None


class DeadlineView(Frozen):
    kind: DeadlineKind
    due_on: date | None
    basis: str


class BaseRate(Frozen):
    n: int
    k: int


class RuleScope(Frozen):
    payer_key: PayerKey | None = None
    item_type: str = "all"
    max_cents: int | None = None


class RuleView(Frozen):
    """A row of the practice's rules table (Settings › Agents)."""

    id: str
    version: int
    origin: Literal["authored", "learned"] = "authored"
    tier: Tier
    action: str
    label: str
    scope: RuleScope = RuleScope()
    mode: RuleMode
    confidence_floor: float | None = None
    outcome_metric: OutcomeMetric | None = None
    reverses_in: ReversesIn = "none"
    requires_owner_signoff: bool = False
    signed_by: str | None = None
    signed_at: datetime | None = None
    base_rate: BaseRate | None = None
    covers_agent_text: bool = False


class Evidence(Frozen):
    id: str
    kind: EvidenceKind
    title: str
    excerpt: str
    captured_at: datetime
    reference: str | None = None
    uri: str | None = None
    source: str = "torch"
    untrusted: bool = False
    suspicious: bool = False
    gathered_by: Literal["agent", "code"] = "code"
    run_id: str | None = None
    step_idx: int | None = None
    claim_id: str | None = None
    world_call_id: str | None = None
    data: dict[str, JsonValue] = Field(default_factory=dict)


class EvidenceCandidate(Frozen):
    """What a world call produced, before the run assigns it a deterministic id."""

    kind: EvidenceKind
    title: str
    excerpt: str
    captured_at: datetime
    reference: str | None = None
    source: str = "torch"
    untrusted: bool = False
    world_call_id: str | None = None
    data: dict[str, JsonValue] = Field(default_factory=dict)


class Provenance(Frozen):
    """One record of what Torch sent on this claim (WorldCallLog-derived), used for root cause."""

    actor: Literal["agent", "user", "pms"]
    what: str
    attachment_kind: str | None = None
    attachment_date: date | None = None
    at: datetime


class CaseFile(Frozen):
    """Everything code knows about the subject before any planner runs. Code facts only."""

    run_id: str
    practice_id: str
    agent: AgentKind
    subject: Subject
    now: datetime
    claim: ClaimView | None = None
    patient: PatientView | None = None
    coverages: tuple[CoverageView, ...] = ()
    payer: PayerView | None = None
    denial: DenialView | None = None
    root_cause: RootCause = "unknown"
    deadlines: tuple[DeadlineView, ...] = ()
    payer_rules: tuple[PayerRuleView, ...] = ()
    rules_snapshot: tuple[RuleView, ...] = ()
    evidence: tuple[Evidence, ...] = ()
    classifier_situation: str = UNKNOWN
    item_type: str = "all"
    related_ids: tuple[str, ...] = ()  # visit, image, coverage, remittance ids the subject owns
    prior_procedures: tuple[PriorProcedureView, ...] = ()
    trigger_kind: str = "manual"
    expected_values: dict[str, JsonValue] = Field(default_factory=dict)  # "pms.subscriber_id" → value
    rendering_dentist_id: str | None = None
    self_funded: bool = False
    paper_eob: bool = False
    cents: int = 0  # the subject's amount (claim billed, remittance total): policy caps compare against it

    def evidence_of(self, *kinds: EvidenceKind) -> list[Evidence]:
        return [e for e in self.evidence if e.kind in kinds]

    def evidence_ids(self, *kinds: EvidenceKind) -> list[str]:
        return [e.id for e in self.evidence_of(*kinds)]

    @property
    def subject_ids(self) -> frozenset[str]:
        ids = {self.subject.id, *self.related_ids}
        if self.claim:
            ids |= {self.claim.id, self.claim.patient_id, self.claim.visit_id, self.claim.coverage_id}
        if self.patient:
            ids.add(self.patient.id)
        ids |= {c.id for c in self.coverages}
        return frozenset(ids)


# ---------------------------------------------------------------- plans, decisions, drafts


class ReadCall(Frozen):
    tool: str
    args: dict[str, JsonValue]


class ProposedAction(Frozen):
    action: str
    params: dict[str, JsonValue] = Field(default_factory=dict)
    evidence_ids: tuple[str, ...] = ()
    rationale: str = ""


class Plan(Frozen):
    situation_key: str
    situation_description: str | None = None
    actions: tuple[ProposedAction, ...] = ()
    no_action_reason: str | None = None
    reviewer_summary: str
    planner: PlannerKind
    fallback_reason: str | None = None
    injection_suspected: bool = False
    reads: tuple[ReadCall, ...] = ()


class Confidence(Frozen):
    pct: int | None
    basis: str


class Decision(Frozen):
    verdict: Verdict
    reason: str
    policy_row: int
    rule_id: str | None = None
    rule_version: int | None = None
    confidence: Confidence | None = None
    as_review_draft: bool = False
    alternatives: tuple[str, ...] = ()


class DraftSegment(Frozen):
    text: str
    fact_type: FactType
    evidence_ids: tuple[str, ...] = ()


class Draft(Frozen):
    kind: DraftKind
    audience: Literal["payer", "patient"]
    segments: tuple[DraftSegment, ...]
    human_must_complete: tuple[str, ...] = ()
    source: Literal["agent", "template"] = "template"
    flagged: str | None = None

    @property
    def text(self) -> str:
        return " ".join(s.text for s in self.segments)


class GuardResult(Frozen):
    ok: bool
    errors: tuple[str, ...] = ()


class StepResult(Frozen):
    step: str
    status: StepStatus
    summary: str
    data: dict[str, JsonValue] = Field(default_factory=dict)


class RunOutcome(Frozen):
    plan: Plan
    decisions: tuple[Decision, ...]
    step_results: tuple[StepResult, ...]
    inbox_item_ids: tuple[str, ...] = ()


class ResultText(Frozen):
    outcome: ResultOutcome
    recommendation: str
    explanation: str
    evidence_ids: tuple[str, ...] = ()
    injection_suspected: bool = False


# ---------------------------------------------------------------- runs


class Pin(Frozen):
    """What a saved conversation is bound to; a mismatch discards it (thinking blocks would 400)."""

    model: str
    effort: str | None
    thinking: str
    system_sha: str
    tools_sha: str


class Usage(BaseModel):
    model_calls: int = 0
    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_write: int = 0
    cost_usd_micros: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input + self.output + self.cache_read + self.cache_write

    def add(self, other: Usage) -> None:
        self.model_calls += other.model_calls
        self.input += other.input
        self.output += other.output
        self.cache_read += other.cache_read
        self.cache_write += other.cache_write
        self.cost_usd_micros += other.cost_usd_micros


class InboxItemDraft(Frozen):
    """What a run asks the domain to open; exactly one open item per (claim_id, action)."""

    kind: InboxItemKind
    agent: AgentKind
    title: str
    recommendation: str
    explanation: str = ""
    tier: Tier | None = None
    claim_id: str | None = None
    patient_id: str | None = None
    appointment_id: str | None = None
    confidence: Confidence | None = None
    evidence_ids: tuple[str, ...] = ()
    proposed_action: ProposedAction | None = None
    group_key: str | None = None
    run_id: str | None = None
    assignee_role: Role = "billing"
    draft: Draft | None = None
    alternatives: tuple[str, ...] = ()


class HoldDraft(Frozen):
    subject: Literal["claim", "patient_balance"]
    subject_id: str
    reason: HoldReason
    clears_when: str
    run_id: str
