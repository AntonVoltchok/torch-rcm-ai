"""Learning (07 §6): pure functions over seeded per-slice stats. No runtime learning service.

Principle: the model proposes; code gates and executes. A rule proposal is computed from counts a person
produced (approvals, outcomes), never from a model. Only tier-1 actions with an outcome metric learn; an
edited approval does not count as approved (the agent got a detail wrong); root cause `ours` yields only a
*guarded* proposal that can never be accepted (`policy.guard_root_cause_ours` → 422).

Thresholds: n ≥ 20, approved_unedited / n ≥ 0.90, outcome_n ≥ 20, outcome_k / outcome_n ≥ 0.85,
reversals_30d == 0. Demotion (designed, not built at runtime): 2 reversals in 30 d, or a rolling outcome
below 85% → `auto → ask`.
"""

from __future__ import annotations

import math
from fractions import Fraction

from torch_rcm.agents.case import claim_root_cause
from torch_rcm.agents.catalog.actions import ACTIONS
from torch_rcm.agents.policy import guard_root_cause_ours
from torch_rcm.agents.tools.adapters import StoreDomain
from torch_rcm.agents.types import Frozen, OutcomeMetric, PayerKey, RuleScope

MIN_N = 20
MIN_APPROVAL = Fraction(90, 100)
MIN_OUTCOME_N = 20
MIN_OUTCOME = Fraction(85, 100)
DEMOTE_REVERSALS_30D = 2
DRAFT_CONFIDENCE_FLOOR = 0.90
CAP_STEP_CENTS = 50_000  # max_cents = p95(billed) rounded up to $500


class SliceStats(Frozen):
    """`learning_stats` row for a slice `(payer_key, item_type, action, root_cause_class)`."""

    payer_key: PayerKey
    item_type: str
    action: str
    root_cause_class: str = "payer"
    outcome_metric: OutcomeMetric = "none"
    n: int
    approved_unedited: int
    rejected: int = 0
    outcome_n: int = 0
    outcome_k: int = 0
    reversals_30d: int = 0
    billed_cents: tuple[int, ...] = ()


class Eligibility(Frozen):
    eligible: bool
    guarded: bool = False  # `ours`: shown as a proposal, accepting it is refused
    shortfall: tuple[str, ...] = ()

    def __bool__(self) -> bool:
        return self.eligible


def proposal_eligible(s: SliceStats) -> Eligibility:
    """Edges are inclusive at the threshold (20/20, exactly 90%, exactly 85%) and exact (no float rounding)."""
    short: list[str] = []
    spec = ACTIONS.get(s.action)
    if spec is None or spec.tier != 1:
        short.append("only tier-1 actions learn")
    if s.outcome_metric == "none":
        short.append("no outcome metric")
    if s.n < MIN_N:
        short.append(f"{s.n} of {MIN_N} needed")
    if s.n == 0 or Fraction(s.approved_unedited, s.n) < MIN_APPROVAL:
        short.append(f"approved unedited {s.approved_unedited} of {s.n} (< 90%)")
    if s.outcome_n < MIN_OUTCOME_N:
        short.append(f"{s.outcome_n} of {MIN_OUTCOME_N} outcomes needed")
    elif Fraction(s.outcome_k, s.outcome_n) < MIN_OUTCOME:
        short.append(f"outcome {s.outcome_k} of {s.outcome_n} (< 85%)")
    if s.reversals_30d > 0:
        short.append(f"{s.reversals_30d} reversal(s) in 30 d")
    return Eligibility(eligible=not short, guarded=s.root_cause_class == "ours", shortfall=tuple(short))


def acceptable(s: SliceStats) -> bool:
    """Eligible and not guarded: the only proposals `POST /rule-proposals/{id}:accept` may accept."""
    e = proposal_eligible(s)
    if not e.eligible:
        return False
    try:
        guard_root_cause_ours(s.root_cause_class)
    except ValueError:
        return False
    return True


def assert_learnable(dom: StoreDomain, claim_id: str | None, *stated: str | None) -> None:
    """Every cause on record for a slice, and the one code computes now, through the one guard."""
    for cause in (*stated, claim_root_cause(dom, claim_id) if claim_id else None):
        if cause:
            guard_root_cause_ours(cause)


class RuleDraft(Frozen):
    action: str
    tier: int
    mode: str
    scope: RuleScope
    confidence_floor: float
    outcome_metric: OutcomeMetric
    root_cause_class: str
    base_rule_id: str | None = None

    def as_rule_draft(self) -> dict[str, object]:
        """The `RuleProposal.rule_draft` dict shape the seed uses."""
        out: dict[str, object] = {
            "action": self.action,
            "tier": self.tier,
            "mode": self.mode,
            "scope": self.scope.model_dump(),
            "confidence_floor": self.confidence_floor,
            "outcome_metric": self.outcome_metric,
            "root_cause_class": self.root_cause_class,
        }
        if self.base_rule_id:
            out["rule_id"] = self.base_rule_id
        return out


def p95_cap(billed_cents: tuple[int, ...] | list[int]) -> int | None:
    """Nearest-rank p95 of billed amounts, rounded up to the next $500 (an exact multiple stays)."""
    if not billed_cents:
        return None
    ordered = sorted(billed_cents)
    rank = max(1, math.ceil(0.95 * len(ordered)))
    p95 = ordered[rank - 1]
    return max(CAP_STEP_CENTS, -(-p95 // CAP_STEP_CENTS) * CAP_STEP_CENTS)


def draft_rule(payer_key: PayerKey, action: str, s: SliceStats, *, base_rule_id: str | None = None) -> RuleDraft:
    """mode=auto, confidence_floor=0.90, max_cents = p95(billed) rounded up to $500 (gives '< $2,000').

    Refuses a slice that is not eligible, or whose metric is `none`, so no learned rule can violate the
    policy invariants (`assert_invariants`: learned ⇒ tier 1 with an outcome metric).
    """
    if (payer_key, action) != (s.payer_key, s.action):
        raise ValueError("stats belong to a different slice")
    elig = proposal_eligible(s)
    if not elig.eligible:
        raise ValueError("slice is not eligible: " + "; ".join(elig.shortfall))
    return RuleDraft(
        action=action,
        tier=1,
        mode="auto",
        scope=RuleScope(payer_key=payer_key, item_type=s.item_type, max_cents=p95_cap(s.billed_cents)),
        confidence_floor=DRAFT_CONFIDENCE_FLOOR,
        outcome_metric=s.outcome_metric,
        root_cause_class=s.root_cause_class,
        base_rule_id=base_rule_id,
    )


def demotion_due(reversals_30d: int, rolling_outcome: tuple[int, int] | None = None) -> bool:
    """2 reversals in 30 d, or a rolling outcome (k, n) below 85% → demote `auto → ask`."""
    if reversals_30d >= DEMOTE_REVERSALS_30D:
        return True
    if rolling_outcome is not None:
        k, n = rolling_outcome
        return n > 0 and Fraction(k, n) < MIN_OUTCOME
    return False


__all__ = [
    "Eligibility",
    "RuleDraft",
    "SliceStats",
    "acceptable",
    "demotion_due",
    "draft_rule",
    "p95_cap",
    "proposal_eligible",
]
