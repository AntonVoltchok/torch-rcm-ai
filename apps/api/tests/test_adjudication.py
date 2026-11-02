"""Payer adjudication: the pinned demo cases to the cent, and property tests that every remittance line balances."""

from __future__ import annotations

import random

import hypothesis
from hypothesis import strategies as st

from torch_rcm.domain.enums import AdjGroup, ClaimStatus, PayerKey
from torch_rcm.domain.values import PlanBenefits
from torch_rcm.world.fees import CODES, SCHEDULES, Category
from torch_rcm.world.payers.adjudicate import LineIn, Outcome, adjudicate
from torch_rcm.world.payers.profiles import PROFILES

D, ML, CG, AE = PayerKey.DELTA_NY, PayerKey.METLIFE, PayerKey.CIGNA, PayerKey.AETNA
CROWN = [LineIn("l1", "D2740", 109_000, "19"), LineIn("l2", "D2950", 12_000, "19"), LineIn("l3", "D0220", 3_000, "19")]


def plan(**kw: object) -> PlanBenefits:
    base: dict[str, object] = {
        "annual_max_cents": 150_000,
        "deductible_cents": 5_000,
        "deductible_met_cents": 5_000,
        "used_cents": 0,
        "pct_preventive": 100,
        "pct_basic": 80,
        "pct_major": 50,
    }
    return PlanBenefits.model_validate({**base, **kw})


def test_owens_denied_without_pa_and_paid_with_it() -> None:
    denied = adjudicate(
        CROWN, payer=PROFILES[D], plan=plan(), schedule=SCHEDULES["delta_ppo"], attachments=frozenset({"bwx"})
    )
    assert (denied.status, denied.denial_carc, denied.denial_rarc, denied.paid) == (
        ClaimStatus.DENIED,
        "CO-16",
        "N29",
        0,
    )
    paid = adjudicate(
        CROWN, payer=PROFILES[D], plan=plan(), schedule=SCHEDULES["delta_ppo"], attachments=frozenset({"pa"})
    )
    assert (paid.paid, paid.allowed, paid.contractual, paid.patient) == (50_400, 98_600, 25_400, 48_200)


def test_diaz_max_met_bills_patient_allowed() -> None:
    r = adjudicate(
        CROWN,
        payer=PROFILES[D],
        plan=plan(used_cents=150_000),
        schedule=SCHEDULES["delta_premier"],
        attachments=frozenset({"pa"}),
    )
    assert (r.status, r.paid, r.patient, r.contractual) == (ClaimStatus.DENIED, 0, 101_200, 22_800)


def test_foster_deductible_misapplied() -> None:
    r = adjudicate(
        [LineIn("f", "D2392", 25_500)],
        payer=PROFILES[CG],
        plan=plan(alternate_benefit=False),
        schedule=SCHEDULES["cigna_dppo"],
        outcome=Outcome.parse("PR-1=3200"),
    )
    line = r.lines[0]
    assert (r.status, line.allowed, line.paid, line.patient_cents) == (ClaimStatus.PARTIAL, 16_800, 10_880, 5_920)
    assert [(a.code, a.cents) for a in line.patient_adj] == [("1", 3_200), ("2", 2_720)]


def test_abara_cob_secondary() -> None:
    primary = adjudicate(
        [LineIn("a", "D4341", 24_000)],
        payer=PROFILES[ML],
        plan=plan(deductible_met_cents=0, pct_basic=50),
        schedule=SCHEDULES["metlife_pdp"],
    )
    assert primary.paid == 8_280
    secondary = adjudicate(
        [LineIn("a", "D4341", 24_000)],
        payer=PROFILES[CG],
        plan=plan(),
        schedule=SCHEDULES["cigna_dppo"],
        other_paid={"a": primary.paid},
    )
    line = secondary.lines[0]
    assert (line.paid, line.patient_cents) == (13_120, 0)
    assert ("OA", "23", 8_280) in [(a.group.value, a.code, a.cents) for a in line.adj]


