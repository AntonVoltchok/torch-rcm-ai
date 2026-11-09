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


@dataclass(frozen=True)
class EffectCtx:
    """What a step's effect is worded from before anything runs (the Inbox's "What this does"): the action's
    validated params, the payer, and the enclosures' titles. No world reads."""

    params: Mapping[str, JsonValue]
    payer: PayerView | None
    now: datetime
    drafted: bool = False
    enclosures: tuple[str, ...] = ()

    def p(self, name: str) -> JsonValue:
        return self.params.get(name)

    @property
    def payer_short(self) -> str:
        return self.payer.short if self.payer else "the payer"


@dataclass(frozen=True)
class Touch:
    """One thing a step changes outside TorchRCM. `many` set = counted across a group ("3 x-rays uploaded to NEA");
    None = shown as written, once per distinct text."""

    one: str
    many: str | None = None


type Label = Callable[[RecipeCtx], str]
type Args = Callable[[RecipeCtx], dict[str, JsonValue]]
type Effect = Callable[[EffectCtx], tuple[Touch, ...]]


@dataclass(frozen=True)
class RecipeStep:
    name: str
    op: str
    label: Label
    args: Args
    output_key: str | None = None  # where the step's `reference` lands for later steps (e.g. nea_number)
    effect: Effect | None = None  # what it changes outside TorchRCM; None = a read or a local computation


def clock(hhmm: str) -> str:
    """'11:15' → '11:15 AM'; 'Thu 10:45' → 'Thu 10:45 AM'; 'next' → 'next'."""
    day, _, t = hhmm.rpartition(" ")
    if ":" not in t:
        return hhmm
    h, m = (int(x) for x in t.split(":"))
    text = f"{(h - 1) % 12 + 1}:{m:02d} {'AM' if h < 12 else 'PM'}"
    return f"{day} {text}" if day else text


def file_label(payer: PayerView | None, now: datetime, lead: timedelta) -> str:
    """'the 11:15 AM Delta file', or 'the next Delta file' when no file time is known."""
    short = payer.short if payer else "payer"
    t = predicted_file_time(payer, now, lead)
    return f"the next {short} file" if t == "next" else f"the {clock(t)} {short} file"


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


def queue_lead(cites_new_attachment: bool) -> timedelta:
    return NEA_LEAD if cites_new_attachment else EDIT_LOCK


def _queue(kind: str, *, cites_new_attachment: bool = False) -> RecipeStep:
    lead = queue_lead(cites_new_attachment)

    def label(c: RecipeCtx) -> str:
        return f"Queue for {file_label(c.case.payer, c.case.now, lead)}"

    def effect(c: EffectCtx) -> tuple[Touch, ...]:
        where = file_label(c.payer, c.now, lead)
        return (Touch(f"claim in {where}", f"claims in {where}"),)

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
        effect=effect,
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
        effect=lambda c: (Touch("records packet uploaded to NEA", "records packets uploaded to NEA"),),
    )


ATTACHMENT_WORD: dict[str, tuple[str, str]] = {
    "pa": ("PA x-ray", "x-ray"),
    "bwx": ("bitewing x-ray", "x-ray"),
    "fmx": ("full-mouth x-ray series", "x-ray series"),
    "perio_chart": ("perio chart", "perio chart"),
    "narrative": ("narrative", "narrative"),
}  # (as a step names it, as a count names it)
FIELD_WORD = {
    "subscriber_id": "Subscriber ID",
    "group_no": "Group number",
    "patient_dob": "Date of birth",
    "rendering_npi": "Rendering NPI",
}


def dollars(cents: JsonValue) -> str:
    """Prose only ("Move $38 to patient"); every numeric field stays integer cents."""
    value = int(cents) if isinstance(cents, int) else 0
    whole, part = divmod(value, 100)
    return f"${whole:,}" if part == 0 else f"${whole:,}.{part:02d}"


def _counted(word: str, rest: str) -> Touch:
    plural = word if word.endswith("series") else f"{word}s"
    return Touch(f"{word} {rest}", f"{plural} {rest}")


def _text(ctx: RecipeCtx) -> str:
    return ctx.draft.text if ctx.draft else ""


def _payer_submit(label: Callable[[RecipeCtx], str], op: str, extra: Args, effect: Effect) -> RecipeStep:
    return RecipeStep(
        "payer_submit",
        op,
        label,
        lambda c: {"claim_id": c.claim_id, **extra(c)},
        output_key="request_ref",
        effect=effect,
    )


CHANNEL_WORD = {"portal": "portal", "ivr": "phone line", "x12_276": "276 inquiry"}
BASIS_WORD = {
    "ny_prompt_pay": "prompt-pay",
    "deductible_misapplied": "deductible correction",
    "payer_history_error": "history correction",
}


