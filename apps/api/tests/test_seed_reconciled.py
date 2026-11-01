"""The reconciled numbers at Wed 10/28 10:40 (docs/spec/04-seed.md), asserted through the same read models the
API serves. If any of these move, the demo script and the mocks disagree."""

from __future__ import annotations

from torch.domain.enums import ClaimStatus as S
from torch.domain.enums import PayerKey
from torch.readmodels import cash as C
from torch.readmodels.activity import week_decisions
from torch.readmodels.claims import ar_aging, ar_by_payer, strip
from torch.readmodels.snapshot import Snapshot
from torch.seed import targets as T


def usd(x: float) -> int:
    return round(x * 100)


def test_clock_is_wednesday_1040(canonical: Snapshot) -> None:
    assert canonical.now.isoformat() == "2026-10-28T10:40:00-04:00"


def test_strip_by_status(canonical: Snapshot) -> None:
    s = strip(canonical, "usr_dana")
    tiles = {t.status: (t.count, t.cents) for t in s.tiles}
    for status, expected in T.STATUS_TARGETS.items():
        assert tiles[status] == expected, status
    assert tiles[S.PAID] == (118, usd(61_300))
    assert (s.ar_count, s.ar_cents) == (101, usd(75_500))
    assert (s.open_count, s.open_cents) == (107, usd(78_710))


def test_flagged_claims(canonical: Snapshot) -> None:
    s = strip(canonical, "usr_dana")
    assert (s.flagged_count, s.flagged_cents) == (9, usd(8_265))
    flagged = {t.status: t.flagged for t in s.tiles if t.flagged}
    assert flagged == {S.DENIED: 5, S.PENDING: 1, S.REJECTED: 1, S.PARTIAL: 1, S.PAID: 1}


def test_inbox_open(canonical: Snapshot) -> None:
    s = strip(canonical, "usr_dana")
    assert (s.inbox_open, s.inbox_open_cents) == (12, usd(9_697))
    kinds = [i.kind.value for i in canonical.open_items]
    assert sum(k == "eligibility_flag" for k in kinds) == 3
    assert sum(i.claim_id is not None for i in canonical.open_items) == 9


def test_decisions_this_week(canonical: Snapshot) -> None:
    d = week_decisions(canonical)
    assert (d["total"], d["ran"], d["to_dana"]) == (53, 41, 12)
    expected_agents = {k: {"ran": a, "to_dana": b} for k, (a, b) in T.DECISIONS_WEEK["by_agent"].items() if a or b}
    assert d["by_agent"] == expected_agents
    expected_tiers = {k: {"ran": a, "to_dana": b} for k, (a, b) in T.DECISIONS_WEEK["by_tier"].items()}
    assert d["by_tier"] == expected_tiers


def test_paid_and_collections_october(canonical: Snapshot) -> None:
    m0, today = C.month_start(canonical.today), canonical.today
    assert C.insurance_collections(canonical, m0, today) == usd(61_300)
    assert C.patient_collections(canonical, m0, today) == usd(25_640)
    assert C.insurance_collections(canonical, m0, today) + C.patient_collections(canonical, m0, today) == usd(86_940)


def test_production_october(canonical: Snapshot) -> None:
    m0, today = C.month_start(canonical.today), canonical.today
    assert C.gross_production(canonical, m0, today) == usd(112_600)
    assert C.contractual(canonical, m0, today) == usd(21_400)
    assert C.net_production(canonical, m0, today) == usd(91_200)
    assert sum(C.non_contractual_writeoffs(canonical, m0, today).values()) == usd(876)


def test_ar_aging_and_by_payer(canonical: Snapshot) -> None:
    aging = {k: cents for k, (_, cents) in ar_aging(canonical).items()}
    assert aging == {"0_30": usd(46_420), "31_60": usd(15_890), "61_90": usd(7_074), "90_plus": usd(6_116)}
    assert round(aging["90_plus"] / usd(75_500) * 100, 1) == 8.1
    by_payer = {k: cents for k, (_, cents) in ar_by_payer(canonical).items()}
    assert by_payer == {k.value: v for k, v in T.AR_BY_PAYER.items()}
    assert PayerKey.NY_MEDICAID.value not in by_payer


def test_patient_ar_and_days_in_ar(canonical: Snapshot) -> None:
    ar, credits, _ = C.patient_ar(canonical)
    assert (ar, credits) == (usd(33_100), usd(2_180))
    w0 = C.window_start(canonical.today)
    assert C.net_production(canonical, w0, canonical.today) == 90 * usd(4_020)
    kpis = {k.key: k for k in C.cash(canonical).kpis}
    assert kpis["days_in_ar"].value == 27
    assert kpis["avg_daily_net_production"].value == usd(4_020)


def test_appeal_history(canonical: Snapshot) -> None:
    a = C.appeals_12mo(canonical)
    assert (a["won"], a["total"]) == (6, 9)
    assert (a["reconsideration_won"], a["reconsideration_total"]) == (5, 6)
    assert (a["formal_won"], a["formal_total"]) == (1, 3)


def test_named_records(canonical: Snapshot) -> None:
    c = canonical.claims
    owens = c["clm_4821"]
    assert (owens.billed_cents, owens.allowed_cents, owens.icn) == (usd(1_240), usd(986), "26299-041833")
    assert owens.denial is not None and (
        owens.denial.carc,
        owens.denial.rarc,
        owens.denial.root_cause.value,
    ) == ("CO-16", "N29", "ours")
    assert c["clm_4611"].patient_resp_cents == usd(1_012)
    assert c["clm_4772"].paid_cents == usd(108.80)
    assert c["clm_4776"].paid_cents == usd(131.20)
    group = [i for i in canonical.open_items if i.group_key]
    assert sorted(i.claim_id for i in group) == ["clm_4821", "clm_4836", "clm_4840"]
    assert sum(i.cents for i in group) == usd(3_730)
    for cid in ("clm_4744", "clm_4709", "clm_4731"):
        assert c[cid].status is S.PENDING and not canonical.needs_action(cid)
    assert {u.id for u in canonical.users.values()} == {"usr_dana", "usr_morgan", "usr_lee", "usr_tasha"}
    assert "rule_t1_delta_pa" in canonical.rules and len(canonical.rules) == 19