def test_aetna_alternate_benefit_minus_38() -> None:
    r = adjudicate(
        [LineIn("o", "D2392", 25_500, "14")], payer=PROFILES[AE], plan=plan(), schedule=SCHEDULES["aetna_dmo"]
    )
    assert r.status is ClaimStatus.PAID
    assert [(a.code, a.cents) for a in r.lines[0].patient_adj if a.code == "186"] == [("186", 3_800)]


def test_crown_frequency_uses_payer_tooth_history() -> None:
    r = adjudicate(
        CROWN,
        payer=PROFILES[D],
        plan=plan(),
        schedule=SCHEDULES["delta_ppo"],
        attachments=frozenset({"pa"}),
        payer_crown_history={"19": 30},
    )
    assert (r.status, r.denial_carc) == (ClaimStatus.DENIED, "CO-119")


def test_medicaid_never_balance_bills_non_covered() -> None:
    r = adjudicate(
        [LineIn("t", "D9941", 19_500)],
        payer=PROFILES[PayerKey.NY_MEDICAID],
        plan=plan(pct_basic=100),
        schedule=SCHEDULES["medicaid_ny"],
    )
    assert r.patient == 0
    assert all(a.group is AdjGroup.CO for a in r.lines[0].adj)


# ── properties ─────────────────────────────────────────────────────────────────────────────────────────────

INSURED = [c for c, code in CODES.items() if code.category is not Category.NON_COVERED] + ["D9944"]
OUTCOMES = [None, "CO-16:N29", "CO-50:N10", "PR-119", "CO-22", "PR-1=1500", "CO-119@D0274"]


def _check(lines: list[LineIn], payer: PayerKey, p: PlanBenefits, schedule: str, outcome: str | None) -> None:
    r = adjudicate(
        lines,
        payer=PROFILES[payer],
        plan=p,
        schedule=SCHEDULES[schedule],
        attachments=frozenset({"pa"}),
        outcome=Outcome.parse(outcome) if outcome else None,
    )
    for line in r.lines:
        assert line.balances, line
        assert line.paid >= 0 and line.patient_cents >= 0
        assert all(a.cents >= 0 for a in (*line.adj, *line.patient_adj)), line
    assert r.paid == sum(line.paid for line in r.lines)


def test_lines_always_balance_seeded_sweep() -> None:
    rng = random.Random(7)
    schedules = list(SCHEDULES)
    for _ in range(3_000):
        n = rng.randint(1, 6)
        lines = [
            LineIn(f"l{i}", c, CODES[c].fee_cents, str(rng.randint(1, 32)))
            for i, c in enumerate(rng.choices(INSURED, k=n))
        ]
        p = plan(
            used_cents=rng.choice([0, 50_000, 140_000, 150_000]),
            deductible_met_cents=rng.choice([0, 2_500, 5_000]),
            pct_basic=rng.choice([50, 80, 100]),
            pct_major=rng.choice([0, 50]),
        )
        schedule = rng.choice(schedules)
        payer = PayerKey(SCHEDULES[schedule].payer)
        _check(lines, payer, p, schedule, rng.choice(OUTCOMES))


def test_lines_always_balance_hypothesis() -> None:
    @hypothesis.settings(max_examples=300, deadline=None)
    @hypothesis.given(
        codes=st.lists(st.sampled_from(INSURED), min_size=1, max_size=6),
        used=st.integers(0, 160_000),
        met=st.integers(0, 5_000),
        pct=st.sampled_from([0, 50, 80, 100]),
        schedule=st.sampled_from(sorted(SCHEDULES)),
        outcome=st.sampled_from(OUTCOMES),
    )
    def prop(codes: list[str], used: int, met: int, pct: int, schedule: str, outcome: str | None) -> None:
        lines = [LineIn(f"l{i}", c, CODES[c].fee_cents, "3") for i, c in enumerate(codes)]
        _check(
            lines,
            PayerKey(SCHEDULES[schedule].payer),
            plan(used_cents=used, deductible_met_cents=met, pct_basic=pct),
            schedule,
            outcome,
        )

    prop()
