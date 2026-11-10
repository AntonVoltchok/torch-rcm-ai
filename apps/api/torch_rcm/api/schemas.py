"""API response/request schemas (the OpenAPI contract the web client is generated from). Keep shapes stable.

Pure pydantic: read models build these; routers return them. Entity types from torch_rcm.domain are reused where the
wire shape is the entity itself (Rule, Run, Evidence, Remittance); views add derived fields (needs_action, age).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from torch_rcm.domain.entities import (
    AckEvent,
    Attachment,
    ClaimLine,
    Evidence,
    FileEntry,
    Hold,
    PlannedProcedure,
    Remittance,
    Rule,
    RuleChange,
    RuleProposal,
    Run,
    SavedView,
)
from torch_rcm.domain.enums import (
    AgentKind,
    ClaimStatus,
    EligibilityStatus,
    InboxItemKind,
    InboxItemState,
    MoveWho,
    NextAction,
    PayerKey,
    Role,
    RootCause,
    RuleMode,
    Tier,
)
from torch_rcm.domain.values import Confidence, Deadline, Denial, ProposedAction, ReadinessCheck


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ── envelopes ──────────────────────────────────────────────────────────────────────────────────────────────


class ErrorBody(Schema):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ErrorResponse(Schema):
    error: ErrorBody


class HolderCount(Schema):
    """One holder's share of a strip tile (the Denied tally). The web compares `holder_user_id`/`holder_role`
    with the session user to say "with you"; it never splits a tile itself."""

    who: MoveWho
    holder_role: Role | None
    holder_user_id: str | None
    mine: bool  # the viewer holds it (server rule, same as `ClaimMove.mine`); the web never re-derives it
    count: int


class StripTile(Schema):
    status: ClaimStatus
    count: int
    cents: int
    flagged: int
    cents_basis: Literal["billed", "paid"] = "billed"
    label: str
    by_holder: list[HolderCount]  # sums to `count`


class NavBadges(Schema):
    """Sidebar badges, computed with the strip so no screen counts on its own."""

    payments: int  # remittances a person must look at (held for review or unmatched)
    eligibility: int  # open eligibility flags the viewer sees
    activity: int  # this week's decisions that ran without review


class InboxWaiting(Schema):
    """Open items in the viewer's queue that only someone else can sign, one row per set of signers. The server
    writes `label` (the same names everywhere); `signer_ids` is who has the item in their own `inbox_open`."""

    signer_ids: list[str]
    label: str  # "Dr. Morgan": who it waits on
    count: int
    cents: int


class InboxWaitingGroup(InboxWaiting):
    item_ids: list[str]  # the listed items behind this row, so the Inbox draws them under it


class StatusCount(Schema):
    status: ClaimStatus
    count: int


class MoveCount(Schema):
    """Open claims whose move is with `who` (the KPI cards). Not split by holder: "Yours" is `inbox_open` /
    `inbox_claims`, which already know the viewer."""

    who: MoveWho
    count: int
    cents: int  # billed
    by_status: list[StatusCount]  # the same claims by status ("2 ready, 1 sent"); sums to `count`


class Strip(Schema):
    """GET /summary/strip and `meta.counts` on every mutation."""

    tiles: list[StripTile]
    moves: list[MoveCount]  # one row per `MoveWho`; counts sum to `open_count`
    # "N items need you": open items in the viewer's queue that the viewer can act on (`moves.can_act`). The
    # badge, the Inbox header and the "Yours" card all read it. Items someone else signs are `inbox_waiting`, so
    # `inbox_open + Σ inbox_waiting.count` is the whole queue.
    inbox_open: int
    inbox_open_cents: int
    inbox_claims: int  # distinct claims behind the viewer's `inbox_open` items
    inbox_visits: int  # distinct appointments behind the viewer's claimless items (eligibility flags)
    inbox_waiting: list[InboxWaiting]
    paid_month_count: int
    paid_month_cents: int
    open_count: int
    open_cents: int
    ar_count: int
    ar_cents: int
    flagged_count: int
    flagged_cents: int
    # What an unfiltered GET /claims lists (same predicate, same location): open claims plus claims paid this
    # month. The Claims "Open + Paid · Oct" quick view shows it; it equals open_count + paid_month_count.
    all_count: int
    as_of: datetime
    paid_month_label: str  # "Oct": the month the Paid tile counts
    nav_badges: NavBadges


class Meta(Schema):
    counts: Strip


# ── clock ──────────────────────────────────────────────────────────────────────────────────────────────────


class Advancing(Schema):
    advance_id: str
    to: datetime


class ClockOut(Schema):
    now: datetime
    frozen: bool = True
    advancing: Advancing | None = None


class AdvanceIn(Schema):
    minutes: int | None = Field(default=None, ge=1, le=60 * 24 * 14)
    to: datetime | None = None


class AdvanceAccepted(Schema):
    advance_id: str
    from_: datetime = Field(alias="from")
    to: datetime

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


class EventFired(Schema):
    at: datetime
    kind: str
    summary: str
    job_id: str
    data: dict[str, Any] = Field(default_factory=dict)


class AdvanceOut(Schema):
    advance_id: str
    state: Literal["running", "done", "failed"]
    from_: datetime = Field(alias="from")
    to: datetime
    now: datetime
    events_fired: list[EventFired]
    runs_started: int
    live_runs: int
    skipped_unhandled: dict[str, int]
    done: bool
    error: str | None = None
    meta: Meta | None = None

    model_config = ConfigDict(populate_by_name=True, extra="forbid")


# ── shared refs ────────────────────────────────────────────────────────────────────────────────────────────


class PatientRef(Schema):
    id: str
    name: str
    display_name: str
    dob: date | None = None


class PayerRef(Schema):
    key: PayerKey
    name: str
    short_name: str


class ClaimMove(Schema):
    """Whose move the claim is waiting on, computed in `summarize()`. A queued or running run makes it `agents`.
    For `practice`, the holder fields name who: the web says "You" when they match the viewer, else `label`."""

    who: MoveWho
    holder_role: Role | None  # set when who=practice
    holder_user_id: str | None  # set when one person holds it (an assigned item); None = anyone in the role
    mine: bool  # the viewer holds it: the one "is this mine" rule, decided here so every screen agrees
    label: str  # viewer-neutral wording, e.g. "Dr. Morgan signs", "Waiting on Delta Dental of NY"


class ClaimSummary(Schema):
    id: str
    number: int
    status: ClaimStatus
    needs_action: bool
    patient: PatientRef
    payer: PayerRef
    dos: date
    procedures: str
    procedures_plain: str  # "D2740 Crown, tooth 30 + 1 more": code and plain name, so the web keeps no CDT table
    billed_cents: int
    allowed_cents: int | None
    paid_cents: int | None
    icn: str | None
    reason: str | None
    in_flight: str | None
    age_days: int | None
    file_time: datetime | None
    move: ClaimMove


# ── inbox ──────────────────────────────────────────────────────────────────────────────────────────────────


LearnCode = Literal["tier_not_learnable", "root_cause_guard", "not_enough_evidence"]


class Learnable(Schema):
    """Whether this item's rule could learn to run without review (`agents.policy.learnable`). `code` is the 422
    `POST /inbox/{id}:always-auto-run` answers with; null when `ok`."""

    ok: bool
    code: LearnCode | None
    reason: str


class InboxItemOut(Schema):
    id: str
    kind: InboxItemKind
    state: InboxItemState
    title: str
    headline: str  # one plain sentence from code facts (`readmodels/headline.py`), never model text
    summary: str
    recommendation: str
    agent: AgentKind | None
    tier: Tier | None
    cents: int
    confidence: Confidence | None
    group_key: str | None
    group_title: str | None
    claim: ClaimSummary | None
    patient: PatientRef | None
    appointment_id: str | None
    remittance_id: str | None
    rule_id: str | None
    run_id: str | None
    evidence_ids: list[str]
    proposed_action: ProposedAction | None
    required_role: Role | None
    assignee_user_id: str | None
    deadline_on: date | None
    created_at: datetime
    snoozed_until: datetime | None
    resolved_by: str | None
    resolved_at: datetime | None
    priority: float
    root_cause: RootCause | None
    stopped_by: str
    suspicious_evidence: bool = False
    action_label: str | None  # `ActionSpec.phrase(params)`: what Approve runs ("Send 3 x-rays and resubmit")
    touches: list[str]  # recipe step labels (+ hold window) of that action: "What this does"
    signer_note: str | None  # why someone else signs, when the viewer can't approve it
    # who signs it (`moves.signer`): the treating dentist for a clinical sign-off, the owner for an owner-only act;
    # None when anyone who sees it may approve. The owner may approve in the signer's place without a note.
    signer_user_id: str | None
    lands: MoveWho | None  # where the claim's move goes if this is approved; None for claimless items
    learnable: Learnable


class InboxItemDetail(InboxItemOut):
    plan_steps: list[str]
    audit_note: str | None
    evidence: list[Evidence]
    payload: dict[str, Any]
    hold_window: HoldWindow | None


class HoldWindow(Schema):
    editable_until: datetime | None
    file_time: datetime | None
    departed: bool
    alternatives: list[str]


class InboxGroup(Schema):
    group_key: str
    title: str
    headline: str  # the members' one sentence, counted (`readmodels/headline.group_headline`), else `title`
    count: int
    cents: int
    item_ids: list[str]
    action_label: str | None  # the members' shared action phrase, for the group headline and button
    touches: list[str]


class InboxList(Schema):
    items: list[InboxItemOut]
    total: int  # len(items)
    total_cents: int
    actionable: int  # items the viewer can act on (the "Yours" tab); actionable + Σ waiting.count == total
    waiting: list[InboxWaitingGroup]  # the rest, by who signs them
    next_cursor: str | None = None
    groups: list[InboxGroup] | None = None


class ApproveIn(Schema):
    edits: dict[str, Any] | None = None


class RejectIn(Schema):
    reason: str = Field(min_length=1, max_length=500)


class SnoozeIn(Schema):
    until: datetime


class GroupApproveIn(Schema):
    group_key: str


class ItemOut(Schema):
    item: InboxItemOut
    meta: Meta


StripChangeKey = Literal[
    "inbox",
    "inbox_claims",
    "tile.ready",
    "tile.sent",
    "tile.rejected",
    "tile.accepted",
    "tile.pending",
    "tile.denied",
    "tile.appealed",
    "tile.partial",
    "tile.paid",
    "move.practice",
    "move.agents",
    "move.payer",
    "move.nobody",
]  # closed, so a key the web expects and the API never sends is a type error, not a missing row


class StripChange(Schema):
    """One "What changed" row: a strip number for the viewer before and after an approval, read in the same
    transaction. Equal `before`/`after` is a real row ("Denied stays 5")."""

    key: StripChangeKey
    label: str
    before: int
    after: int
    note: str | None


class ApproveOut(Schema):
    item: InboxItemOut
    run: Run | None
    rule: Rule | None = None
    changes: list[StripChange]
    meta: Meta


class GroupApproveOut(Schema):
    items: list[InboxItemOut]
    runs: list[Run]
    changes: list[StripChange]  # one combined list for the whole group
    meta: Meta


class ProposalOut(Schema):
    proposal: RuleProposal
    rule: Rule | None = None
    meta: Meta


# ── claims ─────────────────────────────────────────────────────────────────────────────────────────────────


class ClaimRow(ClaimSummary):
    provider_id: str
    provider_name: str
    location_id: str
    agent_note: str | None
    last_activity_at: datetime | None
    last_activity: str | None


class ClaimList(Schema):
    items: list[ClaimRow]
    total: int
    total_cents: int
    flagged_count: int
    flagged_cents: int
    next_cursor: str | None = None


class MoneyMath(Schema):
    billed_cents: int
    allowed_cents: int | None
    contractual_cents: int | None
    insurance_est_cents: int | None
    patient_est_cents: int | None
    paid_cents: int | None
    writeoff_cents: int | None
    patient_resp_cents: int | None
    basis: str


class TimelineEntry(Schema):
    id: str
    at: datetime
    lane: Literal["agent", "payer", "human", "system"]
    kind: str
    title: str
    detail: str | None = None
    actor: str | None = None
    run_id: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)
    root_cause: RootCause | None = None
    who: MoveWho | None = None  # the party that acted: practice, agents or payer (the baton history)


class TimelinePage(Schema):
    items: list[TimelineEntry]
    next_cursor: str | None = None


class ClaimDetail(Schema):
    claim: ClaimSummary
    provider_name: str
    location_name: str
    coverage: CoverageOut
    patient: PatientRef
    payer: PayerRef
    lines: list[ClaimLine]
    attachments: list[Attachment]
    acks: list[AckEvent]
    readiness: list[ReadinessCheck]
    denial: Denial | None
    deadline: Deadline
    money: MoneyMath
    timeline: list[TimelineEntry]
    timeline_next_cursor: str | None
    open_inbox_items: list[InboxItemOut]
    holds: list[Hold]
    file_entries: list[FileEntry]
    parent_claim_id: str | None
    frequency_code: int | None
    closed_reason: str | None
    timely_filing_due: date | None


class CoverageOut(Schema):
    id: str
    payer_key: PayerKey
    plan_name: str
    subscriber_id: str
    group_no: str
    order: str
    self_funded: bool
    annual_max_cents: int
    used_cents: int
    remaining_max_cents: int
    deductible_cents: int
    deductible_met_cents: int
    pct_preventive: int
    pct_basic: int
    pct_major: int
    verified_at: datetime | None
    verified_via: str | None


class VoidIn(Schema):
    reason: str = Field(min_length=1, max_length=500)


class CorrectedIn(Schema):
    changes: dict[str, Any]


class ClaimMutationOut(Schema):
    claim: ClaimSummary
    run: Run | None = None
    meta: Meta


class TriageIn(Schema):
    agent: Literal["claims", "followup"] | None = None


class TriageOut(Schema):
    run: Run
    meta: Meta


class ViewIn(Schema):
    name: str = Field(min_length=1, max_length=80)
    search_params: dict[str, Any]


class ViewList(Schema):
    items: list[SavedView]
    total: int


# ── today's claims ─────────────────────────────────────────────────────────────────────────────────────────


class LedgerRow(Schema):
    claim: ClaimSummary
    built_at: datetime
    file_time: datetime | None
    editable_until: datetime | None
    ack_stage: str
    acks: list[AckEvent]
    checks_passed: int
    checks_total: int
    agent_text: bool
    note: str | None


class HeldRow(Schema):
    claim: ClaimSummary
    hold: Hold
    timely_days_left: int | None
    owner_name: str | None


class NotBillableRow(Schema):
    patient: PatientRef
    cdt: str
    quadrant: str | None
    fee_cents: int
    reason: str


class LedgerTotal(Schema):
    count: int
    cents: int  # billed; for `not_billable`, the procedures' fees


class LedgerTotals(Schema):
    """Every number the Today's claims header and section titles show; each equals its rows (tested)."""

    on_ledger: int  # sent + leaving + held claims; not-billable procedures are listed, never counted here
    sent: LedgerTotal
    leaving: LedgerTotal
    held: LedgerTotal
    not_billable: LedgerTotal


