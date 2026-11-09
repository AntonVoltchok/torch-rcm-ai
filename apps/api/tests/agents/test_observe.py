"""Observe does nothing except record `would_have_run` runs: no inbox item, no payer contact, even on the
`unknown` cases that row 5 would otherwise send to a person (CLAUDE.md hard rule; 07 §5.1)."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from agent_world import ctx, rule
from test_policy_table import RESUBMIT

from torch_rcm.agents.eval.harness import UNKNOWN_CLAIMS, invariant_failures, observe_failures, seeded_runtime
from torch_rcm.agents.policy import decide
from torch_rcm.agents.types import ProposedAction
from torch_rcm.api.services.claims import triage
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain import invariants as inv
from torch_rcm.domain.entities import InboxItem, Rule, Run, WorldCallLog
from torch_rcm.domain.enums import RuleMode, RunStatus, Tier

DANA = "usr_dana"
POST = ProposedAction(action="post_era_line", params={"remittance_id": "rem_t"})


@pytest.fixture
def rt(tmp_path: Path) -> Iterator[Any]:
    with seeded_runtime("deterministic", tmp_path / "observe.db") as (runtime, _):
        yield runtime


def set_modes(rt: Any, mode: str, *rule_ids: str) -> None:
    """Every rule that may leave `human_only`, or just `rule_ids`, on `mode`."""
    for r in rt.store.all(Rule):
        if r.tier is not Tier.THREE and (not rule_ids or r.id in rule_ids):
            rt.store.update(r.model_copy(update={"mode": RuleMode(mode), "signed_by": None, "signed_at": None}))


def triaged(rt: Any, claim_id: str) -> Run:
    triage(Ctx.for_user(rt, DANA), claim_id, "followup")
    asyncio.run(rt.scheduler.run_due(rt.clock.now()))
    return next(r for r in rt.store.find(Run, {"claim_id": claim_id}) if r.trigger.value == "manual")


def payer_calls(rt: Any, run_id: str) -> list[WorldCallLog]:
    return [c for c in rt.store.find(WorldCallLog, {"run_id": run_id}) if c.system.startswith("payer:")]


@pytest.mark.parametrize("claim_id", UNKNOWN_CLAIMS)
def test_unknown_claim_under_observe_records_would_have_run_and_nothing_else(rt: Any, claim_id: str) -> None:
    set_modes(rt, "observe")
    items_before = {i.id for i in rt.store.find(InboxItem, {"claim_id": claim_id})}

    run = triaged(rt, claim_id)

    assert run.status.value == "would_have_run" and run.verdict is not None and run.verdict.value == "observe"
    assert {i.id for i in rt.store.find(InboxItem, {"claim_id": claim_id})} == items_before
    assert payer_calls(rt, run.id) == []
    assert not [c for c in rt.store.find(WorldCallLog, {"run_id": run.id}) if c.mutation]
    assert invariant_failures(rt) == []


def test_the_run_says_it_did_not_read_the_portal(rt: Any) -> None:
    set_modes(rt, "observe")
    run = triaged(rt, "clm_4731")
    lines = next(s for s in run.steps if s.name == "investigate").progress_lines
    assert any("not read" in line and "Observe" in line for line in lines)


def test_one_observing_rule_withholds_the_read_whichever_rule_decides(rt: Any) -> None:
    """The plan does not exist at read time, so any rule that could decide this run withholds the read."""
    rules = [r for r in rt.store.all(Rule) if r.action.value == "request_835" and r.tier is not Tier.THREE]
    set_modes(rt, "observe", *(r.id for r in rules))
    run = triaged(rt, "clm_4731")
    assert run.status.value == "would_have_run" and payer_calls(rt, run.id) == []


def test_without_an_observing_rule_the_portal_is_read(rt: Any) -> None:
    run = triaged(rt, "clm_4731")
    assert [c.operation for c in payer_calls(rt, run.id)] == ["portal.correspondence"]
    assert [i for i in rt.store.find(InboxItem, {"claim_id": "clm_4731"}) if i.run_id == run.id]


def verdict(c: Any, action: ProposedAction) -> tuple[str, int]:
    d = decide(c, action)
    return d.verdict, d.policy_row


@pytest.mark.parametrize(("mode", "expected"), [("ask", ("propose", 5)), ("observe", ("observe", 7))])
def test_row_5_yields_to_row_7_only_under_observe(mode: str, expected: tuple[str, int]) -> None:
    c = ctx(rule("resubmit_with_attachment", 1, mode), classifier_situation="unknown")
    assert verdict(c, RESUBMIT) == expected


@pytest.mark.parametrize(("mode", "expected"), [("ask", ("propose", 4)), ("observe", ("observe", 7))])
def test_row_4_yields_to_row_7_only_under_observe(mode: str, expected: tuple[str, int]) -> None:
    r = rule("post_era_line", 2, mode, signed_by="usr_morgan", max_cents=500_000)
    assert verdict(ctx(r, agent="posting", cents=50_000, paper_eob=True), POST) == expected


def test_no_rule_still_goes_to_a_person() -> None:
    assert verdict(ctx(classifier_situation="unknown"), RESUBMIT) == ("propose", 5)


def test_invariants_catch_an_item_or_a_payer_call_under_observe(rt: Any) -> None:
    item = rt.store.all(InboxItem)[0]
    assert inv.observe_opens_no_item([item]) == []
    flagged = item.model_copy(update={"payload": {**item.payload, "rule_mode": "observe"}})
    assert len(inv.observe_opens_no_item([flagged])) == 1

    run = rt.store.all(Run)[0].model_copy(update={"id": "run_x", "status": RunStatus.WOULD_HAVE_RUN})
    call = WorldCallLog(
        id="wc_x",
        system="payer:delta_ny",
        operation="portal.correspondence",
        at=rt.clock.now(),
        idempotency_key="k",
        run_id="run_x",
    )
    assert len(inv.observe_contacts_no_payer([run], [call])) == 1
    assert inv.observe_contacts_no_payer([run], [call.model_copy(update={"system": "pms"})]) == []


def test_eval_holds_observe_in_deterministic_mode(tmp_path: Path) -> None:
    assert observe_failures("deterministic", tmp_path) == []
