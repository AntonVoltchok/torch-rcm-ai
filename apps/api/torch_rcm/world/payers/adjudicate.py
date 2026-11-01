"""Payer adjudication: claim lines in, balanced 835 remittance lines out.

Every line satisfies `billed = paid + Σadj + patient_cents` where `adj` holds CO/OA adjustments and
`patient_adj` (summing to `patient_cents`) holds PR adjustments. Denials carry a CARC·RARC pair.

Pure: no I/O, no clock. The world wraps it (torch_rcm/world/payers/sim.py) to read the payer's own claim state.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from torch_rcm.domain.enums import AdjGroup, ClaimStatus, LineMatch
from torch_rcm.domain.values import Adjustment, PlanBenefits
from torch_rcm.world.fees import ALTERNATE_BENEFIT, Category, PlanSchedule, category
from torch_rcm.world.payers.profiles import PayerProfile

#: CARC·RARC decoding used on remittances, timelines and the denials worklist.
DECODE: dict[str, str] = {
    "CO-16": "Claim lacks information needed for adjudication",
    "CO-16:N29": "Missing documentation: pre-operative radiograph required",
    "CO-16:M127": "Records requested: send the chart and radiographs",
    "CO-119": "Benefit maximum or frequency for this period has been reached",
    "PR-119": "Annual maximum met: patient responsibility",
    "CO-197": "Pre-authorization absent",
    "CO-204": "Service not covered under the patient's plan",
    "CO-22": "Care may be covered by another payer (coordination of benefits)",
    "CO-29": "The time limit for filing has expired",
    "CO-50:N10": "Not deemed medically necessary after consultant review",
    "OA-23": "Prior payer's adjudication (secondary claim)",
    "CO-45": "Charge exceeds the contracted fee schedule",
    "PR-1": "Deductible",
    "PR-2": "Coinsurance",
    "PR-186": "Alternate benefit: paid at the amalgam rate",
}


def decode(carc: str, rarc: str | None = None) -> str:
    return DECODE.get(f"{carc}:{rarc}" if rarc else carc) or DECODE.get(carc, carc)


#: Adjustment codes that reduce a payment without denying the line.
NOT_DENIAL_CODES = frozenset({"45", "23", "1", "2", "186"})


@dataclass(frozen=True, slots=True)
class LineIn:
    id: str
    cdt: str
    fee_cents: int
    tooth: str | None = None


@dataclass(frozen=True, slots=True)
class Outcome:
    """A pinned or rule-driven outcome. `codes` limits it to lines with those CDT codes (empty = all lines)."""

    carc: str  # "CO-16", "PR-119", "PR-1" (posting error amount in `cents`)
    rarc: str | None = None
    codes: tuple[str, ...] = ()
    cents: int = 0

    @classmethod
    def parse(cls, spec: str) -> Outcome:
        """`CO-16:N29@D2740`, `CO-50:N10`, `PR-1=3200@D2392`."""
        codes: tuple[str, ...] = ()
        cents = 0
        if "@" in spec:
            spec, code_part = spec.split("@", 1)
            codes = tuple(code_part.split("+"))
        if "=" in spec:
            spec, cents_part = spec.split("=", 1)
            cents = int(cents_part)
        carc, _, rarc = spec.partition(":")
        return cls(carc=carc, rarc=rarc or None, codes=codes, cents=cents)

    def applies(self, cdt: str) -> bool:
        return not self.codes or cdt in self.codes

    @property
    def is_posting_error(self) -> bool:
        return self.carc == "PR-1"


@dataclass(slots=True)
class BenefitState:
    """Running deductible and annual-max state while one claim's lines are adjudicated."""

    deductible_remaining: int
    max_remaining: int

    @classmethod
    def from_plan(cls, plan: PlanBenefits) -> BenefitState:
        return cls(plan.deductible_remaining_cents, plan.remaining_max_cents)


@dataclass(frozen=True, slots=True)
class LineOut:
    line_id: str
    cdt: str
    billed: int
    allowed: int
    paid: int
    adj: tuple[Adjustment, ...]
    patient_adj: tuple[Adjustment, ...]
    rarc: str | None = None
    match: LineMatch = LineMatch.AUTO

    @property
    def patient_cents(self) -> int:
        return sum(a.cents for a in self.patient_adj)

    @property
    def balances(self) -> bool:
        return self.billed == self.paid + sum(a.cents for a in self.adj) + self.patient_cents

    @property
    def denied(self) -> bool:
        return self.paid == 0 and any(a.code not in NOT_DENIAL_CODES for a in (*self.adj, *self.patient_adj))


