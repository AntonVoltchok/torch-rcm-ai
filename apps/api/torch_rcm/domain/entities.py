"""The entity set (01-domain-model "Entities"). One pydantic model per entity; the API schemas, the seed, the
world simulation and persistence all use these classes.

Persistence (torch_rcm/db/store.py) stores each entity as a JSON document in its own SQLite table and exposes the
fields named in `__indexed__` as generated, indexed columns for filtering and sorting.

Conventions: ids are deterministic strings (`clm_4821`); money is integer cents; datetimes are timezone-aware
(practice time, America/New_York); `needs_action` is never stored (see torch_rcm/domain/derived.py).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, ClassVar

from pydantic import BaseModel, ConfigDict, Field

from torch_rcm.domain.enums import (
    AckStage,
    AdvanceState,
    AgentKind,
    AgentMode,
    AppealKind,
    AttachmentKind,
    AttachmentSource,
    ClaimStatus,
    ClosedReason,
    ContactPref,
    CoverageOrder,
    DeadlineKind,
    DepositStatus,
    EligibilityStatus,
    EvidenceKind,
    FileEntryKind,
    FileEntryState,
    GatheredBy,
    HoldReason,
    HoldSubject,
    ImageKind,
    InboxItemKind,
    InboxItemState,
    JobState,
    LedgerEntryKind,
    LineMatch,
    OutcomeMetric,
    PayerKey,
    PayerType,
    PlannerKind,
    PolicyVerdict,
    ProposalState,
    ProviderType,
    RemitKind,
    RemitStatus,
    ReversesIn,
    Role,
    RuleAction,
    RuleMode,
    RuleOrigin,
    RunStatus,
    RunTrigger,
    StepStatus,
    Tier,
    VerifiedVia,
)
from torch_rcm.domain.values import (
    Adjustment,
    BaseRate,
    ClaimOutcome,
    Confidence,
    Deadline,
    Denial,
    PlanBenefits,
    ProposalEvidence,
    ProposedAction,
    ReadinessCheck,
    RuleScope,
    Usage,
)


class Entity(BaseModel):
    """Base for persisted entities. `__table__` names the SQLite table; `__indexed__` lists filterable fields."""

    model_config = ConfigDict(extra="forbid", validate_assignment=False)

    __table__: ClassVar[str] = ""
    __indexed__: ClassVar[tuple[str, ...]] = ()
    __unique__: ClassVar[tuple[str, ...]] = ()

    id: str


# ── practice, people ────────────────────────────────────────────────────────────────────────────────────────


class Practice(Entity):
    __table__ = "practices"
    name: str
    location_ids: list[str]
    state: str = "NY"
    timezone: str = "America/New_York"
    prompt_pay_days_electronic: int = 30
    prompt_pay_days_paper: int = 45
    practice_cap_cents: int = 100_000  # tier-2 cap ($1,000); tier 1 is exempt
    observe_until: date | None = None
    agents_paused: bool = False
    agents_paused_by: str | None = None
    agents_paused_at: datetime | None = None


class Location(Entity):
    __table__ = "locations"
    practice_id: str
    name: str


class User(Entity):
    __table__ = "users"
    __indexed__ = ("role",)
    name: str
    role: Role
    location_ids: list[str]
    npi: str | None = None
    title: str = ""


class Provider(Entity):
    __table__ = "providers"
    user_id: str | None
    name: str
    npi: str
    type: ProviderType


class Payer(Entity):
    """Static payer profile as the practice sees it. Behaviour lives in torch_rcm/world/payers/profiles.py."""

    __table__ = "payers"
    key: PayerKey
    name: str
    short_name: str
    payer_id: str
    type: PayerType
    timely_filing_days: int
    appeal_window_days: int
    appeal_levels: int
    file_times: list[str]
    era_weekdays: list[int]  # 0 = Monday
    rules: list[str] = Field(default_factory=list)


class Patient(Entity):
    __table__ = "patients"
    __indexed__ = ("location_id", "last")
    first: str
    last: str
    dob: date
    guarantor_id: str | None = None
    contact_pref: ContactPref = ContactPref.TEXT
    location_id: str

    @property
    def display_name(self) -> str:
        return f"{self.first[:1]}. {self.last}"


class Coverage(Entity):
    __table__ = "coverages"
    __indexed__ = ("patient_id", "payer_key")
    patient_id: str
    payer_key: PayerKey
    plan_name: str
    subscriber_id: str
    group_no: str
    order: CoverageOrder
    self_funded: bool = False
    plan: PlanBenefits
    verified_at: datetime | None = None
    verified_via: VerifiedVia | None = None


# ── schedule, visits, imaging ──────────────────────────────────────────────────────────────────────────────


class PlannedProcedure(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cdt: str
    tooth: str | None = None
    fee_cents: int


class Appointment(Entity):
    __table__ = "appointments"
    __indexed__ = ("patient_id", "start", "location_id")
    patient_id: str
    provider_id: str
    location_id: str
    start: datetime
    planned_procedures: list[PlannedProcedure]
    eligibility_status: EligibilityStatus = EligibilityStatus.UNVERIFIED
    eligibility_note: str | None = None
    checkout_at: datetime | None = None  # simulated PMS checkout (visit.checked_out fires here)


class Visit(Entity):
    __table__ = "visits"
    __indexed__ = ("patient_id", "dos", "location_id")
    appointment_id: str | None
    patient_id: str
    provider_id: str
    location_id: str
    dos: date
    completed_at: datetime
    note_text: str = ""
    note_signed_by: str | None = None
    note_signed_at: datetime | None = None
    self_pay: bool = False


class ProcedureLine(Entity):
    __table__ = "procedure_lines"
    __indexed__ = ("visit_id", "dos")
    visit_id: str
    dos: date
    cdt: str
    tooth: str | None = None
    surface: str | None = None
    quadrant: str | None = None
    fee_cents: int
    provider_id: str


class Image(Entity):
    """PMS imaging record. `kind` is what the PMS has it labelled as (it can be wrong)."""

    __table__ = "images"
    __indexed__ = ("patient_id",)
    patient_id: str
    kind: ImageKind
    tooth: str | None
    taken_at: datetime
    cdt: str | None = None
    films: int = 1


# ── claims ─────────────────────────────────────────────────────────────────────────────────────────────────


class ClaimLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    cdt: str
    tooth: str | None = None
    surface: str | None = None
    fee_cents: int
    #: Contract allowed for this plan (known at checkout from the fee schedule; updated from the 835).
    allowed_cents: int | None = None
    paid_cents: int | None = None
    adj: list[Adjustment] = Field(default_factory=list)
    patient_adj: list[Adjustment] = Field(default_factory=list)
    patient_cents: int | None = None
    procedure_line_id: str | None = None


class Attachment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: AttachmentKind
    nea_number: str | None = None
    source: AttachmentSource
    image_id: str | None = None
    created_at: datetime
    note: str | None = None


class Claim(Entity):
    __table__ = "claims"
    __indexed__ = (
        "number",
        "patient_id",
        "payer_key",
        "status",
        "provider_id",
        "location_id",
        "dos",
        "sent_at",
        "billed_cents",
        "closed_reason",
        "paid_at",
    )
    number: int
    visit_id: str | None
    patient_id: str
    coverage_id: str
    payer_key: PayerKey
    provider_id: str
    location_id: str
    status: ClaimStatus
    dos: date
    built_at: datetime
    sent_at: datetime | None = None
    file_time: datetime | None = None  # the payer file the claim left (or will leave) in
    icn: str | None = None
    ack_stage: AckStage = AckStage.NONE
    billed_cents: int
    allowed_cents: int | None = None
    paid_cents: int | None = None
    writeoff_cents: int | None = None
    patient_resp_cents: int | None = None
    paid_at: datetime | None = None
    denial: Denial | None = None
    deadline: Deadline = Field(default_factory=lambda: Deadline(kind=DeadlineKind.NONE, due_on=None, basis=""))
    parent_claim_id: str | None = None
    frequency_code: int | None = 1
    readiness: list[ReadinessCheck] = Field(default_factory=list)
    timely_filing_due: date | None = None
    lines: list[ClaimLine]
    attachments: list[Attachment] = Field(default_factory=list)
    in_flight: str | None = None  # e.g. "records sent 10/28 · awaiting reprocessing"
    reason_text: str | None = None  # CARC·RARC or reject reason shown in tables
    closed_reason: ClosedReason | None = None
    closed_at: datetime | None = None
    secondary: bool = False

    @property
    def procedures_summary(self) -> str:
        first = self.lines[0]
        head = f"{first.cdt} #{first.tooth}" if first.tooth else first.cdt
        extra = len(self.lines) - 1
        return f"{head} +{extra}" if extra else head


class AckEvent(Entity):
    __table__ = "ack_events"
    __indexed__ = ("claim_id", "at")
    claim_id: str
    stage: AckStage
    code: str | None = None
    message: str
    at: datetime
    source: str = "vyne"  # vyne | payer


class FileEntry(Entity):
    """A claim queued for (or sent in) a payer's scheduled file — the hold window lives here."""

    __table__ = "file_entries"
    __indexed__ = ("claim_id", "payer_key", "file_time", "state")
    claim_id: str
    payer_key: PayerKey
    file_time: datetime
    kind: FileEntryKind
    state: FileEntryState
    queued_at: datetime
    queued_by: str  # run id or user id
    departed_at: datetime | None = None
    remarks: str | None = None


