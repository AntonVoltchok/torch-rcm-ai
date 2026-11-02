"""A root cause a run finds is on the claim, on its open items and on the timeline, in one transaction, and every
learning path reads it through `guard_root_cause_ours` (CLAUDE.md hard rule; 07 §6)."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from torch_rcm.agents.eval.harness import seeded_runtime
from torch_rcm.agents.executor.executor import Executor
from torch_rcm.agents.types import Decision, Plan, ProposedAction
from torch_rcm.api.errors import ApiError
from torch_rcm.api.services import inbox as inbox_svc
from torch_rcm.api.services import rules as rules_svc
from torch_rcm.api.services.claims import triage
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import AuditEvent, Claim, InboxItem, RuleProposal, Run
from torch_rcm.domain.enums import ProposalState, RootCause
from torch_rcm.domain.values import ProposalEvidence
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.readmodels.timeline import timeline

DANA = "usr_dana"
CLAIM, ITEM = "clm_4821", "itm_4821"


@pytest.fixture
def rt(tmp_path: Path) -> Iterator[Any]:
    with seeded_runtime("deterministic", tmp_path / "cause.db") as (runtime, _):
        yield runtime


def ctx(rt: Any, user: str = DANA) -> Ctx:
    return Ctx.for_user(rt, user)


def claim(rt: Any) -> Claim:
    return rt.store.require(Claim, CLAIM)


def forget_the_finding(rt: Any) -> None:
    """What a run sees before anyone recorded it: the code still computes `ours` from what we sent."""
    c = claim(rt)
    assert c.denial is not None
    rt.store.update(c.model_copy(update={"denial": c.denial.model_copy(update={"root_cause": RootCause.PAYER})}))
    item = rt.store.require(InboxItem, ITEM)
    item.payload = {**item.payload, "root_cause": "payer"}
    rt.store.update(item)
    for ev in rt.store.all(AuditEvent):
        if ev.action == "root_cause.recorded" and ev.subject_id == CLAIM:
            rt.store.delete(AuditEvent, ev.id)


def triaged(rt: Any) -> None:
    triage(ctx(rt), CLAIM, "followup")
    asyncio.run(rt.scheduler.run_due(rt.clock.now()))


def findings(rt: Any) -> list[Any]:
    snap = Snapshot.from_store(rt.store, rt.clock.now())
    return [e for e in timeline(snap, claim(rt)) if e.kind == "root_cause"]


def test_a_finding_reaches_the_claim_and_the_item_it_reuses(rt: Any) -> None:
    forget_the_finding(rt)
    triaged(rt)
    assert claim(rt).denial.root_cause is RootCause.OURS  # type: ignore[union-attr]
    assert rt.store.require(InboxItem, ITEM).payload["root_cause"] == "ours"


def test_recording_a_finding_writes_one_audit_event(rt: Any) -> None:
    forget_the_finding(rt)
    triaged(rt)
    events = [e for e in rt.store.find(AuditEvent, {"subject_id": CLAIM}) if e.action == "root_cause.recorded"]
    assert len(events) == 1
    assert events[0].actor == "followup" and events[0].data["before"] == "payer" and events[0].data["after"] == "ours"


def test_the_timeline_shows_what_was_found_and_when(rt: Any) -> None:
    forget_the_finding(rt)
    triaged(rt)
    [entry] = findings(rt)
    assert entry.at == rt.clock.now() and entry.lane == "agent" and entry.root_cause is RootCause.OURS
    assert "BWX" in entry.title and "PA" in entry.title and "wrong attachment" not in entry.title


def test_a_seeded_finding_is_dated_when_the_run_found_it_not_when_the_era_arrived(rt: Any) -> None:
    [entry] = findings(rt)
    assert entry.at.isoformat() == "2026-10-28T06:15:00-04:00"
    assert "BWX" in entry.title and "PA" in entry.title


def test_the_item_and_the_record_are_one_transaction(rt: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    forget_the_finding(rt)
    inbox_svc.reject(ctx(rt), ITEM, "no")
    art = rt_agents(rt)
    run = next(r for r in rt.store.find(Run, {"claim_id": CLAIM}) if r.id == "run_followup_4821_1028")
    ex = Executor(art)
    case = ex._case(run)
    action = ProposedAction(action="resubmit_with_attachment", params={"claim_id": CLAIM})
    plan = Plan(situation_key="s", actions=(action,), reviewer_summary="r", planner="scripted")
    insert = rt.store.insert

    def fail_on_item(entity: Any) -> Any:
        if isinstance(entity, InboxItem):
            raise RuntimeError("boom")
        return insert(entity)

    monkeypatch.setattr(rt.store, "insert", fail_on_item)
    with pytest.raises(RuntimeError):
        ex._open_item(run, case, plan, action, Decision(verdict="propose", reason="r", policy_row=8), None)
    assert claim(rt).denial.root_cause is RootCause.PAYER  # type: ignore[union-attr]
    assert not [e for e in rt.store.find(AuditEvent, {"subject_id": CLAIM}) if e.action == "root_cause.recorded"]


def rt_agents(rt: Any) -> Any:
    from torch_rcm.agents.runtime import AgentRuntime

    return AgentRuntime.shared(rt.store, rt.clock, rt.world)


def test_always_auto_run_reads_the_computed_cause(rt: Any) -> None:
    forget_the_finding(rt)
    with pytest.raises(ApiError) as exc:
        inbox_svc.always_auto_run(ctx(rt), ITEM)
    assert (exc.value.status, exc.value.code) == (422, "root_cause_guard")


def test_accepting_a_proposal_reads_the_computed_cause(rt: Any) -> None:
    forget_the_finding(rt)
    rt.store.insert(
        RuleProposal(
            id="prop_x",
            title="x",
            rule_draft={"rule_id": "rule_t1_delta_pa", "root_cause_class": "payer", "scope": {}},
            evidence=ProposalEvidence(approved=20, total=20, outcome_k=18, outcome_n=20),
            root_cause_guard=False,
            state=ProposalState.OPEN,
            created_at=rt.clock.now(),
            source_item_id=ITEM,
        )
    )
    with pytest.raises(ApiError) as exc:
        rules_svc.accept_proposal(ctx(rt), "prop_x")
    assert (exc.value.status, exc.value.code) == (422, "root_cause_guard")


def test_the_api_guards_go_through_the_one_guard(rt: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []
    monkeypatch.setattr("torch_rcm.agents.learning.guard_root_cause_ours", seen.append)
    inbox_svc.always_auto_run(ctx(rt), "itm_4705")
    assert seen == ["unknown"]  # computed for this claim, which has no denial and no finding yet