class LedgerFile(Schema):
    """One payer-file departure in `leaving_next_file`, earliest first; `file_time` None ("not yet filed") last.
    The groups partition `leaving_next_file`: every row's claim id is in exactly one group."""

    file_time: datetime | None
    count: int
    cents: int
    claim_ids: list[str]


class LedgerToday(Schema):
    date: date
    sent: list[LedgerRow]
    leaving_next_file: list[LedgerRow]
    held: list[HeldRow]
    not_billable: list[NotBillableRow]
    next_file_time: datetime | None
    last_file_time: datetime | None
    totals: LedgerTotals
    files: list[LedgerFile]


# ── runs ───────────────────────────────────────────────────────────────────────────────────────────────────


class RunList(Schema):
    items: list[Run]
    total: int
    next_cursor: str | None = None


class RunDetail(Schema):
    run: Run
    evidence: list[Evidence]
    last_event_id: int


class AgentsStatus(Schema):
    paused: bool
    paused_by: str | None
    paused_at: datetime | None
    mode: Literal["deterministic", "live"]
    # live mode answering from recorded API responses (cassettes) instead of calling the model
    replay: bool
    live_agents: list[AgentKind]
    agents: int
    running: int
    queued: int
    paused_runs: int


# ── settings ───────────────────────────────────────────────────────────────────────────────────────────────


