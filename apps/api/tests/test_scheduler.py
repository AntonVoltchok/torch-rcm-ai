"""Scheduler: the demo-script step 8 skip to Thu 07:10, ordering (causal barrier), idempotent enqueue, agent
handler registration, unhandled kinds, lease recovery, the async advance and its 409."""

from __future__ import annotations

import asyncio
from collections import Counter
from datetime import datetime, timedelta

import pytest

from conftest import THURSDAY_0710, snap
from torch.domain.entities import Advance, Claim, FileEntry, Job
from torch.domain.enums import ClaimStatus, FileEntryKind, FileEntryState, JobState
from torch.readmodels.claims import strip
from torch.runtime import Runtime
from torch.scheduler import kinds as K
from torch.scheduler.cadence import next_status_check
from torch.scheduler.registry import JobContext, JobOutcome
from torch.scheduler.runner import AdvanceInProgressError

S = ClaimStatus
GROUP = ("clm_4821", "clm_4836", "clm_4840")


def approve_delta_group(rt: Runtime) -> None:
    """Stand-in for the agents' approval recipe: the NEA# arrives after 10:44, so the resubmits miss 10:45."""
    rt.clock.set(datetime.fromisoformat("2026-10-28T10:44:30-04:00"))
    for claim_id in GROUP:
        rt.world.vyne.queue(claim_id, FileEntryKind.RESUBMIT, by="usr_dana", key=f"test:resubmit:{claim_id}")


def test_skip_to_thursday_0710_matches_demo_step_8(rt: Runtime) -> None:
    approve_delta_group(rt)
    result = asyncio.run(rt.scheduler.run_due(THURSDAY_0710))
    events = result.events_fired
    departed = {e["data"]["claim_id"]: e["at"][11:16] for e in events if e["kind"] == "file_departed"}
    assert {departed[c] for c in GROUP} == {"11:15"}, "the Owens group leaves in the 11:15 Delta file"
    assert departed["clm_4859"] == "10:45" and departed["clm_4855"] == "10:45"
    a1 = {e["data"]["claim_id"] for e in events if e["kind"] == "clearinghouse_ack" and e["data"]["code"] == "A1"}
    assert set(GROUP) <= a1, "Vyne 277CA A1 for the resubmits"
    denied = {
        e["data"]["claim_id"]: (e["data"]["carc"], e["data"]["rarc"]) for e in events if e["kind"] == "claim_denied"
    }
    assert denied == {
        "clm_4796": ("CO-50", "N10"),
        "clm_4800": ("CO-22", None),
        "clm_3561": ("CO-29", None),
        "clm_4797": ("CO-16", "M127"),
    }
    eras = [e for e in events if e["kind"] == "era_arrived"]
    assert {e["data"]["payer"] for e in eras} == {"delta_ny", "metlife", "aetna", "guardian"}
    assert all(e["at"] < "2026-10-29T07:10" for e in eras), "835s arrive overnight"
    s = snap(rt)
    tiles = {t.status: t for t in strip(s, "usr_dana").tiles}
    assert tiles[S.DENIED].count == 9, "strip Denied → 9 (the group stays denied, in flight)"
    assert tiles[S.PAID].count == 118 + 6, "six paid overnight"
    for claim_id in GROUP:
        claim = s.claims[claim_id]
        assert claim.status is S.DENIED and claim.in_flight and "11:15" in claim.in_flight
    assert s.now == THURSDAY_0710
    agent_jobs = dict(result.skipped_unhandled)
    assert agent_jobs.get(K.ERA_ARRIVED) == 4, "one posting trigger per remittance, queued for torch.agents"
    assert K.STATUS_CHECK_DUE in agent_jobs, "status checks fired (queued for the followup agent)"


def test_new_inbox_triggers_are_enqueued_for_agents(rt: Runtime, world_only_registry) -> None:  # type: ignore[no-untyped-def]
    seen: list[tuple[str, str]] = []

    def record(ctx: JobContext) -> JobOutcome:
        seen.append((ctx.job.kind, ctx.now.isoformat()))
        out = JobOutcome()
        out.add("agent_stub", ctx.job.kind)
        return out

    for kind in (K.ERA_ARRIVED, K.STATUS_CHECK_DUE, K.VISIT_CHECKED_OUT, K.CLAIM_REJECTED):
        world_only_registry.register(kind, record)
    result = asyncio.run(rt.scheduler.run_due(THURSDAY_0710))
    kinds = Counter(k for k, _ in seen)
    assert kinds[K.ERA_ARRIVED] == 4 and kinds[K.VISIT_CHECKED_OUT] == 5
    assert result.skipped_unhandled.get(K.ERA_ARRIVED) is None
    era_at = sorted(t for k, t in seen if k == K.ERA_ARRIVED)
    assert era_at[0].startswith("2026-10-29T05:40"), "the posting trigger runs at the instant the 835 lands (barrier)"


def test_order_is_due_then_priority_then_id(rt: Runtime, world_only_registry) -> None:  # type: ignore[no-untyped-def]
    order: list[str] = []
    world_only_registry.register("test.a", lambda ctx: order.append(ctx.job.payload["n"]))  # type: ignore[arg-type,func-returntype]
    t = rt.clock.now() + timedelta(minutes=1)
    rt.scheduler.enqueue("test.a", t, {"n": "late-low"}, "k1", priority=90)
    rt.scheduler.enqueue("test.a", t, {"n": "late-high"}, "k2", priority=10)
    rt.scheduler.enqueue("test.a", t - timedelta(seconds=30), {"n": "early"}, "k3", priority=99)
    asyncio.run(rt.scheduler.run_due(t))
    assert order == ["early", "late-high", "late-low"]


