"""Enumerations from docs/spec/01-domain-model.md. Values are the wire format; never rename."""

from __future__ import annotations

from enum import IntEnum, StrEnum


class ClaimStatus(StrEnum):
    READY = "ready"
    SENT = "sent"
    REJECTED = "rejected"
    ACCEPTED = "accepted"
    PENDING = "pending"
    DENIED = "denied"
    PARTIAL = "partial"
    PAID = "paid"
    APPEALED = "appealed"


#: Statuses that count as insurance A/R (open, sent to a payer, not paid).
AR_STATUSES: tuple[ClaimStatus, ...] = (
    ClaimStatus.SENT,
    ClaimStatus.REJECTED,
    ClaimStatus.ACCEPTED,
    ClaimStatus.PENDING,
    ClaimStatus.DENIED,
    ClaimStatus.APPEALED,
    ClaimStatus.PARTIAL,
)
OPEN_STATUSES: tuple[ClaimStatus, ...] = (ClaimStatus.READY, *AR_STATUSES)


class ClosedReason(StrEnum):
    """Terminal reason on a claim whose status is unchanged (write-off is a reason, not a status)."""

    WRITE_OFF = "write_off"
    VOIDED = "voided"
    SUPERSEDED = "superseded"  # replaced by a corrected claim (frequency 7)


class AckStage(StrEnum):
    NONE = "none"
    FILE_999_OK = "file_999_ok"
    FILE_999_REJECT = "file_999_reject"
    CH_277CA_A1 = "ch_277ca_a1"
    CH_277CA_A7 = "ch_277ca_a7"
    PAYER_277CA_A1 = "payer_277ca_a1"
    PAYER_277CA_A7 = "payer_277ca_a7"


class Tier(IntEnum):
    ONE = 1
    TWO = 2
    THREE = 3


class RuleMode(StrEnum):
    OBSERVE = "observe"
    ASK = "ask"
    AUTO = "auto"
    HUMAN_ONLY = "human_only"


class RuleAction(StrEnum):
    # tier 1 — talks to payers
    STATUS_CHECK = "status_check"
    PAYER_REP_CALL = "payer_rep_call"
    RECORDS_REQUEST = "records_request"
    RESUBMIT_WITH_ATTACHMENT = "resubmit_with_attachment"
    REPROCESSING_REQUEST = "reprocessing_request"
    REQUEST_835 = "request_835"
    SEND_CLAIM_PMS_CODES = "send_claim_pms_codes"
    FIX_DEMOGRAPHICS_RESEND = "fix_demographics_resend"
    ELIGIBILITY_CHECK = "eligibility_check"
    # tier 2 — touches the ledger or patients, or agent-written payer/patient text
    POST_ERA_LINE = "post_era_line"
    UPDATE_PMS_BENEFITS = "update_pms_benefits"
    SEND_CLAIM_AGENT_TEXT = "send_claim_agent_text"
    CORRECTED_CLAIM = "corrected_claim"
    PATIENT_TRANSFER = "patient_transfer"
    SEND_STATEMENT = "send_statement"
    MECHANICAL_REFUND = "mechanical_refund"
    COB_ORDER_CHANGE = "cob_order_change"
    # tier 3 — commits the practice (human only)
    WRITE_OFF = "write_off"
    FORMAL_APPEAL = "formal_appeal"
    VOID_CLAIM = "void_claim"
    DISCRETIONARY_REFUND = "discretionary_refund"
    COLLECTIONS_REFERRAL = "collections_referral"
    WAIVER = "waiver"


TIER1_ACTIONS: frozenset[RuleAction] = frozenset(
    {
        RuleAction.STATUS_CHECK,
        RuleAction.PAYER_REP_CALL,
        RuleAction.RECORDS_REQUEST,
        RuleAction.RESUBMIT_WITH_ATTACHMENT,
        RuleAction.REPROCESSING_REQUEST,
        RuleAction.REQUEST_835,
        RuleAction.SEND_CLAIM_PMS_CODES,
        RuleAction.FIX_DEMOGRAPHICS_RESEND,
        RuleAction.ELIGIBILITY_CHECK,
    }
)
TIER2_ACTIONS: frozenset[RuleAction] = frozenset(
    {
        RuleAction.POST_ERA_LINE,
        RuleAction.UPDATE_PMS_BENEFITS,
        RuleAction.SEND_CLAIM_AGENT_TEXT,
        RuleAction.CORRECTED_CLAIM,
        RuleAction.PATIENT_TRANSFER,
        RuleAction.SEND_STATEMENT,
        RuleAction.MECHANICAL_REFUND,
        RuleAction.COB_ORDER_CHANGE,
    }
)
TIER3_ACTIONS: frozenset[RuleAction] = frozenset(
    {
        RuleAction.WRITE_OFF,
        RuleAction.FORMAL_APPEAL,
        RuleAction.VOID_CLAIM,
        RuleAction.DISCRETIONARY_REFUND,
        RuleAction.COLLECTIONS_REFERRAL,
        RuleAction.WAIVER,
    }
)

