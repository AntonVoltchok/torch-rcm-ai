"""Value objects embedded in entities (stored as JSON columns). Money is integer cents."""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from torch_rcm.domain.enums import (
    AdjGroup,
    CheckStatus,
    ClaimStatus,
    DeadlineKind,
    MoveWho,
    PayerKey,
    ReadinessKey,
    RootCause,
    RuleAction,
)


class Value(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class Adjustment(Value):
    """One CAS adjustment on a remittance line: group code + CARC + cents (positive = reduces payment)."""

    group: AdjGroup
    code: str
    cents: int


class Denial(Value):
    carc: str  # e.g. "CO-16"
    rarc: str | None  # e.g. "N29"
    decoded: str
    root_cause: RootCause


class Deadline(Value):
    kind: DeadlineKind
    due_on: date | None
    basis: str


class Frequency(Value):
    cdt: str
    per_months: int
    last_done: date | None = None


class PlanBenefits(Value):
    annual_max_cents: int
    deductible_cents: int
    deductible_met_cents: int
    used_cents: int
    #: When the PMS tracked the deductible as met (from the EOB that met it); None = not tracked.
    deductible_met_on: date | None = None
    pct_preventive: int  # whole percent: 100, 80, 50
    pct_basic: int
    pct_major: int
    frequencies: list[Frequency] = Field(default_factory=list)
    missing_tooth_clause: bool = False
    waiting_period_days: int = 0
    #: Plan-level alternate-benefit provision; None = the payer's default.
    alternate_benefit: bool | None = None
    #: Plan-specific contract schedule key (e.g. "delta_ppo", "delta_premier", "guardian_00512").
    fee_schedule: str = ""

    @property
    def remaining_max_cents(self) -> int:
        return max(self.annual_max_cents - self.used_cents, 0)

    @property
    def deductible_remaining_cents(self) -> int:
        return max(self.deductible_cents - self.deductible_met_cents, 0)


class ReadinessCheck(Value):
    key: ReadinessKey
    status: CheckStatus
    detail: str


MIN_BASE_RATE_N = 5  # below this many past cases there is no percent to show


def base_rate_pct(k: int, n: int) -> int | None:
    """Whole-percent base rate, or None when the sample is too small to show (n < 5)."""
    return round(100 * k / n) if n >= MIN_BASE_RATE_N else None


def track_record_errors(k: int, n: int, pct: int | None) -> list[str]:
    """A track record is k of n past cases; its percent is derived from them, never stated on its own."""
    if not 0 <= k <= n:
        return [f"k={k} must be between 0 and n={n}"]
    if pct != base_rate_pct(k, n):
        return [f"pct={pct} is not the base rate of {k} of {n} ({base_rate_pct(k, n)})"]
    return []


class Confidence(Value):
    """A track record: `k` of `n` past cases like this one ended `outcome`. `pct` is set only when n ≥ 5, and
    `basis` is the sentence screens show ("23 of 25 … paid within 30 days", or why there is no record yet)."""

    pct: int | None
    k: int
    n: int
    outcome: str
    basis: str

    @model_validator(mode="after")
    def _derived(self) -> Confidence:
        if errors := track_record_errors(self.k, self.n, self.pct):
            raise ValueError("; ".join(errors))
        return self


METRIC_PHRASE = {"paid_30d": "paid within 30 days", "accepted": "accepted", "balanced": "balanced"}


def metric_phrase(metric: str | None) -> str:
    """What a rule's outcome metric counts, as the end of "23 of 25 …"."""
    return METRIC_PHRASE.get(metric or "", "succeeded")


def track_record(k: int, n: int, outcome: str) -> Confidence:
    """k of n past cases ended `outcome`. Under five cases there is no percent, and the basis says so after the count
    ("3 of 4 paid within 30 days, too few for a rate"): what counted as success stays visible."""
    if n == 0:
        return Confidence(pct=None, k=0, n=0, outcome=outcome, basis="No past cases like this yet.")
    if n < MIN_BASE_RATE_N:
        basis = f"{k} of {n} {outcome}, too few for a rate"
        return Confidence(pct=None, k=k, n=n, outcome=outcome, basis=basis)
    return Confidence(pct=base_rate_pct(k, n), k=k, n=n, outcome=outcome, basis=f"{k} of {n} {outcome}")


class BaseRate(Value):
    n: int
    k: int

    def pct(self) -> int | None:
        """Whole-percent base rate, or None when the sample is too small to show (n < 5)."""
        return base_rate_pct(self.k, self.n)


class RuleScope(Value):
    payer_key: PayerKey | None = None
    item_type: str = "all"
    max_cents: int | None = None

    def specificity(self) -> int:
        """Most-specific-wins ordering: payer x item x cap > payer x item > item > all (07-agents §5.1)."""
        score = 0
        if self.item_type != "all":
            score += 1
        if self.payer_key is not None:
            score += 2
        if self.max_cents is not None:
            score += 1
        return score


class ProposedAction(Value):
    action: RuleAction
    params: dict[str, Any] = Field(default_factory=dict)
    cents: int = 0
    requires_hold_window: bool = False


class ProposalEvidence(Value):
    approved: int
    total: int
    outcome_k: int
    outcome_n: int


class Usage(Value):
    model_calls: int = 0
    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_write: int = 0
    cost_usd_micros: int = 0


class ClaimOutcome(Value):
    """A run's effect on its own claim, read when the run ends (`Run.claim_outcome`). Only that claim, so other jobs
    in the same advance can't leak in; part of the eval `RunShape`, so deterministic and live must agree."""

    status_from: ClaimStatus
    status_to: ClaimStatus
    move_from: MoveWho
    move_to: MoveWho