class Hold(Entity):
    __table__ = "holds"
    __indexed__ = ("subject_id", "cleared_at")
    subject: HoldSubject
    subject_id: str
    reason: HoldReason
    detail: str
    held_since: datetime
    clears_when: str
    owner_user_id: str | None
    timely_due: date | None = None
    cleared_at: datetime | None = None


# ── remittances ────────────────────────────────────────────────────────────────────────────────────────────


class RemitLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    claim_id: str | None
    claim_line_id: str | None
    cdt: str
    billed: int
    allowed: int
    paid: int
    #: Contractual / other-payer adjustments (CO, OA). Patient responsibility is kept apart in `patient_adj`
    #: so the 01-domain-model invariant reads literally: billed = paid + Σadj + patient_cents.
    adj: list[Adjustment] = Field(default_factory=list)
    patient_adj: list[Adjustment] = Field(default_factory=list)
    patient_cents: int
    match: LineMatch = LineMatch.AUTO
    variance_cents: int | None = None
    rarc: str | None = None
    note: str | None = None


class Remittance(Entity):
    __table__ = "remittances"
    __indexed__ = ("payer_key", "received_at", "status")
    payer_key: PayerKey
    kind: RemitKind
    trace: str
    amount_cents: int
    received_at: datetime
    deposit_status: DepositStatus
    lines: list[RemitLine]
    status: RemitStatus
    check_number: str | None = None


