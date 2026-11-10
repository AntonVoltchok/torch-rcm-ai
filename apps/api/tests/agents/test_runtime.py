"""AgentRuntime, RunStore, EventBus and the scheduler handlers (07 §8)."""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

from tests.agents.test_executor import CFG, RESUBMIT_STEPS, approve_4821, fake
from torch_rcm.agents.handlers import register
from torch_rcm.agents.runtime import AdvanceLimits, AgentRuntime
from torch_rcm.agents.types import Pin
from torch_rcm.domain.entities import Job, Practice, Run
from torch_rcm.domain.enums import JobState, RunStatus
from torch_rcm.events import FIREHOSE
from torch_rcm.runtime import Runtime
from torch_rcm.scheduler import kinds as K
from torch_rcm.scheduler.registry import Registry


def go(coro: Any) -> Any:
    return asyncio.run(coro)


def drain(rt: Runtime) -> Any:
    return go(rt.scheduler.run_due(rt.clock.now()))


def counting(reg: Registry, kind: str) -> list[str]:
    """Wrap a registered handler to count its invocations."""
    seen: list[str] = []
    inner = reg.get(kind)
    assert inner is not None

    async def wrapper(ctx: Any) -> Any:
        seen.append(ctx.job.id)
        return await inner(ctx)  # type: ignore[misc]

    reg.register(kind, wrapper, replace=True)
    return seen


def run_start_jobs(rt: Runtime, run_id: str) -> list[Job]:
    return [j for j in rt.store.find(Job, {"kind": K.RUN_START}) if j.payload.get("run_id") == run_id]


def test_approve_run_start_steps_done_through_the_scheduler(rt: Runtime, world_only_registry: Registry) -> None:
    kinds = [K.RUN_START, K.TRIAGE, K.ERA_ARRIVED, K.STATUS_CHECK_DUE]
    assert set(register(world_only_registry, CFG)) == set(kinds)
    assert register(world_only_registry, CFG) == kinds  # idempotent
    run = approve_4821(rt)
    drain(rt)
    done = rt.store.require(Run, run.id)
    assert done.status is RunStatus.SUCCEEDED
    assert [s.name for s in done.steps] == RESUBMIT_STEPS
    art = AgentRuntime.from_runtime(rt, CFG)
    events = art.bus.replay(run.id)
    names = [e["event"] for e in events]
    assert names[0] == "status" and names[-1] == "done" and "counts" in names
    step_events = [e["data"] for e in events if e["event"] == "step"]
    assert {e["phase"] for e in step_events} == {"started", "completed"}  # approval runs make no reads
    assert all(
        {"progress_lines", "policy_verdict", "model_situation_label", "planner"} <= e.keys() for e in step_events
    )
    assert any(e["data"].get("run_id") == run.id for e in art.bus.replay(FIREHOSE))
    # at-least-once: a duplicate run.start is a no-op
    again = go(art.start_run(run.id))
    assert again.replayed


def test_sse_replay_from_last_event_id_returns_missed_steps(rt: Runtime) -> None:
    art, _ = fake(rt)
    run = approve_4821(rt)
    go(art.start_run(run.id))
    full = art.bus.replay(run.id)
    cut = int(full[9]["id"])
    missed = art.bus.replay(run.id, after=cut)
    assert missed == full[10:] and all(int(e["id"]) > cut for e in missed)
    assert art.runs.last_event_id(run.id) == int(full[-1]["id"])

    async def collect() -> list[dict[str, Any]]:
        return [ev async for ev in art.bus.subscribe(run.id, str(cut))]

    assert go(collect()) == missed


def test_sse_live_subscriber_sees_the_run(rt: Runtime) -> None:
    art, _ = fake(rt)
    run = approve_4821(rt)

    async def scenario() -> list[str]:
        got: list[str] = []

        async def listen() -> None:
            async for ev in art.bus.subscribe(run.id):
                got.append(ev["event"])

        task = asyncio.create_task(listen())
        await asyncio.sleep(0)
        await art.start_run(run.id)
        await asyncio.wait_for(task, 2)
        return got

    got = go(scenario())
    assert got[-1] == "done" and got.count("step") >= len(RESUBMIT_STEPS) * 2


