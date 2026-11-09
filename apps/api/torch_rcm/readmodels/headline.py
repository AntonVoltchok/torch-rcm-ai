"""An inbox item's headline: one plain sentence saying what happened, from code facts only.

The words come from the item's situation (the classifier's key, never a model's), the payer's short name, the first
procedure's plain name (`world.fees.PLAIN`), the item's own params and the frozen clock. No model text and no
formatted money: a live run and a deterministic one give the same headline. An item whose situation has no sentence
falls back by kind, then to its `title`.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

from torch_rcm.domain.entities import Appointment, Claim, InboxItem, Rule, Run
from torch_rcm.domain.enums import InboxItemKind, PlannerKind
from torch_rcm.readmodels.claims import age_days
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.world.fees import PLAIN

SCRIPTED = frozenset({PlannerKind.SCRIPTED, PlannerKind.SCRIPTED_FALLBACK})


@dataclass(frozen=True, slots=True)
class Facts:
    payer: str  # "Delta"
    procedure: str  # "crown"
    days: int | None  # since the claim was sent, on the frozen clock
    params: dict[str, object]
    n: int = 1  # claims in the batch the sentence speaks for

    @property
    def subject(self) -> str:
        """'this crown', or 'these 3 crowns' for a batch."""
        if self.n == 1:
            return f"this {self.procedure}"
        plural = self.procedure if self.procedure.endswith("s") else f"{self.procedure}s"
        return f"these {self.n} {plural}"


def _noun(cdt: str | None) -> str:
    """'Crown, PFM' → 'crown'; 'PA x-ray' keeps its capitals."""
    name = PLAIN.get(cdt or "", "").split(",")[0].strip()
    if not name:
        return "claim"
    return name if len(name) > 1 and name[1].isupper() else name[0].lower() + name[1:]


def _rejected(f: Facts) -> str:
    other_id = f.params.get("field") == "subscriber_id" and f.params.get("source") == "271"
    tail = ", and the eligibility response has a different one" if other_id else ""
    return f"{f.payer} rejected the subscriber ID{tail}"


# Longest key first wins, so a specific situation is never read as its family.
SENTENCES: dict[str, Callable[[Facts], str]] = {
    "denied:CO-16:N29:pa_missing": lambda f: f"{f.payer} needs the PA x-ray for {f.subject}",
    "denied:CO-16:M127:records_request": lambda f: f"{f.payer} asked for records before paying {f.subject}",
    "denied:CO-119:frequency_history_conflict": lambda f: (
        f"{f.payer} denied {f.subject} as too frequent; its tooth history doesn't match our chart"
    ),
    "denied:CO-22:cob_order": lambda f: f"{f.payer} says another plan pays first on {f.subject}",
    "denied:CO-50:N10:formal_appeal": lambda f: f"{f.payer} denied {f.subject} as not medically necessary",
    "denied:CO-29:timely_filing_appeal": lambda f: f"{f.payer} says {f.subject} was filed too late",
    "denied:PR-119:max_met": lambda f: "The annual maximum is used up, so the balance goes to the patient",
    "pending:prompt_pay_eligible": lambda f: f"{f.payer} hasn't paid in {f.days} days, past the prompt-pay limit",
    "pending:status_due": lambda f: f"{f.payer} hasn't answered in {f.days} days, so a status check is due",
    "pending:adjudicated_no_835": lambda f: f"{f.payer} has processed this claim, but no 835 has come in",
    "rejected:A7:164": _rejected,
    "variance:deductible_misapplied": lambda f: f"{f.payer} applied a deductible the patient already met",
    "variance:alternate_benefit": lambda f: (
        f"{f.payer} paid the alternate benefit; the difference may be billable to the patient"
    ),
    "era:variance": lambda f: f"{f.payer}'s payment for {f.subject} doesn't match what we expected",
}
_KEYS = sorted(SENTENCES, key=len, reverse=True)

RUN_FAILED = "The agents couldn't finish this; it's back with you"


def situation(snap: Snapshot, item: InboxItem) -> str | None:
    """The classifier's situation for this item: recorded by the executor, else a scripted run's own key. A live
    planner's key is model output and is never read here."""
    recorded = item.payload.get("classifier_situation")
    if isinstance(recorded, str) and recorded:
        return recorded
    run = next((r for r in snap.of(Run) if r.id == item.run_id), None)
    if run is not None and run.planner in SCRIPTED and run.situation_key:
        return run.situation_key
    return None