class RuleRow(Schema):
    rule: Rule
    ran_without_review_7d: int
    routine_runs_7d: int
    waiting: int
    confidence: Confidence | None
    signed_by_name: str | None
    locked: bool


class TierGroup(Schema):
    tier: Tier
    label: str
    description: str
    rows: list[RuleRow]
    count: int  # len(rows)
    ran_without_review_7d: int  # Σ rows; 0 for tier 3 (human only)
    waiting: int  # Σ rows


class RulesOut(Schema):
    """The `_7d` counts are this week's (Mon-start, `activity.week_start`), the same week as Activity."""

    tiers: list[TierGroup]
    practice_cap_cents: int
    this_week: WeekDecisions
    rules_count: int  # Σ tier counts
    changes_count: int
    proposals_open: int


class WeekDecisions(Schema):
    total: int
    ran: int
    to_you: int


class RulePatchIn(Schema):
    mode: RuleMode | None = None
    max_cents: int | None = Field(default=None, ge=0)
    confidence_floor: float | None = Field(default=None, ge=0, le=1)


class PracticeSettingsIn(Schema):
    practice_cap_cents: int


class PracticeSettingsOut(Schema):
    practice_cap_cents: int
    meta: Meta


class RulePatchOut(Schema):
    rule: Rule
    change: RuleChange
    meta: Meta


