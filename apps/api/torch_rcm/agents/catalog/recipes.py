"""Action recipes: the fixed, idempotent step sequence that executes each action.

Principle: the model proposes; code gates and executes. A recipe is the *only* code that calls
`WorldPort.act`. Its steps, their order and their arguments are defined here, identical in deterministic
and live modes; a plan supplies validated parameters and (for tier-2 text) a guarded draft, nothing else.
Every step is called with `"{action_key}:{step}"` as its idempotency key, so a re-run after a crash
returns the stored result (the same NEA#) instead of acting twice.

Step names match the seeded run history (`torch_rcm/seed/canonical/agents.py::RECIPES`) so Activity rows read
the same for seeded and live runs. Ops prefixed `code.` are computed locally (no world call); `domain.`
ops write a domain row (a Hold); everything else is a world adapter op (`tools/adapters.py`).

Tier 3 has no recipe, by design: a write-off, a formal appeal or a void is performed by a person (the
appeal packet is *prepared* by the Appeals agent as a draft). An approved tier-3 item produces a run that
records the role holder's decision and hands off; there is no code path that performs it.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta

from torch_rcm.agents.catalog.actions import Params
from torch_rcm.agents.guardrails import MAY_AGREE_TO
from torch_rcm.agents.types import CaseFile, Draft, JsonValue, PayerView

NEA_LEAD = timedelta(minutes=30)  # an NEA# must be referenceable before the file that cites it leaves
EDIT_LOCK = timedelta(seconds=60)

DOMAIN_OP_HOLD = "domain.create_hold"


@dataclass(frozen=True)
class RecipeCtx:
    case: CaseFile
    params: Params
    outputs: Mapping[str, JsonValue]
    draft: Draft | None = None

    def p(self, name: str) -> JsonValue:
        value: JsonValue = self.params.model_dump()[name]
        return value

    @property
    def payer_short(self) -> str:
        return self.case.payer.short if self.case.payer else "payer"

    @property
    def claim_id(self) -> str:
        cid = self.params.model_dump().get("claim_id")
        if isinstance(cid, str):
            return cid
        assert self.case.claim is not None, "recipe needs a claim"
        return self.case.claim.id


type Label = Callable[[RecipeCtx], str]
type Args = Callable[[RecipeCtx], dict[str, JsonValue]]


@dataclass(frozen=True)
class RecipeStep:
    name: str
    op: str
    label: Label
    args: Args
    output_key: str | None = None  # where the step's `reference` lands for later steps (e.g. nea_number)


def predicted_file_time(payer: PayerView | None, now: datetime, lead: timedelta = EDIT_LOCK) -> str:
    """The first payer file the work can make, e.g. '11:15' or 'Thu 10:45' (label only; the world decides)."""
    if payer is None or not payer.file_times:
        return "next"
    earliest = now + max(lead, EDIT_LOCK)
    for day in range(8):
        d = (now + timedelta(days=day)).date()
        if d.weekday() >= 5:
            continue
        for hhmm in payer.file_times:
            h, m = (int(x) for x in hhmm.split(":"))
            at = now.replace(year=d.year, month=d.month, day=d.day, hour=h, minute=m, second=0, microsecond=0)
            if at > earliest:
                return hhmm if day == 0 else f"{at:%a} {hhmm}"
    return "next"


def _queue(kind: str, *, cites_new_attachment: bool = False) -> RecipeStep:
    lead = NEA_LEAD if cites_new_attachment else EDIT_LOCK

    def label(c: RecipeCtx) -> str:
        return f"queue for {predicted_file_time(c.case.payer, c.case.now, lead)} {c.payer_short} file"

    return RecipeStep(
        "queue_for_file",
        "vyne.queue",
        label,
        lambda c: {
            "claim_id": c.claim_id,
            "kind": kind,
            "cites_new_attachment": cites_new_attachment,
            "remarks": str(c.outputs.get("remarks") or "") or None,
        },
        output_key="file_time",
    )


def _nea(label: str, source_key: str, kind_key: str) -> RecipeStep:
    return RecipeStep(
        "nea_upload",
        "nea.upload_packet",
        lambda c: label,
        lambda c: {
            "claim_id": c.claim_id,
            "packet_ref": c.outputs.get(source_key),
            "kind": c.outputs.get(kind_key) or "narrative",
        },
        output_key="nea_number",
    )


def _text(ctx: RecipeCtx) -> str:
    return ctx.draft.text if ctx.draft else ""


def _payer_submit(label: Callable[[RecipeCtx], str], op: str, extra: Args) -> RecipeStep:
    return RecipeStep(
        "payer_submit", op, label, lambda c: {"claim_id": c.claim_id, **extra(c)}, output_key="request_ref"
    )


RECIPES: dict[str, tuple[RecipeStep, ...]] = {
    "resubmit_with_attachment": (
        RecipeStep(
            "fetch_image",
            "pms.get_image",
            lambda c: f"fetch {str(c.p('attachment_kind')).upper()} from PMS imaging",
            lambda c: {"image_id": c.p("image_id"), "claim_id": c.claim_id},
            output_key="image_ref",
        ),
        RecipeStep(
            "nea_upload",
            "nea.upload",
            lambda c: "upload to NEA",
            lambda c: {"claim_id": c.claim_id, "image_id": c.p("image_id"), "kind": c.p("attachment_kind")},
            output_key="nea_number",
        ),
        RecipeStep(
            "write_remarks",
            "pms.write_claim_remarks",
            lambda c: "write NEA# to remarks",
            lambda c: {
                "claim_id": c.claim_id,
                "text": (
                    f"NEA# {c.outputs.get('nea_number')} · "
                    f"original claim ICN {c.case.claim.icn if c.case.claim else ''}"
                ),
            },
            output_key="remarks",
        ),
        _queue("resubmit", cites_new_attachment=True),
    ),
    "records_request": (
        RecipeStep(
            "fetch_records",
            "pms.collect_records",
            lambda c: "fetch chart and images from the PMS",
            lambda c: {"claim_id": c.claim_id, "image_ids": c.p("image_ids"), "note_visit_ids": c.p("note_visit_ids")},
            output_key="records_ref",
        ),
        _nea("upload records to NEA", "records_ref", "records_kind"),
        _payer_submit(
            lambda c: f"send records to {c.payer_short}",
            "payer.submit_records",
            lambda c: {"nea_number": c.outputs.get("nea_number")},
        ),
    ),
    "status_check": (
        RecipeStep(
            "payer_contact",
            "payer.check_status",
            lambda c: f"check status · {c.payer_short} {c.p('channel')}",
            lambda c: {"claim_id": c.claim_id, "channel": c.p("channel")},
            output_key="status_ref",
        ),
    ),
    "payer_rep_call": (
        RecipeStep(
            "payer_contact",
            "payer.call_rep",
            lambda c: f"call {c.payer_short} provider services (bounded asks)",
            lambda c: {
                "claim_id": c.claim_id,
                "topic": c.p("topic"),
                "asks": c.p("asks"),
                "may_agree_to": [*sorted(MAY_AGREE_TO)],
            },
            output_key="call_ref",
        ),
    ),
    "reprocessing_request": (
        RecipeStep(
            "render_request",
            "code.render_request",
            lambda c: f"fill {c.payer_short}'s reprocessing form · {str(c.p('basis')).replace('_', ' ')}",
            lambda c: {"claim_id": c.claim_id, "basis": c.p("basis"), "text": _text(c)},
        ),
        _payer_submit(
            lambda c: f"submit to {c.payer_short}",
            "payer.request_reprocessing",
            lambda c: {"basis": c.p("basis")},
        ),
    ),
    "request_835": (
        RecipeStep(
            "payer_contact",
            "payer.request_835",
            lambda c: f"request the 835 from {c.payer_short}",
            lambda c: {"claim_id": c.claim_id},
            output_key="request_ref",
        ),
    ),
    "send_claim_pms_codes": (
        RecipeStep(
            "readiness",
            "code.readiness",
            lambda c: "run 13 readiness checks",
            lambda c: {"claim_id": c.claim_id},
        ),
        _queue("original"),
    ),
    "fix_demographics_resend": (
        RecipeStep(
            "compare_pms",
            "code.compare_pms",
            lambda c: "compare the claim with the PMS record",
            lambda c: {"claim_id": c.claim_id, "field": c.p("field"), "value": c.p("value")},
        ),
        RecipeStep(
            "patch_claim",
            "pms.update_claim_field",
            lambda c: f"set {c.p('field')} to the verified value",
            lambda c: {"claim_id": c.claim_id, "field": c.p("field"), "value": c.p("value")},
        ),
        _queue("original"),
    ),
    "eligibility_check": (
        RecipeStep(
            "payer_contact",
            "payer.check_eligibility",
            lambda c: "verify benefits · portal → 271 → IVR",
            lambda c: {"appointment_id": c.p("appointment_id")},
            output_key="eligibility_ref",
        ),
    ),
    "post_era_line": (
        RecipeStep(
            "match_lines",
            "code.match_lines",
            lambda c: "match remit lines to claim lines",
            lambda c: {"remittance_id": c.p("remittance_id"), "claim_id": c.p("claim_id")},
        ),
        RecipeStep(
            "balance_check",
            "code.balance_check",
            lambda c: "check balance and patient share",
            lambda c: {"remittance_id": c.p("remittance_id")},
        ),
        RecipeStep(
            "pms_post",
            "pms.post_payment",
            lambda c: "post to the PMS ledger",
            lambda c: {"remittance_id": c.p("remittance_id"), "claim_id": c.p("claim_id")},
        ),
    ),
    "update_pms_benefits": (
        RecipeStep(
            "diff_pms",
            "code.diff_pms",
            lambda c: "compare with PMS benefits",
            lambda c: {"patient_id": c.p("patient_id"), "coverage_id": c.p("coverage_id")},
        ),
        RecipeStep(
            "pms_update",
            "pms.update_benefits",
            lambda c: "update PMS benefits",
            lambda c: {"patient_id": c.p("patient_id"), "coverage_id": c.p("coverage_id")},
        ),
    ),
    "send_claim_agent_text": (
        RecipeStep(
            "readiness",
            "code.readiness",
            lambda c: "run 13 readiness checks",
            lambda c: {"claim_id": c.claim_id},
        ),
        RecipeStep(
            "draft_text",
            "vyne.attach_narrative",
            lambda c: "add the reviewed narrative to the claim",
            lambda c: {"claim_id": c.claim_id, "text": _text(c)},
        ),
        _queue("original"),
    ),
    "corrected_claim": (
        RecipeStep(
            "build_corrected",
            "vyne.build_corrected",
            lambda c: "build the corrected claim (frequency 7) and queue it",
            lambda c: {"claim_id": c.claim_id, "reason": c.p("reason")},
            output_key="corrected_claim_id",
        ),
    ),
    "patient_transfer": (
        RecipeStep(
            "transfer",
            "pms.transfer_to_patient",
            lambda c: "move the patient share to the patient ledger",
            lambda c: {"claim_id": c.p("claim_id"), "patient_id": c.p("patient_id"), "cents": c.p("cents")},
        ),
    ),
    "send_statement": (
        RecipeStep(
            "send_statement",
            "patient.send_statement",
            lambda c: "send the patient statement",
            lambda c: {"patient_id": c.p("patient_id")},
        ),
    ),
    "mechanical_refund": (
        RecipeStep(
            "refund",
            "pms.refund_original_tender",
            lambda c: "refund to the original tender",
            lambda c: {"patient_id": c.p("patient_id"), "cents": c.p("cents")},
        ),
    ),
    "cob_order_change": (
        RecipeStep(
            "update_order",
            "pms.update_coverage_order",
            lambda c: "change coverage order in the PMS",
            lambda c: {"patient_id": c.p("patient_id"), "new_primary_coverage_id": c.p("new_primary_coverage_id")},
        ),
        _queue("resubmit"),
    ),
    "hold_claim": (
        RecipeStep(
            "create_hold",
            DOMAIN_OP_HOLD,
            lambda c: f"hold the claim · {str(c.p('reason')).replace('_', ' ')}",
            lambda c: {"claim_id": c.claim_id, "reason": c.p("reason")},
        ),
    ),
}


def recipe_for(action: str) -> tuple[RecipeStep, ...] | None:
    """The recipe, or None for tier 3: those are performed by a person, never by Torch."""
    return RECIPES.get(action)


def _assert_recipes_cover_tiers_1_and_2_only() -> None:
    from torch_rcm.agents.catalog.actions import ACTIONS

    missing = sorted(n for n, s in ACTIONS.items() if s.tier != 3 and n not in RECIPES)
    tier3 = sorted(n for n, s in ACTIONS.items() if s.tier == 3 and n in RECIPES)
    if missing or tier3:
        raise AssertionError(f"actions without a recipe: {missing}; tier-3 actions with one: {tier3}")


_assert_recipes_cover_tiers_1_and_2_only()