def _when(snap: Snapshot, start: datetime) -> str:
    days = (start.date() - snap.today).days
    if days in (0, 1):
        day = "today's" if days == 0 else "tomorrow's"
    else:
        day = f"{start:%A}'s" if 1 < days < 7 else f"the {start:%-m/%-d}"
    return f"{day} {start:%-I:%M %p} visit"


def _eligibility(snap: Snapshot, item: InboxItem) -> str | None:
    appt = next((a for a in snap.of(Appointment) if a.id == item.appointment_id), None)
    patient = snap.patients.get(item.patient_id or "")
    if appt is None or patient is None:
        return None
    who, when = patient.display_name, _when(snap, appt.start)
    match item.payload.get("issue"):
        case "over_max":
            return f"{who} reaches the annual maximum at {when}"
        case "frequency":
            cdt = item.payload.get("cdt")
            return f"Too soon for {who}'s plan to cover {_noun(cdt if isinstance(cdt, str) else None)} at {when}"
        case "unverified":
            return f"{who}'s coverage couldn't be verified for {when}"
    return None


def headline(snap: Snapshot, item: InboxItem) -> str:
    if item.kind is InboxItemKind.RUN_FAILED:
        return RUN_FAILED
    if item.kind is InboxItemKind.ELIGIBILITY_FLAG:
        return _eligibility(snap, item) or item.title
    if item.kind is InboxItemKind.OWNER_SIGNOFF:
        rule = next((r for r in snap.of(Rule) if r.id == item.rule_id), None)
        return f"“{rule.label}” needs the owner's signature" if rule else item.title
    claim: Claim | None = snap.claims.get(item.claim_id or "")
    if claim is None:
        return item.title
    facts = Facts(
        payer=snap.payers[claim.payer_key.value].short_name,
        procedure=_noun(claim.lines[0].cdt if claim.lines else None),
        days=age_days(claim, snap.today),
        params=dict(item.proposed_action.params) if item.proposed_action else {},
    )
    key = situation(snap, item)
    match = next((k for k in _KEYS if key and (key == k or key.startswith(k + ":"))), None)
    if match is not None and (facts.days is not None or not match.startswith("pending:")):
        return SENTENCES[match](facts)
    if claim.denial is not None:
        return f"{facts.payer} denied {facts.subject} ({claim.denial.carc})"
    return item.title


def group_headline(snap: Snapshot, items: list[InboxItem], fallback: str) -> str:
    """One sentence for a batch: its members' situation, payer and procedure, counted ("Delta needs the PA x-ray for
    these 3 crowns"). Members that differ in any of those have no one sentence, so the group's title stands."""
    claims = [snap.claims.get(i.claim_id or "") for i in items]
    if not items or any(c is None for c in claims):
        return fallback
    keys = {situation(snap, i) for i in items}
    payers = {snap.payers[c.payer_key.value].short_name for c in claims if c}
    nouns = {_noun(c.lines[0].cdt if c.lines else None) for c in claims if c}
    key = next(iter(keys)) if len(keys) == 1 else None
    match = next((k for k in _KEYS if key and (key == k or key.startswith(k + ":"))), None)
    if match is None or len(payers) != 1 or len(nouns) != 1 or match.startswith("pending:"):
        return fallback
    facts = Facts(payer=payers.pop(), procedure=nouns.pop(), days=None, params={}, n=len(items))
    return SENTENCES[match](facts)