class RuleDigest(Schema):
    """The owner's Monday digest for this week so far (Mon-start, the Activity week)."""

    period_start: date  # this week's Monday
    sends_on: date  # next Monday
    changes: int  # rule changes made this week
    items_run: int  # distinct runs this week that ran without review under a rule after its change this week
    awaiting_signoff: int  # open owner_signoff items


class RuleChangeList(Schema):
    items: list[RuleChange]
    total: int
    digest: RuleDigest


class PreviewOut(Schema):
    rule_id: str
    mode: RuleMode
    max_cents: int | None
    would_run: int  # net: would have run without review after holds
    total: int
    baseline_would_run: int
    held_by_root_cause: dict[str, int]
    held_total: int  # Σ held_by_root_cause
    before_holds: int  # would_run + held_total: in the rule's scope before the guards hold some back
    net_change: int  # would_run - baseline_would_run (negative when the change runs fewer)


class ProposalList(Schema):
    items: list[RuleProposal]
    total: int


# ── static screens ─────────────────────────────────────────────────────────────────────────────────────────


class ActivityRow(Schema):
    run_id: str
    at: datetime
    agent: AgentKind | None
    actor: str | None
    action: str
    subject: str
    claim_id: str | None
    outcome: str
    would_have_run: bool
    awaiting_you: bool
    evidence_kinds: list[str]
    audit_line: str
    tier: Tier | None
    # The claim's move now, for the viewer (not at the time of the row); None for rows without a claim.
    move: ClaimMove | None