@dataclass(frozen=True, slots=True)
class ClaimResult:
    lines: tuple[LineOut, ...]
    status: ClaimStatus
    denial_carc: str | None
    denial_rarc: str | None
    benefit_state: BenefitState = field(compare=False)

    @property
    def paid(self) -> int:
        return sum(line.paid for line in self.lines)

    @property
    def allowed(self) -> int:
        return sum(line.allowed for line in self.lines)

    @property
    def patient(self) -> int:
        return sum(line.patient_cents for line in self.lines)

    @property
    def contractual(self) -> int:
        return sum(a.cents for line in self.lines for a in line.adj if a.code == "45")


def _pct(plan: PlanBenefits, cat: Category) -> int:
    if cat is Category.PREVENTIVE:
        return plan.pct_preventive
    if cat is Category.BASIC:
        return plan.pct_basic
    if cat is Category.MAJOR:
        return plan.pct_major
    return 0


def _adj(group: AdjGroup, code: str, cents: int) -> Adjustment:
    return Adjustment(group=group, code=code, cents=cents)


def _denied_line(line: LineIn, outcome: Outcome, allowed: int) -> LineOut:
    """A denial line. CO denials write the whole charge off the payer side; PR denials move allowed to the
    patient (e.g. PR-119 annual max met: the contractual CO-45 still applies)."""
    group_name, _, code = outcome.carc.partition("-")
    group = AdjGroup(group_name)
    if group is AdjGroup.PR:
        return LineOut(
            line.id,
            line.cdt,
            line.fee_cents,
            allowed,
            0,
            (_adj(AdjGroup.CO, "45", line.fee_cents - allowed),),
            (_adj(AdjGroup.PR, code, allowed),),
            rarc=outcome.rarc,
        )
    return LineOut(line.id, line.cdt, line.fee_cents, 0, 0, (_adj(group, code, line.fee_cents),), (), rarc=outcome.rarc)


def _paid_line(
    line: LineIn,
    *,
    payer: PayerProfile,
    plan: PlanBenefits,
    schedule: PlanSchedule,
    state: BenefitState,
    alternate_benefit: bool,
    posting_error_cents: int,
    other_paid: int,
    secondary: bool,
) -> LineOut:
    cat = category(line.cdt)
    allowed = min(schedule.allowed(line.cdt, line.fee_cents), line.fee_cents)
    adj: list[Adjustment] = [_adj(AdjGroup.CO, "45", line.fee_cents - allowed)]
    pr: list[Adjustment] = []

    if cat is Category.NON_COVERED or _pct(plan, cat) == 0:
        group = AdjGroup.CO if payer.no_balance_billing else AdjGroup.PR
        target = adj if group is AdjGroup.CO else pr
        target.append(_adj(group, "204", allowed))
        return LineOut(line.id, line.cdt, line.fee_cents, allowed, 0, tuple(adj), tuple(pr))

    if secondary:
        return _secondary_line(line, allowed, adj, round(allowed * _pct(plan, cat) / 100), other_paid, state)

    benefit_base = allowed
    alt = ALTERNATE_BENEFIT.get(line.cdt) if alternate_benefit else None
    if alt is not None:
        alt_allowed = min(schedule.allowed(alt), allowed)
        if alt_allowed < allowed:
            pr.append(_adj(AdjGroup.PR, "186", allowed - alt_allowed))
            benefit_base = alt_allowed

    deductible = 0
    if cat is not Category.PREVENTIVE:
        deductible = min(state.deductible_remaining, benefit_base)
        state.deductible_remaining -= deductible
    deductible += min(posting_error_cents, benefit_base - deductible)
    if deductible:
        pr.append(_adj(AdjGroup.PR, "1", deductible))

    coins_base = benefit_base - deductible
    benefit = round(coins_base * _pct(plan, cat) / 100)
    coinsurance = coins_base - benefit
    if coinsurance:
        pr.append(_adj(AdjGroup.PR, "2", coinsurance))
    paid = min(benefit, state.max_remaining)
    state.max_remaining -= paid
    if paid < benefit:
        pr.append(_adj(AdjGroup.PR, "119", benefit - paid))
    return _balanced(line, allowed, paid, adj, pr)


