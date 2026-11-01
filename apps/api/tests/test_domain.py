"""Claim status state machine, denial routing, and the no-wall-clock rule."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from torch_rcm.domain.enums import ClaimStatus as S
from torch_rcm.domain.enums import ClosedReason, NextAction, PayerKey, RootCause, Tier
from torch_rcm.domain.routing import patient_billable_if_lost, route_denial
from torch_rcm.domain.transitions import (
    EDGES,
    Cause,
    TransitionError,
    allowed_causes,
    allowed_targets,
    apply_transition,
    close_claim,
    start_corrected_claim,
)

ROOT = Path(__file__).resolve().parents[1] / "torch_rcm"


def test_world_events_cannot_be_caused_by_torch() -> None:
    assert apply_transition(S.PENDING, S.DENIED, Cause.ADJUDICATED) is S.DENIED
    with pytest.raises(TransitionError):
        apply_transition(S.PENDING, S.DENIED, Cause.ADJUDICATED, actor_tier=Tier.THREE)


def test_tier_gates() -> None:
    assert apply_transition(S.DENIED, S.PENDING, Cause.RECONSIDERATION_SENT, actor_tier=Tier.ONE) is S.PENDING
    with pytest.raises(TransitionError):
        apply_transition(S.DENIED, S.APPEALED, Cause.FORMAL_APPEAL_FILED, actor_tier=Tier.TWO)
    with pytest.raises(TransitionError, match="tier 3"):
        apply_transition(S.DENIED, S.APPEALED, Cause.FORMAL_APPEAL_FILED, actor_tier=Tier.THREE)  # not a person
    assert (
        apply_transition(S.DENIED, S.APPEALED, Cause.FORMAL_APPEAL_FILED, actor_tier=Tier.THREE, by_human=True)
        is S.APPEALED
    )


def test_partial_can_be_reconsidered_or_appealed() -> None:
    assert apply_transition(S.PARTIAL, S.PENDING, Cause.RECONSIDERATION_SENT, actor_tier=Tier.ONE) is S.PENDING
    assert (
        apply_transition(S.PARTIAL, S.APPEALED, Cause.FORMAL_APPEAL_FILED, actor_tier=Tier.THREE, by_human=True)
        is S.APPEALED
    )
    with pytest.raises(TransitionError):
        apply_transition(S.PARTIAL, S.APPEALED, Cause.FORMAL_APPEAL_FILED, actor_tier=Tier.TWO, by_human=True)
    assert allowed_targets(S.PARTIAL) == {S.PENDING, S.APPEALED}


@pytest.mark.parametrize("source", [S.DENIED, S.PARTIAL, S.REJECTED, S.SENT, S.ACCEPTED, S.PENDING])
def test_corrected_claim_spawns_a_ready_replacement_at_tier_2(source: S) -> None:
    assert start_corrected_claim(source, Tier.TWO) is S.READY
    with pytest.raises(TransitionError, match="needs tier 2"):
        start_corrected_claim(source, Tier.ONE)
    with pytest.raises(TransitionError, match="spawn edge"):
        apply_transition(source, S.SENT, Cause.CORRECTED_CLAIM, actor_tier=Tier.TWO)  # the original never moves


@pytest.mark.parametrize("source", [S.READY, S.PAID, S.APPEALED])
def test_corrected_claim_needs_a_claim_the_payer_has(source: S) -> None:
    with pytest.raises(TransitionError):
        start_corrected_claim(source, Tier.THREE)


def test_void_closes_any_non_terminal_claim_and_is_human_tier_3() -> None:
    for source in S:
        if source is S.PAID:
            with pytest.raises(TransitionError):
                close_claim(source, Cause.VOID_CLAIM, Tier.THREE, by_human=True)
            continue
        assert close_claim(source, Cause.VOID_CLAIM, Tier.THREE, by_human=True) is ClosedReason.VOIDED
        with pytest.raises(TransitionError, match="tier 3"):
            close_claim(source, Cause.VOID_CLAIM, Tier.THREE, by_human=False)  # a rule or agent: never
        with pytest.raises(TransitionError):
            close_claim(source, Cause.VOID_CLAIM, Tier.TWO, by_human=True)
        assert Cause.VOID_CLAIM in allowed_causes(source)


def test_write_off_closes_denied_or_partial_only() -> None:
    assert close_claim(S.DENIED, Cause.WRITE_OFF, Tier.THREE, by_human=True) is ClosedReason.WRITE_OFF
    assert close_claim(S.PARTIAL, Cause.WRITE_OFF, Tier.THREE, by_human=True) is ClosedReason.WRITE_OFF
    with pytest.raises(TransitionError):
        close_claim(S.PENDING, Cause.WRITE_OFF, Tier.THREE, by_human=True)
    with pytest.raises(TransitionError):
        close_claim(S.DENIED, Cause.RECONSIDERATION_SENT, Tier.THREE, by_human=True)


def test_every_tier_3_edge_is_human_only() -> None:
    tier3 = [e for e in EDGES if e.min_tier is Tier.THREE]
    assert {e.cause for e in tier3} == {Cause.FORMAL_APPEAL_FILED, Cause.WRITE_OFF, Cause.VOID_CLAIM}
    for e in tier3:
        with pytest.raises(TransitionError, match="tier 3"):
            if e.kind == "close":
                close_claim(e.source, e.cause, Tier.THREE, by_human=False)
            else:
                apply_transition(e.source, e.target, e.cause, actor_tier=Tier.THREE)


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
