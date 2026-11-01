"""07 §6 learning: proposal_eligible edges, the `ours` guard, draft_rule and demotion — pure."""

from __future__ import annotations

import random

import pytest

from torch.agents.learning import SliceStats, acceptable, demotion_due, draft_rule, p95_cap, proposal_eligible
from torch.agents.policy import assert_invariants
from torch.agents.types import RuleView


def stats(**kw) -> SliceStats:  # type: ignore[no-untyped-def]
    base = {
        "payer_key": "delta_ny",
        "item_type": "denied:CO-16:N29:pa_missing",
        "action": "resubmit_with_attachment",
        "root_cause_class": "payer",
        "outcome_metric": "paid_30d",
        "n": 25,
        "approved_unedited": 24,
        "outcome_n": 25,
        "outcome_k": 23,
        "billed_cents": (124_000, 98_000, 151_000, 87_500, 132_000),
    }
    base.update(kw)
    return SliceStats(**base)


def test_seeded_delta_slice_is_eligible() -> None:
    e = proposal_eligible(stats())
    assert e and e.eligible and not e.guarded and e.shortfall == ()
    assert acceptable(stats())


@pytest.mark.parametrize(
    ("kw", "ok"),
    [
        ({"n": 20, "approved_unedited": 18, "outcome_n": 20, "outcome_k": 17}, True),  # exactly 90% / 85%
        ({"n": 19, "approved_unedited": 19, "outcome_n": 20, "outcome_k": 20}, False),  # 19/20 needed
        ({"n": 1000, "approved_unedited": 899}, False),  # 89.9%
        ({"n": 1000, "approved_unedited": 900}, True),
        ({"outcome_n": 1000, "outcome_k": 849}, False),  # 84.9%
        ({"outcome_n": 1000, "outcome_k": 850}, True),
        ({"outcome_n": 19, "outcome_k": 19}, False),
        ({"reversals_30d": 1}, False),  # one reversal
        ({"outcome_metric": "none"}, False),
        ({"action": "post_era_line"}, False),  # tier 2 never learns
        ({"action": "formal_appeal"}, False),  # tier 3 never learns
        ({"n": 0, "approved_unedited": 0}, False),
    ],
)
def test_eligibility_edges(kw: dict, ok: bool) -> None:  # type: ignore[type-arg]
    e = proposal_eligible(stats(**kw))
    assert e.eligible is ok, e.shortfall
    assert bool(e) is ok
    assert (e.shortfall == ()) is ok


def test_edited_approvals_do_not_count() -> None:
    # 25 approvals, 3 of them edited → 22 unedited of 25 = 88% → not eligible
    assert not proposal_eligible(stats(n=25, approved_unedited=22))


def test_shortfall_message() -> None:
    e = proposal_eligible(stats(n=12, approved_unedited=12))
    assert any("12 of 20 needed" in s for s in e.shortfall)


def test_ours_is_eligible_but_guarded_and_never_acceptable() -> None:
    s = stats(root_cause_class="ours")
    e = proposal_eligible(s)
    assert e.eligible and e.guarded
    assert not acceptable(s)
    assert proposal_eligible(stats(root_cause_class="ours", n=3, approved_unedited=3)).guarded


def test_draft_rule_shape_and_invariants() -> None:
    d = draft_rule("delta_ny", "resubmit_with_attachment", stats(), base_rule_id="rule_t1_delta_pa")
    assert (d.mode, d.tier, d.confidence_floor, d.outcome_metric) == ("auto", 1, 0.90, "paid_30d")
    assert d.scope.payer_key == "delta_ny" and d.scope.item_type == "denied:CO-16:N29:pa_missing"
    assert d.scope.max_cents == 200_000  # p95 $1,510 → '< $2,000'
    as_dict = d.as_rule_draft()
    assert as_dict["rule_id"] == "rule_t1_delta_pa" and as_dict["scope"]["max_cents"] == 200_000  # type: ignore[index]
    view = RuleView(
        id="rule_learned", version=1, origin="learned", tier=1, action=d.action, label="learned", scope=d.scope,
        mode="auto", confidence_floor=d.confidence_floor, outcome_metric=d.outcome_metric,
    )  # fmt: skip
    assert_invariants([view])


def test_draft_rule_refuses_ineligible_or_mismatched_slice() -> None:
    with pytest.raises(ValueError, match="not eligible"):
        draft_rule("delta_ny", "resubmit_with_attachment", stats(n=5, approved_unedited=5))
    with pytest.raises(ValueError, match="different slice"):
        draft_rule("metlife", "resubmit_with_attachment", stats())


def test_p95_cap() -> None:
    assert p95_cap([]) is None
    assert p95_cap([150_000]) == 150_000  # exact multiple stays
    assert p95_cap([150_001]) == 200_000
    assert p95_cap([100]) == 50_000  # floor of one step
    rng = random.Random(3)
    for _ in range(200):
        values = [rng.randint(1, 900_000) for _ in range(rng.randint(1, 60))]
        cap = p95_cap(values)
        assert cap is not None and cap % 50_000 == 0
        assert sum(v <= cap for v in values) >= 0.95 * len(values)


def test_demotion_due() -> None:
    assert not demotion_due(0) and not demotion_due(1)
    assert demotion_due(2) and demotion_due(5)
    assert demotion_due(0, (84, 100)) and not demotion_due(0, (85, 100)) and not demotion_due(0, (0, 0))