#: Routine payer contact: logged in Activity, not counted as a "decision" (Activity header, 04-seed).
ROUTINE_ACTIONS: frozenset[RuleAction] = frozenset(
    {RuleAction.STATUS_CHECK, RuleAction.PAYER_REP_CALL, RuleAction.ELIGIBILITY_CHECK, RuleAction.REQUEST_835}
)


def tier_of(action: RuleAction) -> Tier:
    """Catalog tier of an action (agent-written text can raise a tier-1 action to 2; see 07-agents §5.3)."""
    if action in TIER1_ACTIONS:
        return Tier.ONE
    if action in TIER2_ACTIONS:
        return Tier.TWO
    return Tier.THREE


class InboxItemKind(StrEnum):
    APPROVE_ACTION = "approve_action"
    REVIEW_DRAFT = "review_draft"
    ELIGIBILITY_FLAG = "eligibility_flag"
    VARIANCE = "variance"
    RUN_FAILED = "run_failed"
    RULE_PROPOSAL = "rule_proposal"
    OWNER_SIGNOFF = "owner_signoff"


class InboxItemState(StrEnum):
    OPEN = "open"
    APPROVED = "approved"
    EDITED = "edited"
    REJECTED = "rejected"
    SNOOZED = "snoozed"
    EXPIRED = "expired"
    DONE = "done"


RESOLVED_ITEM_STATES: frozenset[InboxItemState] = frozenset(
    {
        InboxItemState.APPROVED,
        InboxItemState.EDITED,
        InboxItemState.REJECTED,
        InboxItemState.EXPIRED,
        InboxItemState.DONE,
    }
)


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    WOULD_HAVE_RUN = "would_have_run"


ACTIVE_RUN_STATUSES: frozenset[RunStatus] = frozenset({RunStatus.QUEUED, RunStatus.RUNNING, RunStatus.PAUSED})


class RunTrigger(StrEnum):
    RULE = "rule"
    APPROVAL = "approval"
    SCHEDULE = "schedule"
    MANUAL = "manual"


class StepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    OK = "ok"
    FAILED = "failed"
    SKIPPED = "skipped"


class PolicyVerdict(StrEnum):
    OBSERVE = "observe"
    PROPOSE = "propose"
    EXECUTE = "execute"
    REFUSE = "refuse"
    PARK = "park"


class AgentMode(StrEnum):
    DETERMINISTIC = "deterministic"
    LIVE = "live"


class PlannerKind(StrEnum):
    LIVE = "live"
    SCRIPTED = "scripted"
    RECORDED_PLAN = "recorded_plan"
    SCRIPTED_FALLBACK = "scripted_fallback"


class AgentKind(StrEnum):
    ELIGIBILITY = "eligibility"
    CLAIMS = "claims"
    FOLLOWUP = "followup"
    APPEALS = "appeals"
    POSTING = "posting"


class RootCause(StrEnum):
    OURS = "ours"
    PAYER = "payer"
    PATIENT = "patient"
    UNKNOWN = "unknown"


class DeadlineKind(StrEnum):
    TIMELY_FILING = "timely_filing"
    APPEAL = "appeal"
    NONE = "none"


class EvidenceKind(StrEnum):
    PORTAL_SCREENSHOT = "portal_screenshot"
    IVR_TRANSCRIPT = "ivr_transcript"
    REP_CALL = "rep_call"
    ERA_LINE = "era_line"
    EOB_PDF = "eob_pdf"
    PMS_RECORD = "pms_record"
    NEA_ATTACHMENT = "nea_attachment"
    POLICY_CLAUSE = "policy_clause"
    PRIOR_EOB = "prior_eob"
    NOTE_EXCERPT = "note_excerpt"


class GatheredBy(StrEnum):
    AGENT = "agent"
    CODE = "code"


class PayerKey(StrEnum):
    DELTA_NY = "delta_ny"
    METLIFE = "metlife"
    CIGNA = "cigna"
    AETNA = "aetna"
    GUARDIAN = "guardian"
    NY_MEDICAID = "ny_medicaid"


class PayerType(StrEnum):
    PPO = "ppo"
    SELF_FUNDED_ERISA = "self_funded_erisa"
    MEDICAID = "medicaid"


class Role(StrEnum):
    OWNER = "owner"
    BILLING = "billing"
    DENTIST = "dentist"
    FRONT_DESK = "front_desk"


class MoveWho(StrEnum):
    """Whose move a claim is waiting on (D1's baton). `practice` covers every person at the practice; the holder
    fields on `ClaimMove` say which one, so the web can say "You" or name them."""

    PRACTICE = "practice"
    AGENTS = "agents"
    PAYER = "payer"
    NOBODY = "nobody"


class ContactPref(StrEnum):
    TEXT = "text"
    EMAIL = "email"
    PAPER = "paper"


class CoverageOrder(StrEnum):
    PRIMARY = "primary"
    SECONDARY = "secondary"