class ActivityDay(Schema):
    date: date  # practice-local
    count: int  # rows of that day in this response (after the filters)


class ActivitySummary(Schema):
    ran_without_you: int
    awaiting_you: int
    decisions: int
    status_checks: int
    payer_calls: int
    claims_sent: int
    remittances_posted: int


class ActivityOut(Schema):
    rows: list[ActivityRow]
    summary: ActivitySummary
    by_agent: dict[str, dict[str, int]]
    by_tier: dict[str, dict[str, int]]
    by_day: list[ActivityDay]  # newest first, one per day that has rows


class EligibilityRow(Schema):
    appointment_id: str
    start: datetime
    patient: PatientRef
    provider_name: str
    payer: PayerRef | None
    planned: list[PlannedProcedure]
    planned_fee_cents: int
    remaining_max_cents: int | None
    status: EligibilityStatus
    note: str | None
    inbox_item_id: str | None


class EligibilityDay(Schema):
    """One practice day in the window, zeros included; the four statuses sum to `count`."""

    date: date
    count: int
    verified: int
    issue: int
    unverified: int
    checking: int


class EligibilityOut(Schema):
    date: date
    rows: list[EligibilityRow]
    need_human: int
    total: int  # len(rows)
    by_day: list[EligibilityDay]  # every business day in the window, plus any other day that has rows


