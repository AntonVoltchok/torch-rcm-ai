"""The closed action catalog: every action an agent may propose, its tier, its parameter model and
the recipe that executes it.

Principle: the model proposes; code gates and executes. Tier, reversibility and "carries agent text"
are properties of the action in this table, never of a plan. Tier-3 actions have no agent-reachable
recipe: they execute only in a human-started run by a role holder (policy row 3).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, ConfigDict

from torch_rcm.agents.types import AgentKind, DraftKind, HoldReason, JsonValue, ReversesIn, Role, Tier


class Params(BaseModel):
    """Base for action parameters. Strict: unknown keys are a validation error (row 1 refuses)."""

    model_config = ConfigDict(frozen=True, extra="forbid")


class ClaimParams(Params):
    claim_id: str


class StatusCheckParams(ClaimParams):
    channel: Literal["portal", "ivr", "x12_276"]


RepTopic = Literal["denial_reason", "attachment_requirements", "claim_status", "prompt_pay"]
RepAsk = Literal[
    "confirm_status",
    "confirm_records_received",
    "ask_attachment_requirements",
    "request_reprocessing",
    "request_835",
]


class PayerRepCallParams(ClaimParams):
    topic: RepTopic
    asks: list[RepAsk]


class RecordsRequestParams(ClaimParams):
    image_ids: list[str]
    note_visit_ids: list[str]


class ResubmitWithAttachmentParams(ClaimParams):
    image_id: str
    attachment_kind: Literal["pa", "bwx", "fmx", "perio_chart", "narrative"]


class ReprocessingParams(ClaimParams):
    basis: Literal["ny_prompt_pay", "deductible_misapplied", "payer_history_error"]
    attach: list[str] = []  # evidence ids to enclose (e.g. the payer's own prior EOB)


class FixDemographicsParams(ClaimParams):
    field: Literal["subscriber_id", "group_no", "patient_dob", "rendering_npi"]
    value: str
    source: Literal["pms", "271"] = "pms"  # the rule resends PMS values only; a 271 value goes to a person


class EligibilityCheckParams(Params):
    appointment_id: str


class PostEraLineParams(Params):
    remittance_id: str
    claim_id: str | None = None
    remit_line_id: str | None = None  # None = every line of this remittance for the claim (or all lines)
    post: Literal["all_lines", "patient_share_only"] = "all_lines"
    patient_cents: int | None = None
    disputed_cents: int | None = None
    then: str | None = None  # follow-up the poster queues, e.g. "reprocessing_request:deductible_misapplied"


class UpdateBenefitsParams(Params):
    patient_id: str
    coverage_id: str


class CorrectedClaimParams(ClaimParams):
    reason: Literal["code_correction", "tooth_correction", "frequency_code", "other_documented"]


class AmountParams(Params):
    patient_id: str
    cents: int


class TransferParams(Params):
    claim_id: str
    cents: int
    patient_id: str | None = None


class WriteOffParams(Params):
    claim_id: str
    writeoff_cents: int
    patient_transfer_cents: int = 0


class PatientParams(Params):
    patient_id: str


class CobOrderParams(Params):
    patient_id: str
    new_primary_coverage_id: str


class FormalAppealParams(ClaimParams):
    level: int = 1


class HoldClaimParams(ClaimParams):
    reason: HoldReason


class ActionSpec(BaseModel):
    """One catalog entry. `recipe` names a recipe in `catalog.recipes`; tier 3 has none for agents."""

    model_config = ConfigDict(frozen=True)

    name: str
    tier: Tier | None
    label: str
    params: type[Params]
    reverses_in: ReversesIn = "none"
    carries_text: DraftKind | None = None
    needs_hold_window: bool = False
    contacts_payer: bool = False
    role_required: Role | None = None
    amount_param: str | None = None


def _spec(name: str, tier: Tier | None, label: str, params: type[Params], **kw: object) -> ActionSpec:
    return ActionSpec.model_validate({"name": name, "tier": tier, "label": label, "params": params, **kw})


ACTIONS: dict[str, ActionSpec] = {
    s.name: s
    for s in (
        # tier 1 — talks to payers
        _spec("status_check", 1, "Status check", StatusCheckParams, contacts_payer=True),
        _spec("payer_rep_call", 1, "Payer rep call", PayerRepCallParams, contacts_payer=True),
        _spec("records_request", 1, "Records request", RecordsRequestParams, contacts_payer=True),
        _spec(
            "resubmit_with_attachment",
            1,
            "Resubmit with attachment",
            ResubmitWithAttachmentParams,
            reverses_in="until_file_leaves",
            contacts_payer=True,
        ),
        _spec("reprocessing_request", 1, "Reprocessing request", ReprocessingParams, contacts_payer=True),
        _spec("request_835", 1, "Request 835", ClaimParams, contacts_payer=True),
        _spec(
            "send_claim_pms_codes",
            1,
            "Send claim · PMS codes",
            ClaimParams,
            reverses_in="until_file_leaves",
            needs_hold_window=True,
        ),
        _spec(
            "fix_demographics_resend",
            1,
            "Fix demographics, resend",
            FixDemographicsParams,
            reverses_in="until_file_leaves",
        ),
        _spec("eligibility_check", 1, "Eligibility check", EligibilityCheckParams, contacts_payer=True),
        # tier 2 — touches the ledger or patients, or agent-written payer/patient text
        _spec("post_era_line", 2, "Post ERA line", PostEraLineParams, reverses_in="until_day_close"),
        _spec("update_pms_benefits", 2, "Update PMS benefits", UpdateBenefitsParams),
        _spec(
            "send_claim_agent_text",
            2,
            "Send claim · agent text",
            ClaimParams,
            reverses_in="until_file_leaves",
            carries_text="claim_narrative",
            needs_hold_window=True,
        ),
        _spec("corrected_claim", 2, "Corrected claim (7)", CorrectedClaimParams, reverses_in="void_only"),
        _spec(
            "patient_transfer",
            2,
            "Patient-responsibility transfer",
            TransferParams,
            reverses_in="until_day_close",
            amount_param="cents",
        ),
        _spec("send_statement", 2, "Send statement", PatientParams),
        _spec("mechanical_refund", 2, "Mechanical refund", AmountParams, amount_param="cents"),
        _spec("cob_order_change", 2, "Coverage order change", CobOrderParams),
        # tier 3 — commits the practice; human only
        _spec("write_off", 3, "Write-off", WriteOffParams, role_required="owner", amount_param="writeoff_cents"),
        _spec(
            "formal_appeal",
            3,
            "Formal appeal",
            FormalAppealParams,
            role_required="dentist",
            carries_text="appeal_letter",
        ),
        _spec("void_claim", 3, "Void claim", ClaimParams, role_required="owner"),
        _spec(
            "discretionary_refund",
            3,
            "Discretionary refund",
            AmountParams,
            role_required="owner",
            amount_param="cents",
        ),
        _spec("collections_referral", 3, "Collections referral", PatientParams, role_required="owner"),
        _spec("waiver", 3, "Waiver", AmountParams, role_required="owner", amount_param="cents"),
        # no tier — a Hold row, not an action on the world
        _spec("hold_claim", None, "Hold claim", HoldClaimParams),
    )
}

TIER3_ACTIONS: frozenset[str] = frozenset(n for n, s in ACTIONS.items() if s.tier == 3)

# Which actions each agent may propose (07 §2). Tier-3 entries are proposals for a role holder only.
AGENT_ACTIONS: dict[AgentKind, tuple[str, ...]] = {
    "eligibility": ("eligibility_check", "update_pms_benefits"),
    "claims": (
        "send_claim_pms_codes",
        "fix_demographics_resend",
        "send_claim_agent_text",
        "corrected_claim",
        "cob_order_change",
        "hold_claim",
    ),
    "followup": (
        "status_check",
        "payer_rep_call",
        "records_request",
        "resubmit_with_attachment",
        "reprocessing_request",
        "request_835",
        "cob_order_change",
    ),
    "appeals": ("formal_appeal",),
    "posting": (
        "post_era_line",
        "patient_transfer",
        "mechanical_refund",
        "request_835",
        "reprocessing_request",
    ),
}

# Roles that may execute a tier-3 action in a human-started run (row 3). The owner may do any.
TIER3_ROLES: dict[str, frozenset[Role]] = {
    name: frozenset({"owner", spec.role_required}) if spec.role_required else frozenset({"owner"})
    for name, spec in ACTIONS.items()
    if spec.tier == 3
}


def spec_for(action: str) -> ActionSpec | None:
    return ACTIONS.get(action)


FOLLOW_UP_ARG = {"reprocessing_request": "basis"}  # the param `then`'s text after the colon fills


def follow_up(action: str, params: Mapping[str, object]) -> tuple[str, dict[str, JsonValue]] | None:
    """The action an ERA post's `then` queues ("reprocessing_request:deductible_misapplied") and its params, on the
    poster's claim. Not validated here: Policy validates and decides it like any proposed action (row 1 refuses
    an unknown action or basis)."""
    then = params.get("then") if action == "post_era_line" else None
    if not isinstance(then, str) or not then:
        return None
    name, _, arg = then.partition(":")
    out: dict[str, JsonValue] = {"claim_id": cid} if isinstance(cid := params.get("claim_id"), str) else {}
    if arg and name in FOLLOW_UP_ARG:
        out[FOLLOW_UP_ARG[name]] = arg
    return name, out


def in_catalog(agent: AgentKind, action: str) -> bool:
    return action in AGENT_ACTIONS[agent]
