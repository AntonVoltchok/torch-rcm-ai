"""#4772: an ERA post's `then` ("reprocessing_request:deductible_misapplied") queues the reprocessing request in the
same approval run. Policy decides it as its own action, it runs only if the post did, and the claim lands where
the Inbox said it would (`lands`)."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from torch_rcm.agents.catalog.actions import follow_up
from torch_rcm.agents.config import AgentConfig
from torch_rcm.agents.executor import Executor
from torch_rcm.agents.handlers import register
from torch_rcm.agents.ports import WorldUnavailable
from torch_rcm.api.services import inbox as inbox_svc
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import Claim, Run
from torch_rcm.domain.enums import MoveWho, RunStatus, StepStatus
from torch_rcm.readmodels.claims import summarize
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.runtime import Runtime
from torch_rcm.scheduler.registry import Registry


def _approve(rt: Runtime, reg: Registry) -> tuple[Run, Any]:
    register(reg, AgentConfig(step_delay=False, world_retry_backoff_s=(0.0, 0.0, 0.0)))
    out = inbox_svc.approve(Ctx.for_user(rt, "usr_dana"), "itm_4772", None)
    assert out.run is not None
    asyncio.run(rt.scheduler.run_due(rt.clock.now()))
    return rt.store.require(Run, out.run.id), out.item


def test_follow_up_parses_then_onto_the_posters_claim() -> None:
    params = {"claim_id": "clm_4772", "remittance_id": "r", "then": "reprocessing_request:deductible_misapplied"}
    assert follow_up("post_era_line", params) == (
        "reprocessing_request",
        {"claim_id": "clm_4772", "basis": "deductible_misapplied"},
    )
    assert follow_up("post_era_line", {**params, "then": None}) is None
    assert follow_up("patient_transfer", params) is None  # only a post queues a `then`


def test_the_reprocessing_request_runs_after_the_post_and_4772_lands_with_cigna(
    rt: Runtime, world_only_registry: Registry
) -> None:
    run, item = _approve(rt, world_only_registry)
    assert run.status is RunStatus.SUCCEEDED, run.audit_line
    steps = {s.name: s for s in run.steps}
    assert steps["act:0:pms_post"].status is StepStatus.OK
    assert steps["act:1:payer_submit"].status is StepStatus.OK
    assert steps["act:1:payer_submit"].tool == "payer.request_reprocessing"
    assert [s.name for s in run.steps].index("act:0:pms_post") < [s.name for s in run.steps].index(
        "act:1:render_request"
    )
    decide = steps["decide"].output_summary
    assert "execute: Reprocessing request · approved by a person" in decide

    claim = rt.store.require(Claim, "clm_4772")
    assert claim.in_flight and "reprocessing requested" in claim.in_flight
    move = summarize(Snapshot.from_store(rt.store, rt.clock.now()), claim, "usr_dana").move
    assert item.lands is MoveWho.PAYER
    assert run.claim_outcome is not None and run.claim_outcome.move_to is MoveWho.PAYER
    assert move.who is MoveWho.PAYER and move.label == "Waiting on Cigna"
    assert "1 reprocessing request sent to Cigna" in item.touches


def test_a_failed_post_does_not_send_the_reprocessing_request(
    rt: Runtime, world_only_registry: Registry, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = Executor._world_act

    async def down(self: Executor, run_id: str, idx: int, rstep: Any, args: dict[str, Any]) -> Any:
        if rstep.op == "pms.post_payment":
            raise WorldUnavailable("PMS is down")
        return await real(self, run_id, idx, rstep, args)

    monkeypatch.setattr(Executor, "_world_act", down)
    run, _ = _approve(rt, world_only_registry)
    steps = {s.name: s for s in run.steps}
    assert steps["act:0:pms_post"].status is StepStatus.FAILED
    assert steps["act:1:render_request"].status is StepStatus.SKIPPED
    assert steps["act:1:payer_submit"].status is StepStatus.SKIPPED
    assert "its parent failed" in steps["act:1:payer_submit"].output_summary
    assert not rt.store.require(Claim, "clm_4772").in_flight