class VerifiedVia(StrEnum):
    PORTAL = "portal"
    IVR = "ivr"
    X271 = "271"
    INTAKE = "intake"


class EligibilityStatus(StrEnum):
    VERIFIED = "verified"
    ISSUE = "issue"
    UNVERIFIED = "unverified"
    CHECKING = "checking"


class ProviderType(StrEnum):
    DENTIST = "dentist"
    HYGIENIST = "hygienist"


class AttachmentKind(StrEnum):
    PA = "pa"
    BWX = "bwx"
    FMX = "fmx"
    PERIO_CHART = "perio_chart"
    NARRATIVE = "narrative"
    EOB = "eob"


class AttachmentSource(StrEnum):
    PMS_IMAGING = "pms_imaging"
    AGENT = "agent"
    USER = "user"


class ImageKind(StrEnum):
    PA = "pa"
    BWX = "bwx"
    FMX = "fmx"
    PANO = "pano"
    PERIO_CHART = "perio_chart"
    INTRAORAL_PHOTO = "intraoral_photo"


class ReadinessKey(StrEnum):
    NOTE_SIGNED = "note_signed"
    PROCS_MATCH_NOTE = "procs_match_note"
    FEE_SCHEDULE = "fee_schedule"
    SUBSCRIBER_ID_FORMAT = "subscriber_id_format"
    ELIGIBILITY_FRESH = "eligibility_fresh"
    REMAINING_MAX = "remaining_max"
    FREQUENCY = "frequency"
    TOOTH_VALIDITY = "tooth_validity"
    ATTACHMENT_RULE = "attachment_rule"
    NARRATIVE = "narrative"
    COB_ORDER = "cob_order"
    DUPLICATE = "duplicate"
    TIMELY_FILING = "timely_filing"


class CheckStatus(StrEnum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    NA = "na"


class AdjGroup(StrEnum):
    CO = "CO"
    PR = "PR"
    OA = "OA"


class RemitKind(StrEnum):
    X835 = "835"
    PAPER_EOB = "paper_eob"


class RemitStatus(StrEnum):
    AUTO_POSTED = "auto_posted"
    NEEDS_REVIEW = "needs_review"
    UNMATCHED = "unmatched"


class DepositStatus(StrEnum):
    DEPOSITED = "deposited"
    EXPECTED = "expected"
    NOT_DEPOSITED = "not_deposited"


class LineMatch(StrEnum):
    AUTO = "auto"
    REVIEW = "review"
    UNMATCHED = "unmatched"


class HoldSubject(StrEnum):
    CLAIM = "claim"
    PATIENT_BALANCE = "patient_balance"


class HoldReason(StrEnum):
    NOTE_UNSIGNED = "note_unsigned"
    PROCS_NOT_IN_NOTE = "procs_not_in_note"
    RENDERING_MISMATCH = "rendering_mismatch"
    AWAITING_PRIMARY_EOB = "awaiting_primary_eob"
    MISSING_IMAGE = "missing_image"
    SUBSCRIBER_ID_INVALID = "subscriber_id_invalid"
    OTHER_DOCUMENTED = "other_documented"
    REPROCESSING_REQUESTED = "reprocessing_requested"  # patient-balance hold (Foster)


class OutcomeMetric(StrEnum):
    PAID_30D = "paid_30d"
    ACCEPTED = "accepted"
    BALANCED = "balanced"
    NONE = "none"


class ReversesIn(StrEnum):
    UNTIL_FILE_LEAVES = "until_file_leaves"
    UNTIL_DAY_CLOSE = "until_day_close"
    VOID_ONLY = "void_only"
    NONE = "none"


class RuleOrigin(StrEnum):
    AUTHORED = "authored"
    LEARNED = "learned"


class ProposalState(StrEnum):
    OPEN = "open"
    ACCEPTED = "accepted"
    DISMISSED = "dismissed"


class FileEntryKind(StrEnum):
    ORIGINAL = "original"
    RESUBMIT = "resubmit"
    CORRECTED = "corrected"


class FileEntryState(StrEnum):
    QUEUED = "queued"
    DEPARTED = "departed"
    WITHDRAWN = "withdrawn"


class JobState(StrEnum):
    QUEUED = "queued"
    LEASED = "leased"
    PARKED = "parked"
    DONE = "done"
    DEAD = "dead"


class AdvanceState(StrEnum):
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class LedgerEntryKind(StrEnum):
    CHARGE = "charge"
    PAYMENT = "payment"
    REFUND = "refund"
    ADJUSTMENT = "adjustment"


class AppealKind(StrEnum):
    RECONSIDERATION = "reconsideration"
    FORMAL = "formal"


class NextAction(StrEnum):
    """Denials worklist groups (02-api `GET /denials`)."""

    RECONSIDERATION = "reconsideration"
    CORRECTED = "corrected"
    FORMAL_APPEAL = "formal_appeal"
    BILL_PATIENT_LINK = "bill_patient_link"
    WRITE_OFF = "write_off"