class PatientLedgerEntry(Entity):
    __table__ = "patient_ledger"
    __indexed__ = ("patient_id", "on")
    patient_id: str
    kind: LedgerEntryKind
    cents: int  # charges/refunds positive; payments/adjustments negative
    on: date
    dos: date | None = None
    claim_id: str | None = None
    memo: str = ""


class Estimate(Entity):
    __table__ = "estimates"
    appointment_id: str
    as_of: datetime
    basis: VerifiedVia
    lines: list[PlannedProcedure]
    insurance_est_cents: int
    patient_est_cents: int
    signed_at: datetime | None = None


class Statement(Entity):
    __table__ = "statements"
    __indexed__ = ("patient_id",)
    patient_id: str
    claim_ids: list[str]
    due_on: date
    sent_via: ContactPref
    sent_at: datetime
    amount_cents: int
    disputed_cents: int = 0


class AppealRecord(Entity):
    """Historical appeal outcomes (12-month win rates in Cash/Denials)."""

    __table__ = "appeal_records"
    claim_number: int
    payer_key: PayerKey
    kind: AppealKind
    filed_on: date
    decided_on: date | None
    won: bool | None
    cents: int


# ── agents: rules, inbox, runs, evidence ───────────────────────────────────────────────────────────────────


class Rule(Entity):
    __table__ = "rules"
    __indexed__ = ("tier", "action")
    label: str
    version: int = 1
    origin: RuleOrigin = RuleOrigin.AUTHORED
    tier: Tier
    agent: AgentKind
    action: RuleAction
    scope: RuleScope = Field(default_factory=RuleScope)
    mode: RuleMode
    confidence_floor: float | None = None
    outcome_metric: OutcomeMetric = OutcomeMetric.NONE
    reverses_in: ReversesIn = ReversesIn.NONE
    requires_owner_signoff: bool = False
    signed_by: str | None = None
    signed_at: datetime | None = None
    changed_by: str
    changed_at: datetime
    base_rate: BaseRate = Field(default_factory=lambda: BaseRate(n=0, k=0))  # every past case in scope (Rules screen)
    # Past cases by classifier situation: an item's track record counts its own situation only, never the rule's
    # whole scope (Castillo's CO-16 · M127 is not the records-request rule's 91 of 97).
    situation_rates: dict[str, BaseRate] = Field(default_factory=dict)
    sort: int = 0
    description: str = ""


class RuleChange(Entity):
    __table__ = "rule_changes"
    __indexed__ = ("rule_id", "at")
    rule_id: str
    at: datetime
    by: str
    before: dict[str, Any]
    after: dict[str, Any]
    items_affected_since: int = 0
    summary: str = ""


class RuleProposal(Entity):
    __table__ = "rule_proposals"
    __indexed__ = ("state",)
    title: str
    rule_draft: dict[str, Any]
    evidence: ProposalEvidence
    root_cause_guard: bool
    state: ProposalState
    created_at: datetime
    watching: bool = False  # n = 1: shown, never acceptable
    source_item_id: str | None = None
    note: str = ""


