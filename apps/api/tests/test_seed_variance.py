"""Every benefit-variance item's money comes from its 835 line and the tracked benefits (red team, final D1 #1).

The expected payment is recomputed here from first principles (allowed x the plan's percentage, deductible met
before the visit), not from the seed's own adjudication, and every dollar figure the Inbox shows must be one of
those numbers."""

from __future__ import annotations

import re

from torch_rcm.domain.entities import Coverage, Evidence, InboxItem, Remittance
from torch_rcm.domain.enums import InboxItemKind
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.world.fees import Category, category


def usd(cents: int) -> str:
    whole, part = divmod(cents, 100)
    return f"${whole:,}" if part == 0 else f"${whole:,}.{part:02d}"


def test_every_variance_items_money_matches_its_835_line(canonical: Snapshot) -> None:
    items = [i for i in canonical.of(InboxItem) if i.kind is InboxItemKind.VARIANCE]
    assert [i.id for i in items] == ["itm_4772"]
    remits = {r.id: r for r in canonical.of(Remittance)}
    coverages = {c.id: c for c in canonical.of(Coverage)}
    evidence = {e.id: e for e in canonical.of(Evidence)}
    for item in items:
        assert item.remittance_id and item.claim_id and item.proposed_action
        claim = canonical.claims[item.claim_id]
        (line,) = [rl for rl in remits[item.remittance_id].lines if rl.claim_id == claim.id and rl.variance_cents]
        assert line.billed == line.paid + sum(a.cents for a in line.adj) + line.patient_cents
        plan = coverages[claim.coverage_id].plan
        assert plan.deductible_met_on is not None and plan.deductible_met_on < claim.dos
        assert plan.deductible_remaining_cents == 0
        pct = {Category.BASIC: plan.pct_basic, Category.MAJOR: plan.pct_major}[category(line.cdt)]
        owed = round(line.allowed * pct / 100)  # deductible met: the plan's share of the allowed amount
        patient = line.allowed - owed
        pr1 = sum(a.cents for a in line.patient_adj if a.code == "1")

        assert line.variance_cents == owed - line.paid
        params = item.proposed_action.params
        assert params["patient_cents"] == patient
        assert params["disputed_cents"] == line.variance_cents
        assert item.proposed_action.cents == line.paid
        assert claim.reason_text is not None and usd(line.variance_cents) in claim.reason_text

        shown = set(re.findall(r"\$[\d,]+(?:\.\d\d)?", item.recommendation))
        assert shown == {usd(pr1), usd(line.paid), usd(patient), usd(line.allowed), usd(line.variance_cents)}
        assert f"{pct}%" in item.recommendation and f"{100 - pct}%" in item.recommendation
        assert "refund" not in item.recommendation.lower()

        era = next(evidence[e] for e in item.evidence if e.endswith("_era"))
        for figure in (line.billed, line.allowed, line.paid, pr1):
            whole, part = divmod(figure, 100)
            assert f"${whole:,}.{part:02d}" in era.excerpt


def test_foster_is_25_60_short_and_owes_33_60(canonical: Snapshot) -> None:
    """The worked example a billing lead checks: allowed $168, deductible met 05/12, 80% basic."""
    item = next(i for i in canonical.of(InboxItem) if i.id == "itm_4772")
    assert item.proposed_action is not None
    assert item.proposed_action.params["patient_cents"] == 3_360
    assert item.proposed_action.params["disputed_cents"] == 2_560