def _reprocessing_effect(c: EffectCtx) -> tuple[Touch, ...]:
    noun = "note" if c.drafted else ("prompt-pay request" if c.p("basis") == "ny_prompt_pay" else "request")
    sent = _counted(noun, f"sent to {c.payer_short}")
    return (sent, *(Touch(f"{title} enclosed") for title in c.enclosures))


def _post_effect(c: EffectCtx) -> tuple[Touch, ...]:
    if c.p("post") != "patient_share_only":
        return (
            Touch(
                f"{c.payer_short} payment posted to the PMS ledger",
                f"{c.payer_short} payments posted to the PMS ledger",
            ),
        )
    out = [Touch(f"{c.payer_short} payment posted, patient share only")]
    if c.p("patient_cents"):
        out.append(Touch(f"{dollars(c.p('patient_cents'))} moved to patient balance"))
    if c.p("disputed_cents"):
        out.append(Touch(f"{dollars(c.p('disputed_cents'))} held as disputed"))
    return tuple(out)


RECIPES: dict[str, tuple[RecipeStep, ...]] = {
    "resubmit_with_attachment": (
        RecipeStep(
            "fetch_image",
            "pms.get_image",
            lambda c: f"Fetch the {ATTACHMENT_WORD[str(c.p('attachment_kind'))][0]} from imaging",
            lambda c: {"image_id": c.p("image_id"), "claim_id": c.claim_id},
            output_key="image_ref",
        ),
        RecipeStep(
            "nea_upload",
            "nea.upload",
            lambda c: "Upload to NEA",
            lambda c: {"claim_id": c.claim_id, "image_id": c.p("image_id"), "kind": c.p("attachment_kind")},
            output_key="nea_number",
            effect=lambda c: (_counted(ATTACHMENT_WORD[str(c.p("attachment_kind"))][1], "uploaded to NEA"),),
        ),
        RecipeStep(
            "write_remarks",
            "pms.write_claim_remarks",
            lambda c: "Write the NEA# and original ICN in the claim remarks",
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
            lambda c: "Collect the chart notes and images from the PMS",
            lambda c: {"claim_id": c.claim_id, "image_ids": c.p("image_ids"), "note_visit_ids": c.p("note_visit_ids")},
            output_key="records_ref",
        ),
        _nea("Upload the records to NEA", "records_ref", "records_kind"),
        _payer_submit(
            lambda c: f"Send the records to {c.payer_short}",
            "payer.submit_records",
            lambda c: {"nea_number": c.outputs.get("nea_number")},
            lambda c: (Touch(f"set of records sent to {c.payer_short}", f"sets of records sent to {c.payer_short}"),),
        ),
    ),
    "status_check": (
        RecipeStep(
            "payer_contact",
            "payer.check_status",
            lambda c: f"Check status with {c.payer_short} ({CHANNEL_WORD[str(c.p('channel'))]})",
            lambda c: {"claim_id": c.claim_id, "channel": c.p("channel")},
            output_key="status_ref",
            effect=lambda c: (Touch(f"status check with {c.payer_short}", f"status checks with {c.payer_short}"),),
        ),
    ),
    "payer_rep_call": (
        RecipeStep(
            "payer_contact",
            "payer.call_rep",
            lambda c: f"Call {c.payer_short} provider services (fixed questions only)",
            lambda c: {
                "claim_id": c.claim_id,
                "topic": c.p("topic"),
                "asks": c.p("asks"),
                "may_agree_to": [*sorted(MAY_AGREE_TO)],
            },
            output_key="call_ref",
            effect=lambda c: (
                Touch(f"call to {c.payer_short} provider services", f"calls to {c.payer_short} provider services"),
            ),
        ),
    ),
    "reprocessing_request": (
        RecipeStep(
            "render_request",
            "code.render_request",
            lambda c: f"Fill in {c.payer_short}'s reprocessing form ({BASIS_WORD[str(c.p('basis'))]})",
            lambda c: {"claim_id": c.claim_id, "basis": c.p("basis"), "text": _text(c)},
        ),
        _payer_submit(
            lambda c: f"Submit to {c.payer_short}" + (" with the enclosures" if c.p("attach") else ""),
            "payer.request_reprocessing",
            lambda c: {"basis": c.p("basis"), "attach": c.p("attach")},
            _reprocessing_effect,
        ),
    ),
    "request_835": (
        RecipeStep(
            "payer_contact",
            "payer.request_835",
            lambda c: f"Ask {c.payer_short} for the 835",
            lambda c: {"claim_id": c.claim_id},
            output_key="request_ref",
            effect=lambda c: (Touch(f"835 requested from {c.payer_short}"),),
        ),
    ),
    "send_claim_pms_codes": (
        RecipeStep(
            "readiness",
            "code.readiness",
            lambda c: "Run the 13 readiness checks",
            lambda c: {"claim_id": c.claim_id},
        ),
        _queue("original"),
    ),
    "fix_demographics_resend": (
        RecipeStep(
            "compare_pms",
            "code.compare_pms",
            lambda c: "Compare the claim with the PMS record",
            lambda c: {"claim_id": c.claim_id, "field": c.p("field"), "value": c.p("value")},
        ),
        RecipeStep(
            "patch_claim",
            "pms.update_claim_field",
            lambda c: f"Set the {FIELD_WORD[str(c.p('field'))].lower()} on the claim",
            lambda c: {"claim_id": c.claim_id, "field": c.p("field"), "value": c.p("value")},
            effect=lambda c: (Touch(f"{FIELD_WORD[str(c.p('field'))]} on this claim changed"),),
        ),
        _queue("original"),
    ),
    "eligibility_check": (
        RecipeStep(
            "payer_contact",
            "payer.check_eligibility",
            lambda c: "Verify benefits (portal, then 271, then phone line)",
            lambda c: {"appointment_id": c.p("appointment_id")},
            output_key="eligibility_ref",
            effect=lambda c: (Touch(f"benefits check with {c.payer_short}", f"benefits checks with {c.payer_short}"),),
        ),
    ),
    "post_era_line": (
        RecipeStep(
            "match_lines",
            "code.match_lines",
            lambda c: "Match the remittance lines to the claim lines",
            lambda c: {"remittance_id": c.p("remittance_id"), "claim_id": c.p("claim_id")},
        ),
        RecipeStep(
            "balance_check",
            "code.balance_check",
            lambda c: "Check the balance and the patient share",
            lambda c: {"remittance_id": c.p("remittance_id")},
        ),
        RecipeStep(
            "pms_post",
            "pms.post_payment",
            lambda c: "Post to the PMS ledger",
            lambda c: {"remittance_id": c.p("remittance_id"), "claim_id": c.p("claim_id")},
            effect=_post_effect,
        ),
    ),
    "update_pms_benefits": (
        RecipeStep(
            "diff_pms",
            "code.diff_pms",
            lambda c: "Compare with the benefits in the PMS",
            lambda c: {"patient_id": c.p("patient_id"), "coverage_id": c.p("coverage_id")},
        ),
        RecipeStep(
            "pms_update",
            "pms.update_benefits",
            lambda c: "Update the benefits in the PMS",
            lambda c: {"patient_id": c.p("patient_id"), "coverage_id": c.p("coverage_id")},
            effect=lambda c: (Touch("Benefits updated in the PMS"),),
        ),
    ),
    "send_claim_agent_text": (
        RecipeStep(
            "readiness",
            "code.readiness",
            lambda c: "Run the 13 readiness checks",
            lambda c: {"claim_id": c.claim_id},
        ),
        RecipeStep(
            "draft_text",
            "vyne.attach_narrative",
            lambda c: "Add the reviewed narrative to the claim",
            lambda c: {"claim_id": c.claim_id, "text": _text(c)},
            effect=lambda c: (Touch("Reviewed narrative added to the claim"),),
        ),
        _queue("original"),
    ),
    "corrected_claim": (
        RecipeStep(
            "build_corrected",
            "vyne.build_corrected",
            lambda c: "Build the corrected claim (frequency 7) and queue it",
            lambda c: {"claim_id": c.claim_id, "reason": c.p("reason")},
            output_key="corrected_claim_id",
            effect=lambda c: (Touch("corrected claim queued", "corrected claims queued"),),
        ),
    ),
    "patient_transfer": (
        RecipeStep(
            "transfer",
            "pms.transfer_to_patient",
            lambda c: "Move the patient share to the patient ledger",
            lambda c: {"claim_id": c.p("claim_id"), "patient_id": c.p("patient_id"), "cents": c.p("cents")},
            effect=lambda c: (Touch(f"{dollars(c.p('cents'))} moved to patient balance"),),
        ),
    ),
    "send_statement": (
        RecipeStep(
            "send_statement",
            "patient.send_statement",
            lambda c: "Send the patient statement",
            lambda c: {"patient_id": c.p("patient_id")},
            effect=lambda c: (Touch("statement sent to the patient", "statements sent to patients"),),
        ),
    ),
    "mechanical_refund": (
        RecipeStep(
            "refund",
            "pms.refund_original_tender",
            lambda c: "Refund to the original payment method",
            lambda c: {"patient_id": c.p("patient_id"), "cents": c.p("cents")},
            effect=lambda c: (Touch(f"{dollars(c.p('cents'))} refunded to the original payment method"),),
        ),
    ),
    "cob_order_change": (
        RecipeStep(
            "update_order",
            "pms.update_coverage_order",
            lambda c: "Change the coverage order in the PMS",
            lambda c: {"patient_id": c.p("patient_id"), "new_primary_coverage_id": c.p("new_primary_coverage_id")},
            effect=lambda c: (Touch("Coverage order changed in the PMS"),),
        ),
        _queue("resubmit"),
    ),
    "hold_claim": (
        RecipeStep(
            "create_hold",
            DOMAIN_OP_HOLD,
            lambda c: f"Hold the claim ({str(c.p('reason')).replace('_', ' ')})",
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