class InboxItem(Entity):
    __table__ = "inbox_items"
    __indexed__ = ("state", "kind", "agent", "claim_id", "group_key", "assignee_user_id", "created_at")
    kind: InboxItemKind
    state: InboxItemState
    claim_id: str | None = None
    patient_id: str | None = None
    appointment_id: str | None = None
    remittance_id: str | None = None
    rule_id: str | None = None
    agent: AgentKind | None
    title: str
    summary: str = ""
    recommendation: str
    plan_steps: list[str] = Field(default_factory=list)
    confidence: Confidence | None = None
    evidence: list[str] = Field(default_factory=list)
    proposed_action: ProposedAction | None = None
    tier: Tier | None
    group_key: str | None = None
    group_title: str | None = None
    cents: int = 0
    deadline_on: date | None = None
    audit_note: str | None = None
    assignee_user_id: str | None = None  # None = the shared billing queue
    required_role: Role | None = None
    created_at: datetime
    snoozed_until: datetime | None = None
    resolved_by: str | None = None
    resolved_at: datetime | None = None
    resolution_note: str | None = None
    run_id: str | None = None
    payload: dict[str, Any] = Field(default_factory=dict)


class Evidence(Entity):
    __table__ = "evidence"
    __indexed__ = ("run_id", "claim_id")
    kind: EvidenceKind
    title: str
    excerpt: str
    uri: str | None = None
    captured_at: datetime
    reference: str | None = None
    suspicious: bool = False
    gathered_by: GatheredBy = GatheredBy.CODE
    claim_id: str | None = None
    run_id: str | None = None
    world_call_id: str | None = None
    source: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


class RunStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idx: int
    name: str
    label: str = ""
    status: StepStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None
    tool: str = ""
    input_summary: str = ""
    output_summary: str = ""
    progress_lines: list[str] = Field(default_factory=list)
    policy_verdict: PolicyVerdict | None = None
    evidence_ids: list[str] = Field(default_factory=list)


class Run(Entity):
    __table__ = "runs"
    __indexed__ = ("agent", "status", "claim_id", "inbox_item_id", "started_at", "action", "idempotency_key")
    __unique__ = ("idempotency_key",)
    agent: AgentKind
    trigger: RunTrigger
    actor: str | None = None
    rule_id: str | None = None
    rule_version: int | None = None
    inbox_item_id: str | None = None
    claim_id: str | None = None
    patient_id: str | None = None
    remittance_id: str | None = None
    parent_run_id: str | None = None
    idempotency_key: str
    status: RunStatus
    mode: AgentMode = AgentMode.DETERMINISTIC
    planner: PlannerKind = PlannerKind.SCRIPTED
    situation_key: str | None = None
    model_situation_label: str | None = None
    plan: dict[str, Any] | None = None
    action: RuleAction | None = None
    action_label: str = ""
    tier: Tier | None = None
    verdict: PolicyVerdict | None = None
    started_at: datetime
    finished_at: datetime | None = None
    steps: list[RunStep] = Field(default_factory=list)
    result_summary: str = ""
    audit_line: str = ""
    usage: Usage = Field(default_factory=Usage)
    outcome: str = ""  # Activity "Outcome" column text
    claim_outcome: ClaimOutcome | None = None  # set at a terminal status (paused is not one); None if claimless


class RunEvent(Entity):
    """Persisted SSE log (`run_events`), replayed on reconnect with Last-Event-ID."""

    __table__ = "run_events"
    __indexed__ = ("channel", "seq")
    channel: str  # run id, or "firehose"
    seq: int
    event: str
    data: dict[str, Any]
    at: datetime


ROOT_CAUSE_RECORDED = "root_cause.recorded"  # AuditEvent.action: `detail` is the finding the claim's timeline shows


class AuditEvent(Entity):
    __table__ = "audit_events"
    __indexed__ = ("subject_id", "at", "actor")
    at: datetime
    actor: str  # user id or "system" or agent kind
    action: str
    subject_type: str
    subject_id: str
    detail: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


class RunCheckpoint(Entity):
    """Agent conversation checkpoint (07-agents §8). Filled by torch_rcm.agents; id = run id."""

    __table__ = "run_checkpoints"
    model: str | None = None
    effort: str | None = None
    thinking: str | None = None
    system_sha: str | None = None
    tools_sha: str | None = None
    messages: list[dict[str, Any]] = Field(default_factory=list)
    plan: dict[str, Any] | None = None
    updated_at: datetime


