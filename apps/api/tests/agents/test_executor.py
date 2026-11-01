"""Executor: recipe steps, idempotency, crash resume, outage handling (07 §4, §8, §9)."""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from typing import Any

import pytest

from torch.agents.config import AgentConfig
from torch.agents.executor import needs_person
from torch.agents.ports import WorldCallResult, WorldRead, WorldUnavailable
from torch.agents.runtime import AgentRuntime
from torch.agents.types import CaseFile, DeadlineView, JsonValue, Subject
from torch.api.services.context import Ctx
from torch.api.services.inbox import approve
from torch.domain.entities import InboxItem, Practice, Run, WorldCallLog
from torch.domain.enums import AgentKind, InboxItemKind, RunStatus, RunTrigger
from torch.runtime import Runtime

CFG = AgentConfig(step_delay=False, world_retry_backoff_s=(0.0, 0.0, 0.0))
RESUBMIT_STEPS = [
    "gather_case",
    "investigate",
    "decide",
    "act:fetch_image",
    "act:nea_upload",
    "act:write_remarks",
    "act:queue_for_file",
    "report",
]


class Crash(RuntimeError):
    """A simulated process crash between a world call and the step's bookkeeping."""


class FakeWorld:
    """WorldPort over the real SimWorld that can go down, crash once, or flip the kill switch."""

    def __init__(self, inner: Any, *, down: set[str] | None = None, crash_after: str | None = None, pause_after: str | None = None, store: Any = None) -> None:
        self.inner = inner
        self.down = down or set()
        self.crash_after = crash_after
        self.pause_after = pause_after
        self.store = store
        self.calls: list[tuple[str, str]] = []

    def read(self, op: str, args: Mapping[str, JsonValue], *, run_id: str | None = None) -> WorldRead:
        return self.inner.read(op, args, run_id=run_id)

    def act(self, op: str, args: Mapping[str, JsonValue], idempotency_key: str, *, run_id: str) -> WorldCallResult:
        self.calls.append((op, idempotency_key))
        if op in self.down:
            raise WorldUnavailable(f"{op.split('.', maxsplit=1)[0]} portal down")
        res = self.inner.act(op, args, idempotency_key, run_id=run_id)
        if op == self.crash_after:
            self.crash_after = None
            raise Crash(op)
        if op == self.pause_after:
            self.pause_after = None
            p = self.store.all(Practice)[0]
            p.agents_paused = True
            self.store.update(p)
        return res

    def ops(self) -> list[str]:
        return [op for op, _ in self.calls]


def agents(rt: Runtime, **kw: Any) -> AgentRuntime:
    return AgentRuntime.from_runtime(rt, CFG, **kw)


def fake(rt: Runtime, **kw: Any) -> tuple[AgentRuntime, FakeWorld]:
    from torch.agents.tools.adapters import SimWorld

    fw = FakeWorld(SimWorld(rt.world), store=rt.store, **kw)
    return agents(rt, world_port=fw), fw


def approve_4821(rt: Runtime) -> Run:
    out = approve(Ctx.for_user(rt, "usr_dana"), "itm_4821", None)
    assert out.run is not None
    return out.run


def approval_run(rt: Runtime, action: str, params: dict[str, Any], suffix: str = "x") -> Run:
    run = Run(
        id=f"run_test_{action}_{suffix}",
        agent=AgentKind.FOLLOWUP,
        trigger=RunTrigger.APPROVAL,
        actor="usr_dana",
        claim_id=params.get("claim_id"),
        idempotency_key=f"test:{action}:{suffix}",
        status=RunStatus.QUEUED,
        plan={"proposed_action": {"action": action, "params": params}, "edits": {}},
        started_at=rt.clock.now(),
    )
    rt.store.insert(run)
    return run


def go(coro: Any) -> Any:
    return asyncio.run(coro)


# ── end to end ─────────────────────────────────────────────────────────────────────────────────────────────


def test_resubmit_with_attachment_on_4821_runs_the_recipe(rt: Runtime) -> None:
    art = agents(rt)
    run = approve_4821(rt)
    res = go(art.start_run(run.id))
    run = res.run
    assert run.status is RunStatus.SUCCEEDED, run.steps
    assert [s.name for s in run.steps] == RESUBMIT_STEPS
    assert all(s.status.value == "ok" for s in run.steps)
    assert run.planner.value == "scripted" and run.verdict is not None and run.verdict.value == "execute"
    # each world step carried `{run_id}:{step_idx}:{op}`
    keys = {w.idempotency_key for w in rt.store.find(WorldCallLog, {"run_id": run.id}) if w.idempotency_key}
    assert f"{run.id}:4:nea.upload" in keys and f"{run.id}:6:vyne.queue" in keys
    # NEA evidence row with world provenance on the nea_upload step
    nea_step = run.steps[4]
    evs = art.runs.evidence_for_run(run.id)
    assert [e.kind.value for e in evs] == ["nea_attachment"]
    assert evs[0].id in nea_step.evidence_ids and evs[0].world_call_id
    nea = evs[0].reference
    assert nea and f"NEA# {nea}" in run.steps[5].output_summary
    assert run.steps[6].output_summary.startswith("queue for 11:15 Delta file")
    # code-built audit line (07 §5.5)
    assert run.audit_line.startswith("Follow-up · Resubmit with attachment · #4821 K. Owens · Delta · $1,240 · PA via NEA# ")
    assert "approved by Dana S." in run.audit_line and run.audit_line.endswith("until the 11:15 file leaves")
    # checkpoint pinned to the scripted planner
    ck = art.runs.load_checkpoint(run.id)
    assert ck is not None and ck.pin is not None and ck.pin.system_sha == "planner=scripted"