def test_handler_follow_ups_run_before_later_jobs(rt: Runtime, world_only_registry) -> None:  # type: ignore[no-untyped-def]
    order: list[str] = []

    def parent(ctx: JobContext) -> None:
        order.append("parent")
        ctx.enqueue("test.child", ctx.now, {}, "child")

    world_only_registry.register("test.parent", parent)
    world_only_registry.register("test.child", lambda ctx: order.append("child"))  # type: ignore[arg-type,func-returntype]
    world_only_registry.register("test.later", lambda ctx: order.append("later"))  # type: ignore[arg-type,func-returntype]
    t = rt.clock.now() + timedelta(minutes=1)
    rt.scheduler.enqueue("test.parent", t, {}, "p")
    rt.scheduler.enqueue("test.later", t + timedelta(seconds=1), {}, "l")
    asyncio.run(rt.scheduler.run_due(t + timedelta(minutes=5)))
    assert order == ["parent", "child", "later"]


def test_enqueue_is_idempotent(rt: Runtime) -> None:
    a = rt.scheduler.enqueue("x.y", rt.clock.now(), {"v": 1}, "same-key")
    b = rt.scheduler.enqueue("x.y", rt.clock.now() + timedelta(days=1), {"v": 2}, "same-key")
    assert a.id == b.id and b.payload == {"v": 1}
    assert rt.store.count(Job, {"idempotency_key": "same-key"}) == 1


def test_failed_job_retries_then_dies(rt: Runtime, world_only_registry) -> None:  # type: ignore[no-untyped-def]
    def boom(ctx: JobContext) -> None:
        raise RuntimeError("portal timeout")

    world_only_registry.register("test.boom", boom)
    job = rt.scheduler.enqueue("test.boom", rt.clock.now(), {}, "boom")
    for _ in range(job.max_attempts):
        asyncio.run(rt.scheduler.run_due(rt.clock.now()))
    final = rt.store.require(Job, job.id)
    assert (
        final.state is JobState.DEAD
        and final.attempts == job.max_attempts
        and "portal timeout" in (final.last_error or "")
    )


def test_stale_lease_is_recovered(rt: Runtime) -> None:
    job = rt.scheduler.enqueue("x.lease", rt.clock.now(), {}, "lease")
    job.state, job.lease_owner, job.lease_until = JobState.LEASED, "boot_dead", 0.0
    rt.store.update(job)
    assert rt.scheduler.queue.recover() == 1
    assert rt.store.require(Job, job.id).state is JobState.QUEUED


def test_clock_only_moves_forward(rt: Runtime) -> None:
    from torch.clock import ClockError

    with pytest.raises(ClockError):
        rt.clock.set(rt.clock.now() - timedelta(minutes=1))


def test_async_advance_returns_immediately_and_rejects_a_second(rt: Runtime) -> None:
    async def scenario() -> Advance:
        advance = rt.scheduler.start_advance(THURSDAY_0710, "usr_morgan")
        with pytest.raises(AdvanceInProgressError):
            rt.scheduler.start_advance(THURSDAY_0710 + timedelta(hours=1), "usr_morgan")
        await rt.scheduler.wait()
        return rt.store.require(Advance, advance.id)

    done = asyncio.run(scenario())
    assert done.state.value == "done" and done.now == THURSDAY_0710
    assert any(e["kind"] == "claim_denied" for e in done.events_fired)


def test_status_check_cadence_day_30_then_15() -> None:
    sent = datetime.fromisoformat("2026-10-12T10:45:00-04:00")
    n, when = next_status_check(sent.date(), sent)
    assert (n, when.date().isoformat()) == (0, "2026-11-11"), "Owens: day 30 from the 10/12 send"
    n2, when2 = next_status_check(
        datetime.fromisoformat("2026-09-16T10:15:00-04:00").date(), datetime.fromisoformat("2026-10-28T10:40:00-04:00")
    )
    assert (n2, when2.date().isoformat()) == (1, "2026-11-02"), "Hale: day 45 is Sat 10/31 → Mon 11/02"


def test_seeded_status_checks_for_unknown_claims_fall_after_friday(rt: Runtime) -> None:
    jobs = rt.store.find(Job, {"kind": K.STATUS_CHECK_DUE})
    due = {j.payload["claim_id"]: j.due_at.date().isoformat() for j in jobs}
    assert due["clm_4744"] == "2026-11-02"
    assert due["clm_4709"] > "2026-10-30" and due["clm_4731"] > "2026-10-30"
    assert due["clm_4821"] == "2026-11-11"


def test_file_departure_closes_the_hold_window(rt: Runtime) -> None:
    from torch.world.sim import HoldWindowClosedError

    rt.world.vyne.assert_editable("clm_4859")
    asyncio.run(rt.scheduler.run_due(datetime.fromisoformat("2026-10-28T10:46:00-04:00")))
    with pytest.raises(HoldWindowClosedError):
        rt.world.vyne.assert_editable("clm_4859")
    entry = rt.store.find(FileEntry, {"claim_id": "clm_4859"})[0]
    assert entry.state is FileEntryState.DEPARTED
    assert rt.store.require(Claim, "clm_4859").status is S.SENT