class LlmCall(Entity):
    __table__ = "llm_calls"
    __indexed__ = ("run_id",)
    run_id: str
    seq: int
    model: str
    at: datetime
    purpose: str = ""  # plan | draft (07 §7)
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    stop_reason: str = ""
    latency_ms: int = 0
    cost_usd_micros: int = 0


# ── infrastructure ─────────────────────────────────────────────────────────────────────────────────────────


class Job(Entity):
    __table__ = "jobs"
    __indexed__ = ("kind", "state", "due_at", "priority", "idempotency_key", "advance_id")
    __unique__ = ("idempotency_key",)
    kind: str
    due_at: datetime
    priority: int = 50
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str
    advance_id: str | None = None
    state: JobState = JobState.QUEUED
    attempts: int = 0
    max_attempts: int = 5
    lease_owner: str | None = None
    lease_until: float | None = None  # wall-clock epoch seconds (leases protect processes, not facts)
    last_error: str | None = None
    created_at: datetime
    finished_at: datetime | None = None
    result: dict[str, Any] = Field(default_factory=dict)


class Advance(Entity):
    __table__ = "advances"
    __indexed__ = ("state",)
    from_at: datetime
    to_at: datetime
    now: datetime
    state: AdvanceState
    events_fired: list[dict[str, Any]] = Field(default_factory=list)
    runs_started: int = 0
    live_runs: int = 0
    skipped_unhandled: dict[str, int] = Field(default_factory=dict)
    error: str | None = None
    requested_by: str | None = None


class WorldCallLog(Entity):
    """Every call into the simulated world: the provenance behind Evidence and root cause."""

    __table__ = "world_calls"
    __indexed__ = ("system", "claim_id", "idempotency_key", "at", "run_id")
    __unique__ = ("idempotency_key",)
    system: str  # pms | vyne | nea | payer:<key>
    operation: str
    at: datetime
    idempotency_key: str
    run_id: str | None = None
    claim_id: str | None = None
    mutation: bool = False
    request: dict[str, Any] = Field(default_factory=dict)
    response: dict[str, Any] = Field(default_factory=dict)
    ok: bool = True
    error: str | None = None


class PayerClaim(Entity):
    """The payer's own view of a claim (world-internal; agents never read this directly). id = claim id."""

    __table__ = "payer_claims"
    __indexed__ = ("payer_key", "adjudicate_on", "state")
    payer_key: PayerKey
    icn: str
    received_on: date
    state: str  # received | in_process | adjudicated | stuck | reprocessing
    adjudicate_on: date | None
    #: Pinned outcome for the demo (e.g. "CO-50:N10"); None = adjudicate by the payer's rules.
    outcome: str | None = None
    tooth_history: dict[str, str] = Field(default_factory=dict)  # payer's (possibly wrong) tooth history
    portal_note: str | None = None


class SavedView(Entity):
    __table__ = "saved_views"
    __indexed__ = ("owner_user_id",)
    name: str
    search_params: dict[str, Any]
    owner_user_id: str | None
    created_at: datetime
    builtin: bool = False


class IdempotencyRecord(Entity):
    """A mutation's stored response, keyed `(user_id, key)` from the `Idempotency-Key` header.

    `id` is derived from the pair, so the primary key is the uniqueness constraint. A replay with the same key
    returns `body`/`status_code` without running the mutation again; the same key on a different request is a 422.
    """

    __table__ = "idempotency"
    __indexed__ = ("user_id", "key")
    user_id: str
    key: str
    scope: str  # method + concrete path, e.g. "POST /inbox/itm_4821:approve"
    request_sha: str
    status_code: int
    body: dict[str, Any]
    created_at: datetime


class Meta(Entity):
    """Key/value rows: the persisted sim clock (`clock`), the seed fingerprint (`seed`)."""

    __table__ = "meta"
    value: dict[str, Any]


ALL_ENTITIES: tuple[type[Entity], ...] = (
    Practice,
    Location,
    User,
    Provider,
    Payer,
    Patient,
    Coverage,
    Appointment,
    Visit,
    ProcedureLine,
    Image,
    Claim,
    AckEvent,
    FileEntry,
    Hold,
    Remittance,
    PatientLedgerEntry,
    Estimate,
    Statement,
    AppealRecord,
    Rule,
    RuleChange,
    RuleProposal,
    InboxItem,
    Evidence,
    Run,
    RunEvent,
    AuditEvent,
    RunCheckpoint,
    LlmCall,
    Job,
    Advance,
    WorldCallLog,
    PayerClaim,
    SavedView,
    IdempotencyRecord,
    Meta,
)