def test_re_execution_is_idempotent(rt: Runtime) -> None:
    art, fw = fake(rt)
    run = approve_4821(rt)
    first = go(art.start_run(run.id)).run
    n = len(fw.calls)
    again = go(art.start_run(run.id))
    assert again.replayed and again.run.status is RunStatus.SUCCEEDED and len(fw.calls) == n
    # the world returns the stored result for a repeated step key: the same NEA#
    op, key = next(c for c in fw.calls if c[0] == "nea.upload")
    replay = fw.inner.act(op, {"claim_id": "clm_4821", "image_id": "x", "kind": "pa"}, key, run_id=first.id)
    assert replay.replayed and replay.data["nea_number"] == art.runs.evidence_for_run(first.id)[0].reference


def test_resume_from_checkpoint_after_crash(rt: Runtime) -> None:
    art, fw = fake(rt, crash_after="nea.upload")
    run = approve_4821(rt)
    with pytest.raises(Crash):
        go(art.start_run(run.id))
    mid = art.runs.require(run.id)
    assert mid.status is RunStatus.RUNNING
    assert [s.status.value for s in mid.steps[:5]] == ["ok", "ok", "ok", "ok", "running"]
    # restart: a fresh runtime over the same store resumes from the last ok step
    art2 = agents(rt, world_port=fw)
    done = go(art2.start_run(run.id)).run
    assert done.status is RunStatus.SUCCEEDED
    assert fw.ops() == ["pms.get_image", "nea.upload", "nea.upload", "pms.write_claim_remarks", "vyne.queue"]
    uploads = [w for w in rt.store.find(WorldCallLog, {"run_id": run.id}) if w.operation == "nea.upload"]
    assert len(uploads) == 1  # the re-executed step got the stored NEA#, not a second upload
    assert f"NEA# {uploads[0].response['nea_number']}" in done.steps[5].output_summary


def test_world_unavailable_retries_then_fails_with_item_when_file_time_at_risk(rt: Runtime) -> None:
    art, fw = fake(rt, down={"nea.upload"})
    run = approve_4821(rt)
    res = go(art.start_run(run.id))
    assert res.run.status is RunStatus.FAILED and res.failure == "world_unavailable"
    assert fw.ops().count("nea.upload") == 4  # first try + 3 retries (07 §9)
    st = {s.name: s.status.value for s in res.run.steps}
    assert st["act:nea_upload"] == "failed" and st["act:write_remarks"] == "skipped" and st["act:queue_for_file"] == "skipped"
    assert any("retry 3 of 3" in line for line in res.run.steps[4].progress_lines)
    items = [i for i in rt.store.all(InboxItem) if i.run_id == run.id and i.kind is InboxItemKind.RUN_FAILED]
    assert len(items) == 1 and res.inbox_item_ids == [items[0].id]
    assert res.run.audit_line  # a failed run always writes its audit line
    assert art.reschedule_after_outage(res.run) is None  # approvals never re-run automatically


def test_world_unavailable_without_a_decision_makes_no_item(rt: Runtime) -> None:
    art, _ = fake(rt, down={"payer.check_status"})
    run = approval_run(rt, "status_check", {"claim_id": "clm_4821", "channel": "portal"})
    res = go(art.start_run(run.id))
    assert res.run.status is RunStatus.FAILED and res.failure == "world_unavailable"
    assert not [i for i in rt.store.all(InboxItem) if i.run_id == run.id]


def test_needs_person_is_deadline_or_file_time() -> None:
    from datetime import date, datetime, timedelta, timezone

    now = datetime(2026, 10, 28, 10, 40, tzinfo=timezone(timedelta(hours=-4)))
    base = CaseFile(run_id="r", practice_id="p", agent="followup", subject=Subject(kind="claim", id="c"), now=now)
    assert not needs_person(base, ["payer.check_status"])
    assert needs_person(base, ["vyne.queue"])
    near = base.model_copy(update={"deadlines": (DeadlineView(kind="appeal", due_on=date(2026, 11, 5), basis=""),)})
    assert needs_person(near, ["payer.check_status"])


def test_triage_proposes_and_reuses_the_open_item(rt: Runtime) -> None:
    art = agents(rt)
    res = go(art.triage("clm_4821", key="test:triage:4821"))
    run = res.run
    assert run.status is RunStatus.SUCCEEDED and run.verdict is not None and run.verdict.value == "propose"
    assert [s.name for s in run.steps] == ["gather_case", "investigate", "decide", "report"]
    assert "PMS imaging · PA #19 · 1 found" in run.steps[1].progress_lines
    assert res.inbox_item_ids == ["itm_4821"]  # one open item per (claim, action)
    assert run.steps[2].output_summary.startswith("propose: Resubmit with attachment · rule Missing PA")
