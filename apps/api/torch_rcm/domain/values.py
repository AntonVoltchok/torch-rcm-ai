"""Value objects embedded in entities (stored as JSON columns). Money is integer cents."""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

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


class Confidence(Value):
    pct: int | None  # None = "no base rate" (n < 5)
    basis: str


class BaseRate(Value):
    n: int
    k: int

    def pct(self) -> int | None:
        """Whole-percent base rate, or None when the sample is too small to show (n < 5)."""
        if self.n < 5:
            return None
        return round(100 * self.k / self.n)


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
