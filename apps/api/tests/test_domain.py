"""Claim status state machine, denial routing, and the no-wall-clock rule."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from torch.domain.enums import ClaimStatus as S
from torch.domain.enums import NextAction, PayerKey, RootCause, Tier
from torch.domain.routing import patient_billable_if_lost, route_denial
from torch.domain.transitions import Cause, TransitionError, allowed_targets, apply_transition

ROOT = Path(__file__).resolve().parents[1] / "torch"


def test_world_events_cannot_be_caused_by_torch() -> None:
    assert apply_transition(S.PENDING, S.DENIED, Cause.ADJUDICATED) is S.DENIED
    with pytest.raises(TransitionError):
        apply_transition(S.PENDING, S.DENIED, Cause.ADJUDICATED, actor_tier=Tier.THREE)


def test_tier_gates() -> None:
    assert apply_transition(S.DENIED, S.PENDING, Cause.RECONSIDERATION_SENT, actor_tier=Tier.ONE) is S.PENDING
    with pytest.raises(TransitionError):
        apply_transition(S.DENIED, S.APPEALED, Cause.FORMAL_APPEAL_FILED, actor_tier=Tier.TWO)
    assert apply_transition(S.DENIED, S.APPEALED, Cause.FORMAL_APPEAL_FILED, actor_tier=Tier.THREE) is S.APPEALED


def test_no_edge_out_of_paid_and_no_edge_into_ready() -> None:
    assert allowed_targets(S.PAID) == set()
    assert all(S.READY not in allowed_targets(s) for s in S)
    with pytest.raises(TransitionError):
        apply_transition(S.READY, S.PAID, Cause.ADJUDICATED)


@pytest.mark.parametrize(
    ("carc", "rarc", "expected"),
    [
        ("CO-16", "N29", NextAction.RECONSIDERATION),
        ("CO-16", "M127", NextAction.RECONSIDERATION),
        ("CO-119", None, NextAction.RECONSIDERATION),
        ("CO-22", None, NextAction.CORRECTED),
        ("CO-50", "N10", NextAction.FORMAL_APPEAL),
        ("CO-29", None, NextAction.FORMAL_APPEAL),
        ("PR-119", None, NextAction.BILL_PATIENT_LINK),
    ],
)
def test_route_denial(carc: str, rarc: str | None, expected: NextAction) -> None:
    assert (
        route_denial(carc, rarc, root_cause=RootCause.PAYER, payer=PayerKey.GUARDIAN, self_funded=True).next_action
        is expected
    )


def test_erisa_formal_appeal_needs_patient_authorization() -> None:
    route = route_denial("CO-50", "N10", root_cause=RootCause.PAYER, payer=PayerKey.GUARDIAN, self_funded=True)
    assert route.signer_role == "rendering_dentist"
    assert "patient authorization required (ERISA)" in route.checklist
    assert not patient_billable_if_lost("CO-29", PayerKey.METLIFE)
    assert patient_billable_if_lost("PR-119", PayerKey.DELTA_NY)
    assert not patient_billable_if_lost("PR-119", PayerKey.NY_MEDICAID)


WALL_CLOCK = re.compile(r"\b(datetime\.now|datetime\.utcnow|date\.today|time\.time|time\.monotonic)\s*\(")


def test_no_wall_clock_reads_outside_leases() -> None:
    """Business logic reads the sim clock only. Leases are the one sanctioned wall-clock read (07-agents §8)."""
    offenders = []
    for path in ROOT.rglob("*.py"):
        rel = path.relative_to(ROOT).as_posix()
        if rel.startswith("agents/") or rel == "scheduler/leases.py":
            continue
        for n, line in enumerate(path.read_text().splitlines(), 1):
            if WALL_CLOCK.search(line) and "noqa: wall-clock" not in line:
                offenders.append(f"{rel}:{n}: {line.strip()}")
    assert offenders == []


def test_no_real_vendor_names_in_seed_and_world() -> None:
    banned = re.compile(
        r"\b(Dentrix|Eaglesoft|Open Dental|Curve Dental|Denticon|Change Healthcare|DentalXChange)\b", re.I
    )
    hits = [
        p.name
        for p in ROOT.rglob("*.py")
        if not p.relative_to(ROOT).as_posix().startswith("agents/") and banned.search(p.read_text())
    ]
    assert hits == []