class FrequencyRow(Schema):
    cdt: str
    rule: str
    last_done: date | None
    ok_from: date | None


class BenefitsPanel(Schema):
    appointment_id: str
    patient: PatientRef
    coverage: CoverageOut
    frequencies: list[FrequencyRow]
    planned: list[PlannedProcedure]
    planned_fee_cents: int
    insurance_est_cents: int | None
    patient_est_cents: int | None
    basis: str
    agent_note: str | None
    inbox_item_id: str | None


class Kpi(Schema):
    key: str
    label: str
    value: float
    unit: Literal["cents", "days", "pct", "count"]
    formula: str
    basis: str


class AgingBucket(Schema):
    bucket: str
    cents: int
    count: int
    pct: float


class Breakdown(Schema):
    key: str
    label: str
    cents: int
    count: int


class AgentImpact(Schema):
    items_auto: int
    items_to_you: int
    hours_saved_est: Kpi


class CashOut(Schema):
    kpis: list[Kpi]
    aging: list[AgingBucket]
    by_payer: list[Breakdown]
    by_provider: list[Breakdown]
    writeoffs_by_type: list[Breakdown]
    patient_aging: list[AgingBucket]
    agent_impact: AgentImpact
    appeals_12mo: dict[str, int]


class DenialRow(Schema):
    claim: ClaimSummary
    carc: str
    rarc: str | None
    decoded: str
    root_cause: RootCause
    next_action: NextAction
    agent: AgentKind
    signer: str | None
    deadline: Deadline
    patient_billable_if_lost: bool | None
    erisa: bool
    checklist: list[str]
    inbox_item_id: str | None


class DenialGroup(Schema):
    next_action: NextAction
    label: str
    count: int
    cents: int
    rows: list[DenialRow]


DenialReason = Literal["doc", "freq", "cob", "tf", "med_nec", "other"]


class DenialReasonColumn(Schema):
    key: DenialReason
    label: str


class DenialMatrixCell(Schema):
    reason: DenialReason
    count: int


class DenialMatrixRow(Schema):
    payer: PayerRef
    cells: list[DenialMatrixCell]
    """One cell per column, in column order, zeros included."""
    total: int


class DenialMatrix(Schema):
    """The worklist's rows counted by payer × reason class. Plan limits (PR-*: max met, alternate benefit) are not
    denials of care, so they are left out and counted in `excluded`. `total + excluded == DenialsOut.total`."""

    columns: list[DenialReasonColumn]
    payers: list[DenialMatrixRow]
    """Most denials first, then payer short name."""
    totals: list[DenialMatrixCell]
    total: int
    excluded: int


class DenialsOut(Schema):
    groups: list[DenialGroup]
    total: int
    in_flight: list[ClaimSummary]
    matrix: DenialMatrix


class RemittanceList(Schema):
    items: list[Remittance]
    total: int


class PatientBalanceRow(Schema):
    patient: PatientRef
    balance_cents: int
    oldest_dos: date | None
    aging_bucket: str
    last_payment_on: date | None
    on_hold: bool


class PatientBalances(Schema):
    items: list[PatientBalanceRow]
    total: int
    ar_cents: int
    credits_cents: int
    credit_count: int


class WorldPayer(Schema):
    key: PayerKey
    name: str
    payer_id: str
    type: str
    timely_filing_days: int
    appeal_window_days: int
    era_weekdays: list[int]
    latency_bd: tuple[int, int]
    rules: list[str]
    portal_down: bool


class InjectIn(Schema):
    event: Literal["clearinghouse_reject", "portal_outage", "portal_restore", "era_now"]
    claim_id: str | None = None
    payer_key: PayerKey | None = None
    code: str | None = None


class InjectOut(Schema):
    ok: bool
    detail: str
    meta: Meta


class ReseedIn(Schema):
    scenario: str | None = None


class ReseedOut(Schema):
    scenario: str
    now: datetime
    meta: Meta


InboxItemDetail.model_rebuild()
ClaimDetail.model_rebuild()
RulesOut.model_rebuild()