def _secondary_line(
    line: LineIn, allowed: int, adj: list[Adjustment], benefit: int, other_paid: int, state: BenefitState
) -> LineOut:
    """Coordination of benefits: the secondary pays up to its own benefit, never beyond its allowed amount
    minus what the primary paid (OA-23). What is left inside its allowed amount stays with the patient."""
    applied_other = min(other_paid, allowed)
    paid = min(benefit, allowed - applied_other, state.max_remaining)
    state.max_remaining -= paid
    adj.append(_adj(AdjGroup.OA, "23", applied_other))
    pr: list[Adjustment] = []
    remainder = allowed - applied_other - paid
    if remainder:
        pr.append(_adj(AdjGroup.PR, "2", remainder))
    return _balanced(line, allowed, paid, adj, pr)


def _balanced(line: LineIn, allowed: int, paid: int, adj: list[Adjustment], pr: list[Adjustment]) -> LineOut:
    """Final guard: fold any rounding remainder into CO-45 so the line balances to the cent."""
    gap = line.fee_cents - paid - sum(a.cents for a in adj) - sum(a.cents for a in pr)
    if gap:
        first = adj[0]
        adj[0] = _adj(first.group, first.code, first.cents + gap)
    out = LineOut(line.id, line.cdt, line.fee_cents, allowed, paid, tuple(adj), tuple(pr))
    assert out.balances, out
    return out


def adjudicate(
    lines: list[LineIn],
    *,
    payer: PayerProfile,
    plan: PlanBenefits,
    schedule: PlanSchedule,
    attachments: frozenset[str] = frozenset(),
    payer_crown_history: dict[str, int] | None = None,
    outcome: Outcome | None = None,
    alternate_benefit: bool | None = None,
    other_paid: dict[str, int] | None = None,
) -> ClaimResult:
    """Adjudicate one claim.

    `payer_crown_history` maps tooth → months since the payer's recorded crown on that tooth.
    `other_paid` (secondary claims) maps line id → what the primary paid on it.
    """
    state = BenefitState.from_plan(plan)
    rule_outcome = outcome or _rule_outcome(lines, payer, attachments, payer_crown_history or {})
    alt = next(v for v in (alternate_benefit, plan.alternate_benefit, payer.alternate_benefit) if v is not None)
    out: list[LineOut] = []
    for line in lines:
        allowed = min(schedule.allowed(line.cdt, line.fee_cents), line.fee_cents)
        if rule_outcome and not rule_outcome.is_posting_error and rule_outcome.applies(line.cdt):
            out.append(_denied_line(line, rule_outcome, allowed))
            continue
        error = (
            rule_outcome.cents
            if rule_outcome and rule_outcome.is_posting_error and rule_outcome.applies(line.cdt)
            else 0
        )
        out.append(
            _paid_line(
                line,
                payer=payer,
                plan=plan,
                schedule=schedule,
                state=state,
                alternate_benefit=alt,
                posting_error_cents=error,
                other_paid=(other_paid or {}).get(line.id, 0),
                secondary=other_paid is not None,
            )
        )
    return _result(tuple(out), rule_outcome, state)


def _rule_outcome(
    lines: list[LineIn], payer: PayerProfile, attachments: frozenset[str], crown_history: dict[str, int]
) -> Outcome | None:
    """Signature payer rules that deny without a pinned outcome."""
    for line in lines:
        if line.cdt in payer.requires_pa and "pa" not in attachments:
            return Outcome("CO-16", "N29")  # the claim waits for the PA; dependent lines go with it
        if (
            payer.crown_frequency_months
            and line.cdt.startswith("D27")
            and line.tooth is not None
            and crown_history.get(line.tooth, 10_000) < payer.crown_frequency_months
        ):
            return Outcome("CO-119")
    return None


def _result(lines: tuple[LineOut, ...], outcome: Outcome | None, state: BenefitState) -> ClaimResult:
    denied = [line for line in lines if line.denied]
    if denied and len(denied) == len(lines):
        status = ClaimStatus.DENIED
    elif denied or (outcome is not None and outcome.is_posting_error):
        status = ClaimStatus.PARTIAL
    else:
        status = ClaimStatus.PAID
    carc = outcome.carc if outcome and (denied or outcome.is_posting_error) else None
    rarc = outcome.rarc if outcome and denied else None
    if carc is None and denied:
        # A denial that came from benefit math (e.g. annual max met) rather than a payer rule: name it by the
        # first adjustment that denied a line.
        adj = next(a for line in denied for a in (*line.adj, *line.patient_adj) if a.code not in NOT_DENIAL_CODES)
        carc = f"{adj.group.value}-{adj.code}"
    return ClaimResult(lines, status, carc, rarc, state)
