"""What an approval does, in words, from the action catalog: the button (`phrase`) and "What this does" (`touches`).

Principle: the words come from what runs. `touches` are the effects of the recipe steps that will execute, counted
across a group, plus one line on whether it can be taken back; a step that does not run cannot appear. Tier 3 has no
recipe (a person performs it), so its touches say what is left for that person to post. Sentence case, active, naming
what happens (plan d1-build decision 2; red team d1-api).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from datetime import datetime

from torch_rcm.agents.catalog.actions import follow_up, spec_for
from torch_rcm.agents.catalog.recipes import (
    ATTACHMENT_WORD,
    FIELD_WORD,
    EffectCtx,
    Touch,
    clock,
    dollars,
    predicted_file_time,
    queue_lead,
    recipe_for,
)
from torch_rcm.agents.types import JsonValue, PayerView


@dataclass(frozen=True)
class PhraseCtx:
    params: Mapping[str, JsonValue]
    payer: PayerView | None
    now: datetime
    n: int = 1  # members of a group sharing this action
    drafted: bool = False  # a reviewed agent draft goes with it (`review_draft` items)
    enclosures: tuple[str, ...] = field(default=())

    def p(self, name: str) -> JsonValue:
        return self.params.get(name)

    @property
    def payer_short(self) -> str:
        return self.payer.short if self.payer else "the payer"


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else f"{n} {many}"


def _resubmit(c: PhraseCtx) -> str:
    word = ATTACHMENT_WORD.get(str(c.p("attachment_kind")), ("attachment", "attachment"))[1]
    return f"Send {_plural(c.n, word, word if word.endswith('series') else word + 's')} and resubmit"


def _reprocessing(c: PhraseCtx) -> str:
    if c.drafted:
        return f"Send this note to {c.payer_short}"
    if c.p("basis") == "ny_prompt_pay":
        return "Send prompt-pay request"
    return f"Ask {c.payer_short} to reprocess"


def _post(c: PhraseCtx) -> str:
    then = follow_up("post_era_line", c.params)
    if then is not None and then[0] == "reprocessing_request" and c.p("disputed_cents"):
        return f"Post {c.payer_short}'s payment, ask {c.payer_short} to reprocess {dollars(c.p('disputed_cents'))}"
    if c.p("post") == "patient_share_only" and c.p("disputed_cents"):
        return f"Post {c.payer_short}'s payment, dispute {dollars(c.p('disputed_cents'))}"
    if c.p("post") == "patient_share_only":
        return "Post the patient share"
    return f"Post {c.payer_short}'s payment"


def _write_off(c: PhraseCtx) -> str:
    extra = f", {dollars(c.p('patient_transfer_cents'))} to patient" if c.p("patient_transfer_cents") else ""
    return f"Sign {dollars(c.p('writeoff_cents'))} write-off{extra}"


PHRASES: dict[str, Callable[[PhraseCtx], str]] = {
    "status_check": lambda c: f"Check status with {c.payer_short}",
    "payer_rep_call": lambda c: f"Call {c.payer_short}",
    "records_request": lambda c: f"Send records to {c.payer_short}",
    "resubmit_with_attachment": _resubmit,
    "reprocessing_request": _reprocessing,
    "request_835": lambda c: f"Ask {c.payer_short} for the 835",
    "send_claim_pms_codes": lambda c: f"Send {_plural(c.n, 'claim', 'claims')}",
    "fix_demographics_resend": lambda c: (
        "Update ID and resend"
        if c.p("field") == "subscriber_id"
        else f"Update {FIELD_WORD.get(str(c.p('field')), 'field').lower()} and resend"
    ),
    "eligibility_check": lambda c: "Check eligibility",
    "post_era_line": _post,
    "update_pms_benefits": lambda c: "Update benefits in the PMS",
    "send_claim_agent_text": lambda c: "Send claim with the reviewed narrative",
    "corrected_claim": lambda c: "Send a corrected claim",
    "patient_transfer": lambda c: f"Move {dollars(c.p('cents'))} to patient",
    "send_statement": lambda c: "Send statement",
    "mechanical_refund": lambda c: f"Refund {dollars(c.p('cents'))}",
    "cob_order_change": lambda c: "Change coverage order and resubmit",
    "write_off": _write_off,
    "formal_appeal": lambda c: "Sign formal appeal",
    "void_claim": lambda c: "Sign claim void",
    "discretionary_refund": lambda c: f"Sign {dollars(c.p('cents'))} refund",
    "collections_referral": lambda c: "Sign collections referral",
    "waiver": lambda c: f"Sign {dollars(c.p('cents'))} waiver",
    "hold_claim": lambda c: "Hold claim",
}

# Tier 3: performed by a person. Approving records the signed decision; nothing in TorchRCM posts it.
LEFT_TO_POST: dict[str, Callable[[PhraseCtx], tuple[str, ...]]] = {
    "write_off": lambda c: (
        f"{dollars(c.p('writeoff_cents'))} write-off to post in the PMS",
        *(
            (f"{dollars(c.p('patient_transfer_cents'))} to move to patient balance",)
            if c.p("patient_transfer_cents")
            else ()
        ),
    ),
    "formal_appeal": lambda c: (f"Signed appeal to send to {c.payer_short}",),
    "void_claim": lambda c: (f"Void to file with {c.payer_short}",),
    "discretionary_refund": lambda c: (f"{dollars(c.p('cents'))} refund to issue",),
    "collections_referral": lambda c: ("Referral to make",),
    "waiver": lambda c: (f"{dollars(c.p('cents'))} waiver to post",),
}


def phrase(action: str, c: PhraseCtx) -> str:
    fn = PHRASES.get(action)
    if fn is None:
        spec = spec_for(action)
        return spec.label if spec else action.replace("_", " ").capitalize()
    return fn(c)


def _reversibility(action: str, c: PhraseCtx) -> str | None:
    spec = spec_for(action)
    if spec is None:
        return None
    if spec.reverses_in == "until_file_leaves":
        t = predicted_file_time(c.payer, c.now, queue_lead(action == "resubmit_with_attachment"))
        return "Can be pulled until the file leaves" if t == "next" else f"Can be pulled from the file until {clock(t)}"
    if spec.reverses_in == "until_day_close":
        return "Can be undone until day close"
    if spec.reverses_in == "void_only":
        return "Can only be voided once sent"
    if spec.contacts_payer:
        return "Cannot be recalled once sent"
    return None


def touches(action: str, members: Sequence[PhraseCtx]) -> list[str]:
    """The effects of the steps that will run for every member, counted ("3 x-rays uploaded to NEA"), then whether
    it can be taken back. Members share the action (a group); a single item is a group of one."""
    if not members:
        return []
    first = members[0]
    if action in LEFT_TO_POST:
        lines = ["Signed decision recorded on the claim"]
        for m in members:
            lines += [t for t in LEFT_TO_POST[action](m) if t not in lines]
        return lines
    seen: dict[str, tuple[Touch, int]] = {}  # in recipe-step order; counted touches add up across members
    for m in members:
        ctx = EffectCtx(params=m.params, payer=m.payer, now=m.now, drafted=m.drafted, enclosures=m.enclosures)
        for step in recipe_for(action) or ():
            for t in step.effect(ctx) if step.effect else ():
                have = seen.get(t.one)
                seen[t.one] = (t, (have[1] if have else 0) + 1)
    out = [
        f"{n} {t.one if n == 1 else t.many}" if t.many is not None else t.one[0].upper() + t.one[1:]
        for t, n in seen.values()
    ]
    back = _reversibility(action, first)
    out = [*out, back] if back else out
    nxt = follow_up(action, first.params)  # what the post's `then` queues runs in the same approval
    if nxt is not None and recipe_for(nxt[0]):
        then = [
            replace(m, params=f[1], drafted=False, enclosures=()) for m in members if (f := follow_up(action, m.params))
        ]
        out += [t for t in touches(nxt[0], then) if t not in out]
    return out