def test_pause_parks_jobs_and_does_not_hot_loop(rt: Runtime, world_only_registry: Registry) -> None:
    register(world_only_registry, CFG)
    calls = counting(world_only_registry, K.RUN_START)
    art = AgentRuntime.from_runtime(rt, CFG)
    run = approve_4821(rt)
    art.pause("usr_morgan")
    assert art.status()["paused"] and all(j.state is JobState.PARKED for j in run_start_jobs(rt, run.id))
    for _ in range(3):
        drain(rt)
    assert calls == [] and rt.store.require(Run, run.id).status is RunStatus.QUEUED
    art.resume("usr_morgan")
    drain(rt)
    assert len(calls) == 1 and rt.store.require(Run, run.id).status is RunStatus.SUCCEEDED


def test_pause_mid_run_stops_at_the_step_boundary_and_resumes(rt: Runtime, world_only_registry: Registry) -> None:
    register(world_only_registry, CFG)
    calls = counting(world_only_registry, K.RUN_START)
    _, fw = fake(rt, pause_after="nea.upload")
    world_only_registry.unregister(K.RUN_START)
    art = AgentRuntime.from_runtime(rt, CFG, world_port=fw)

    async def start(ctx: Any) -> Any:
        calls.append(ctx.job.id)
        from torch_rcm.agents.handlers import _outcome

        return _outcome(art, await art.start_run(ctx.job.payload["run_id"]), ctx)

    world_only_registry.register(K.RUN_START, start)
    run = approve_4821(rt)
    drain(rt)
    mid = rt.store.require(Run, run.id)
    assert mid.status is RunStatus.PAUSED
    assert [s.status.value for s in mid.steps[3:]] == ["ok", "ok", "pending", "pending", "pending"]
    parked = [j for j in run_start_jobs(rt, run.id) if j.state is JobState.PARKED]
    assert len(parked) == 1  # the resume job waits, parked
    for _ in range(3):
        drain(rt)
    assert len(calls) == 1 and fw.ops() == ["pms.get_image", "nea.upload"]
    art.resume("usr_morgan")
    drain(rt)
    done = rt.store.require(Run, run.id)
    assert done.status is RunStatus.SUCCEEDED and len(calls) == 2
    assert fw.ops() == ["pms.get_image", "nea.upload", "pms.write_claim_remarks", "vyne.queue"]


def test_restart_recovery_resumes_from_checkpoint(rt: Runtime, world_only_registry: Registry) -> None:
    from tests.agents.test_executor import Crash

    register(world_only_registry, CFG)
    art, fw = fake(rt, crash_after="pms.write_claim_remarks")
    run = approve_4821(rt)
    # the process dies mid-run: the run is `running`, its job still leased by the dead boot
    with contextlib.suppress(Crash):
        go(art.start_run(run.id))
    job = run_start_jobs(rt, run.id)[0]
    job.state, job.lease_owner, job.lease_until = JobState.LEASED, "boot_dead", 0.0
    rt.store.update(job)
    assert rt.store.require(Run, run.id).status is RunStatus.RUNNING
    art2 = AgentRuntime.from_runtime(rt, CFG, world_port=fw)
    assert art2.recover() == 1
    world_only_registry.unregister(K.RUN_START)

    async def start(ctx: Any) -> Any:
        from torch_rcm.agents.handlers import _outcome

        return _outcome(art2, await art2.start_run(ctx.job.payload["run_id"]), ctx)

    world_only_registry.register(K.RUN_START, start)
    drain(rt)
    done = rt.store.require(Run, run.id)
    assert done.status is RunStatus.SUCCEEDED
    assert fw.ops() == [
        "pms.get_image",
        "nea.upload",
        "pms.write_claim_remarks",
        "pms.write_claim_remarks",
        "vyne.queue",
    ]


def test_overnight_triage_when_an_835_denial_lands(rt: Runtime, world_only_registry: Registry) -> None:
    register(world_only_registry, CFG)
    rt.scheduler.enqueue(K.ERA_ARRIVED, rt.clock.now(), {"remittance_id": "rem_delta_1026"}, "test:era:rem_delta_1026")
    result = drain(rt)
    kinds = [e["kind"] for e in result.events_fired]
    assert kinds.count("triage_enqueued") == 3 and kinds.count("run_finished") == 3
    triaged = [
        r
        for r in rt.store.all(Run)
        if r.parent_run_id is None and r.trigger.value == "rule" and r.id.startswith("run_") and len(r.id) == 16
    ]
    assert {r.claim_id for r in triaged} == {"clm_4821", "clm_4836", "clm_4840"}
    assert all(r.status is RunStatus.SUCCEEDED and r.planner.value == "scripted" for r in triaged)
    # a second 835 delivery (at-least-once) starts nothing new
    rt.scheduler.enqueue(
        K.ERA_ARRIVED, rt.clock.now(), {"remittance_id": "rem_delta_1026"}, "test:era:rem_delta_1026:dup"
    )
    drain(rt)
    assert len([r for r in rt.store.all(Run) if r.id.startswith("run_") and len(r.id) == 16]) == 3


