"""Every scenario builds, persists and keeps the invariants; the variants change what they claim to change."""

from __future__ import annotations

import pytest

from torch_rcm.db.store import Store
from torch_rcm.domain import invariants as inv
from torch_rcm.domain.entities import Claim, InboxItem, Remittance, Rule, Run
from torch_rcm.domain.enums import InboxItemState, RunStatus
from torch_rcm.seed.persist import persist
from torch_rcm.world.scenarios import SCENARIOS, build_scenario


@pytest.mark.parametrize("name", sorted(SCENARIOS))
def test_scenario_builds_and_persists(name: str, tmp_path) -> None:  # type: ignore[no-untyped-def]
    w = build_scenario(name)
    assert w.scenario == name
    assert inv.remit_lines_balance(w.of(Remittance)) == []
    assert inv.would_have_run_iff_observe(w.of(Run), {r.id: r for r in w.of(Rule)}) == []
    if name != "dso_4000_claims":
        store = Store(tmp_path / "s.db")
        persist(store, w)
        assert store.count(Claim) == len(w.of(Claim))


def test_empty_inbox_has_no_open_items() -> None:
    assert not [i for i in build_scenario("empty_inbox").of(InboxItem) if i.state is InboxItemState.OPEN]


def test_observe_mode_records_would_have_run_and_nothing_executed() -> None:
    """Observe does nothing: every run under an observed rule is would_have_run (including payer contact —
    status checks and rep calls are rule-governed, so Observe never talks to a payer) or a proposal."""
    w = build_scenario("observe_mode_day3")
    observed = {r.id for r in w.of(Rule) if r.mode.value == "observe"}
    under = [r for r in w.of(Run) if r.rule_id in observed]
    assert sum(r.status is RunStatus.WOULD_HAVE_RUN for r in under) >= 41
    assert all(r.status is RunStatus.WOULD_HAVE_RUN or (r.verdict and r.verdict.value == "propose") for r in under)


def test_dso_scenario_volume() -> None:
    assert len(build_scenario("dso_4000_claims").of(Claim)) > 4_400
