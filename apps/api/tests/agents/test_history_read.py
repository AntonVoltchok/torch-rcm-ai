"""`claim_get_history` lists finished runs only: the run doing the reading has no result yet, and showing it
to the model as history is wrong (and made live replay miss the recording on every triage)."""

from __future__ import annotations

from datetime import timedelta

from agent_world import World, case_for, world  # noqa: F401  (fixture)

from torch_rcm.domain.entities import Run
from torch_rcm.domain.enums import RunStatus, RunTrigger


def _run(w: World, run_id: str, status: RunStatus, summary: str, minutes_ago: int) -> Run:
    run = Run(
        id=run_id,
        agent="followup",
        trigger=RunTrigger.MANUAL,
        claim_id="clm_4731",
        idempotency_key=run_id,
        status=status,
        started_at=w.rt.clock.now() - timedelta(minutes=minutes_ago),
        result_summary=summary,
    )
    w.rt.store.insert(run)
    return run


def test_history_lists_finished_runs_but_not_the_reader_or_runs_in_flight(world: World) -> None:  # noqa: F811
    _run(world, "run_hist_done", RunStatus.SUCCEEDED, "asked for the 835", minutes_ago=30)
    _run(world, "run_hist_queued", RunStatus.QUEUED, "", minutes_ago=5)
    reader = _run(world, "run_hist_reader", RunStatus.RUNNING, "", minutes_ago=1)
    case = case_for(world, "clm_4731", "followup", run_id=reader.id)
    out = world.tools.call(case, "claim_get_history", {"claim_id": "clm_4731", "include": ["runs"]}, run_id=reader.id)
    assert out.ok
    runs = out.data["runs"]
    assert isinstance(runs, list)
    assert any("asked for the 835" in str(r) for r in runs)
    assert not any(str(r).endswith("· ") for r in runs)  # no in-flight run with an empty result