def test_outage_reschedules_a_triage_run_two_hours_later(rt: Runtime) -> None:
    art = AgentRuntime.from_runtime(rt, CFG)
    run = art.create_triage_run("clm_4821", key="test:retry")
    job = art.reschedule_after_outage(run)
    assert job is not None and job.kind == K.TRIAGE and (job.due_at - rt.clock.now()).total_seconds() == 7200


def test_checkpoint_pin_mismatch_discards_messages_keeps_plan(rt: Runtime) -> None:
    art = AgentRuntime.from_runtime(rt, CFG)
    pin = Pin(model="claude-sonnet-5-5", effort="medium", thinking="between_tools", system_sha="a", tools_sha="b")
    art.runs.save_checkpoint("run_x", pin, [{"role": "assistant", "content": []}], {"plan": {"k": 1}})
    same = art.runs.load_checkpoint("run_x", pin)
    other = art.runs.load_checkpoint("run_x", pin.model_copy(update={"system_sha": "changed"}))
    assert same is not None and same.pin_matches and same.messages
    assert other is not None and not other.pin_matches and other.messages == [] and other.state == {"plan": {"k": 1}}


def test_advance_limits_cap_live_runs_per_advance() -> None:
    lim = AdvanceLimits(live_concurrency=2, advance_live_run_cap=2)
    assert [lim.take_live("adv_1") for _ in range(3)] == [True, True, False]
    assert lim.take_live("adv_2") and lim.take_live(None)
    assert lim.semaphore._value == 2


def test_status_reports_counts(rt: Runtime) -> None:
    art = AgentRuntime.from_runtime(rt, CFG)
    st = art.status()
    assert st["mode"] == "deterministic" and st["live_agents"] == [] and st["paused"] is False
    assert rt.store.all(Practice)[0].agents_paused is False


def test_live_planner_slot_and_advance_cap(rt: Runtime, monkeypatch: Any) -> None:
    import torch_rcm.agents.planner.live as live_mod
    from torch_rcm.agents.config import AgentConfig
    from torch_rcm.agents.planner.scripted import ScriptedPlanner
    from torch_rcm.agents.types import Usage

    pin = Pin(model="claude-sonnet-5-5", effort="medium", thinking="between_tools", system_sha="s", tools_sha="t")

    class StubLive:
        kind = "live"

        def __init__(self) -> None:
            self.usage = Usage(model_calls=1, input=10)
            self.pin = pin
            self.transcript: list[dict[str, Any]] = []  # the Planner protocol's checkpoint transcript

        def expected_pin(self, agent: Any) -> Pin:
            return pin

        async def plan(self, case: Any, read: Any, evidence: Any) -> Any:
            plan = await ScriptedPlanner().plan(case, read, evidence)
            return plan.model_copy(update={"planner": "live", "situation_description": "PA missing for #19"})

    made: list[str] = []
    monkeypatch.setattr(live_mod, "make_planner", lambda rt_, run_id: made.append(run_id) or StubLive(), raising=False)
    cfg = AgentConfig(agent_mode="live", step_delay=False, advance_live_run_cap=1, world_retry_backoff_s=(0.0,))
    art = AgentRuntime.from_runtime(rt, cfg)
    first = go(art.triage("clm_4821", key="t:live:1", advance_id="adv_1")).run
    second = go(art.triage("clm_4836", key="t:live:2", advance_id="adv_1")).run
    assert first.planner.value == "live" and first.model_situation_label == "PA missing for #19"
    assert first.mode.value == "live" and second.mode.value == "live"  # the run records the mode it ran under
    assert first.usage.model_calls == 1 and len(made) == 1
    ck = art.runs.load_checkpoint(first.id, pin)
    assert ck is not None and ck.pin_matches
    assert second.planner.value == "scripted"  # over the per-advance cap → labelled script
    assert (second.plan or {})["agent_plan"]["fallback_reason"] == "advance cap"
