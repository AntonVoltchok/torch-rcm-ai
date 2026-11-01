"""Agent runtime: the run store, the event bus and the `AgentRuntime` facade (07 §8, §10).

Principle: the model proposes; code gates and executes. Nothing here decides an action: `RunStore` persists
what the executor did (runs, steps, evidence, pinned checkpoints), `EventBus` tells the UI, and `AgentRuntime`
wires one process's store, clock and world to the `Executor` and exposes the controls the scheduler and the API
need (start a run, triage a claim, pause/resume, recover after a crash).

SQLite rules (07 §8): every RunStore method is one short transaction; none is held across a world call, a
planner await or a step delay.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from torch.agents.config import AgentConfig
from torch.agents.ports import WorldPort
from torch.agents.types import UNKNOWN, AgentKind, Evidence, Pin
from torch.db.store import Store
from torch.domain.entities import Claim, Job, Practice, Run, RunCheckpoint, RunStep
from torch.domain.entities import Evidence as EvidenceRow
from torch.domain.enums import (
    ACTIVE_RUN_STATUSES,
    ClaimStatus,
    GatheredBy,
    JobState,
    PolicyVerdict,
    RunStatus,
    RunTrigger,
    StepStatus,
)
from torch.domain.enums import (
    AgentKind as DomainAgentKind,
)
from torch.domain.enums import EvidenceKind as DomainEvidenceKind
from torch.events import FIREHOSE, last_seq
from torch.events import publish as persist_event
from torch.events import replay as replay_events

__all__ = [
    "TERMINAL",
    "AdvanceLimits",
    "AgentRuntime",
    "Checkpoint",
    "EventBus",
    "RunStore",
    "run_id_for",
]

TERMINAL: frozenset[RunStatus] = frozenset(
    {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED, RunStatus.WOULD_HAVE_RUN}
)


def run_id_for(idempotency_key: str) -> str:
    """07 §4: `run_id = "run_" + sha256(idempotency_key)[:12]`."""
    return "run_" + hashlib.sha256(idempotency_key.encode()).hexdigest()[:12]


# ──────────────────────────────────────────────────────────────────────────────────────────── RunStore


@dataclass(frozen=True)
class Checkpoint:
    pin: Pin | None
    messages: list[dict[str, Any]]
    state: dict[str, Any]
    pin_matches: bool = True


class RunStore:
    """Runs, steps, evidence and checkpoints over `torch.db.store.Store`. Sync, one short tx per call."""

    def __init__(self, store: Store, clock: Any) -> None:
        self.store = store
        self.clock = clock

    # ── runs ──
    def get(self, run_id: str) -> Run | None:
        return self.store.get(Run, run_id)

    def require(self, run_id: str) -> Run:
        return self.store.require(Run, run_id)

    def list(self, *, agent: str | None = None, status: str | None = None, claim_id: str | None = None) -> list[Run]:
        where: dict[str, Any] = {}
        if agent:
            where["agent"] = agent
        if status:
            where["status"] = status
        if claim_id:
            where["claim_id"] = claim_id
        return self.store.find(Run, where or None, order_by="started_at")

    def by_key(self, idempotency_key: str) -> Run | None:
        rows = self.store.find(Run, {"idempotency_key": idempotency_key}, limit=1)
        return rows[0] if rows else None

    def create(self, run: Run) -> Run:
        """Unique on idempotency_key: a second create returns the first run unchanged."""
        with self.store.tx():
            existing = self.by_key(run.idempotency_key)
            if existing is not None:
                return existing
            self.store.insert(run)
        return run

    def _mutate(self, run_id: str, fn: Callable[[Run], None]) -> Run:
        with self.store.tx():
            run = self.store.require(Run, run_id)
            fn(run)
            self.store.update(run)
        return run

    def update(self, run_id: str, **fields: Any) -> Run:
        """Set fields, re-validated (so enum fields given as strings come back as enums)."""
        with self.store.tx():
            current = self.store.require(Run, run_id)
            run = Run.model_validate({**current.model_dump(), **fields})
            self.store.update(run)
        return run

    def set_status(self, run_id: str, status: RunStatus | str) -> Run:
        return self.update(run_id, status=RunStatus(status))

    def finish(self, run_id: str, status: RunStatus | str, summary: str, audit_line: str, outcome: str, **extra: Any) -> Run:
        return self.update(
            run_id,
            status=RunStatus(status),
            result_summary=summary,
            audit_line=audit_line,
            outcome=outcome,
            finished_at=self.clock.now(),
            **extra,
        )

    # ── steps ──
    def ensure_steps(self, run_id: str, layout: list[tuple[str, str, str]]) -> Run:
        """Append pending steps (name, label, tool) that are not there yet, in order."""

        def apply(run: Run) -> None:
            have = {s.name for s in run.steps}
            for name, label, tool in layout:
                if name in have:
                    continue
                run.steps.append(
                    RunStep(idx=len(run.steps), name=name, label=label, tool=tool, status=StepStatus.PENDING)
                )
                have.add(name)

        return self._mutate(run_id, apply)

    def start_step(self, run_id: str, idx: int, input_summary: str = "", at: datetime | None = None) -> RunStep:
        def apply(run: Run) -> None:
            step = run.steps[idx]
            step.status = StepStatus.RUNNING
            step.started_at = at or self.clock.now()
            step.finished_at = None
            if input_summary:
                step.input_summary = input_summary

        return self._mutate(run_id, apply).steps[idx]

    def progress(self, run_id: str, idx: int, line: str) -> RunStep:
        def apply(run: Run) -> None:
            if line not in run.steps[idx].progress_lines:
                run.steps[idx].progress_lines.append(line)

        return self._mutate(run_id, apply).steps[idx]

    def finish_step(
        self,
        run_id: str,
        idx: int,
        status: StepStatus | str,
        output_summary: str,
        evidence_ids: list[str] | None = None,
        *,
        policy_verdict: str | None = None,
        at: datetime | None = None,
    ) -> RunStep:
        def apply(run: Run) -> None:
            step = run.steps[idx]
            step.status = StepStatus(status)
            step.output_summary = output_summary
            step.finished_at = at or self.clock.now()
            if evidence_ids is not None:
                step.evidence_ids = list(dict.fromkeys([*step.evidence_ids, *evidence_ids]))
            if policy_verdict is not None:
                step.policy_verdict = PolicyVerdict(policy_verdict)

        return self._mutate(run_id, apply).steps[idx]

    # ── evidence ──
    def save_evidence(self, ev: Evidence) -> None:
        if self.store.get(EvidenceRow, ev.id) is not None:
            return
        self.store.insert(
            EvidenceRow(
                id=ev.id,
                kind=DomainEvidenceKind(ev.kind),
                title=ev.title,
                excerpt=ev.excerpt,
                uri=ev.uri,
                captured_at=ev.captured_at,
                reference=ev.reference,
                suspicious=ev.suspicious,
                gathered_by=GatheredBy(ev.gathered_by),
                claim_id=ev.claim_id,
                run_id=ev.run_id,
                world_call_id=ev.world_call_id,
                source=ev.source,
                data={**ev.data, **({"step_idx": ev.step_idx} if ev.step_idx is not None else {})},
            )
        )

    def evidence_for_run(self, run_id: str) -> list[EvidenceRow]:
        return self.store.find(EvidenceRow, {"run_id": run_id}, order_by="id")

    # ── checkpoints ──
    def save_checkpoint(self, run_id: str, pin: Pin, messages: list[dict[str, Any]], state: dict[str, Any]) -> None:
        self.store.upsert(
            RunCheckpoint(
                id=run_id,
                model=pin.model,
                effort=pin.effort,
                thinking=pin.thinking,
                system_sha=pin.system_sha,
                tools_sha=pin.tools_sha,
                messages=messages,
                plan=state,
                updated_at=self.clock.now(),
            )
        )

    def load_checkpoint(self, run_id: str, current: Pin | None = None) -> Checkpoint | None:
        """The saved checkpoint. With `current`, a pin mismatch discards the conversation (thinking blocks
        would 400) but keeps the persisted plan state: nothing mutates before the plan, and after it the plan's
        recipes continue (07 §8)."""
        row = self.store.get(RunCheckpoint, run_id)
        if row is None:
            return None
        pin = (
            Pin(
                model=row.model or "",
                effort=row.effort,
                thinking=row.thinking or "disabled",
                system_sha=row.system_sha or "",
                tools_sha=row.tools_sha or "",
            )
            if row.model is not None
            else None
        )
        matches = current is None or pin == current
        return Checkpoint(pin=pin, messages=row.messages if matches else [], state=dict(row.plan or {}), pin_matches=matches)

    # ── events ──
    def last_event_id(self, run_id: str) -> int:
        return last_seq(self.store, run_id)


# ──────────────────────────────────────────────────────────────────────────────────────────── EventBus


def _sse(seq: int | str | None, event: str, data: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"event": event, "data": data}
    if seq is not None:
        out["id"] = str(seq)
    return out


class EventBus:
    """In-process asyncio fan-out over the persisted `run_events` log (`torch.events`).

    `publish` appends to the log first (so a reconnecting client can replay with Last-Event-ID), then wakes
    subscribers. Events: `step` (phase started|progress|completed|failed), `status`, `counts`, `done` on a run's
    channel; `status`, `advance`, `agents` on the firehose.
    """

    def __init__(self, store: Store, clock: Any) -> None:
        self.store = store
        self.clock = clock
        self._subs: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}

    def publish(self, channel: str, event: str, data: dict[str, Any]) -> int:
        payload = json.loads(json.dumps(data, default=str))
        seq = persist_event(self.store, channel, event, payload, self.clock.now())
        for q in list(self._subs.get(channel, ())):
            q.put_nowait(_sse(seq, event, payload))
        return seq

    def replay(self, channel: str, after: int = 0) -> list[dict[str, Any]]:
        """Stored events after `after`. A run with no event log (seeded history) replays its stored steps."""
        rows = replay_events(self.store, channel, after, limit=10_000)
        if rows or after or channel == FIREHOSE:
            return [_sse(r.seq, r.event, r.data) for r in rows]
        run = self.store.get(Run, channel)
        if run is None:
            return []
        out = [_sse(f"s{s.idx}", "step", step_event(run, s, "completed" if s.status is StepStatus.OK else s.status.value)) for s in run.steps]
        if run.status in TERMINAL:
            out += [_sse(None, "status", {"run_id": run.id, "status": run.status.value}), _sse(None, "done", done_event(run))]
        return out

    @asynccontextmanager
    async def _queue(self, channel: str) -> AsyncIterator[asyncio.Queue[dict[str, Any]]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._subs.setdefault(channel, set()).add(q)
        try:
            yield q
        finally:
            self._subs[channel].discard(q)

    async def subscribe(
        self,
        channel: str,
        last_event_id: int | str | None = None,
        *,
        until_done: bool | None = None,
        poll_s: float = 0.5,
    ) -> AsyncIterator[dict[str, Any]]:
        """Replay after Last-Event-ID, then follow live events. A run channel ends after `done`. Every
        `poll_s` without a live event the stored log is re-read, so events published by another bus (another
        process or runtime instance) still arrive."""
        stop_on_done = channel != FIREHOSE if until_done is None else until_done
        after = int(last_event_id) if str(last_event_id or "").isdigit() else 0
        async with self._queue(channel) as q:
            seen = after
            for ev in self.replay(channel, after):
                if str(ev.get("id", "")).isdigit():
                    seen = max(seen, int(ev["id"]))
                yield ev
                if stop_on_done and ev["event"] == "done":
                    return
            run = self.store.get(Run, channel) if stop_on_done else None
            if run is not None and run.status in TERMINAL and not replay_events(self.store, channel, seen, limit=1):
                return
            while True:
                try:
                    batch = [await asyncio.wait_for(q.get(), timeout=poll_s)]
                except TimeoutError:
                    batch = [_sse(r.seq, r.event, r.data) for r in replay_events(self.store, channel, seen, limit=1000)]
                for ev in batch:
                    if str(ev.get("id", "")).isdigit():
                        if int(ev["id"]) <= seen:
                            continue
                        seen = int(ev["id"])
                    yield ev
                    if stop_on_done and ev["event"] == "done":
                        return


def step_event(run: Run, step: RunStep, phase: str, progress_line: str | None = None, evidence: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    out: dict[str, Any] = {
        "run_id": run.id,
        "idx": step.idx,
        "name": step.name,
        "label": step.label,
        "phase": phase,
        "status": step.status.value,
        "output_summary": step.output_summary,
        "progress_lines": list(step.progress_lines),
        "policy_verdict": step.policy_verdict.value if step.policy_verdict else None,
        "evidence_ids": list(step.evidence_ids),
        "model_situation_label": run.model_situation_label,
        "planner": run.planner.value,
    }
    if progress_line is not None:
        out["progress_line"] = progress_line
    if evidence:
        out["evidence"] = evidence
    return out


def done_event(run: Run) -> dict[str, Any]:
    return {
        "run_id": run.id,
        "status": run.status.value,
        "outcome": run.outcome,
        "result_summary": run.result_summary,
        "audit_line": run.audit_line,
        "planner": run.planner.value,
        "model_situation_label": run.model_situation_label,
    }


# ──────────────────────────────────────────────────────────────────────────────────────────── limits


@dataclass
class AdvanceLimits:
    """Live-mode orchestration bounds (07 §8): `live_concurrency` concurrent model planners and at most
    `advance_live_run_cap` live runs per clock advance. Both are no-ops in deterministic mode."""

    live_concurrency: int = 2
    advance_live_run_cap: int = 8
    _live_by_advance: dict[str, int] = field(default_factory=dict)
    _sem: asyncio.Semaphore | None = None

    @classmethod
    def from_config(cls, cfg: AgentConfig) -> AdvanceLimits:
        return cls(live_concurrency=cfg.live_concurrency, advance_live_run_cap=cfg.advance_live_run_cap)

    def take_live(self, advance_id: str | None) -> bool:
        """Count one live run against the advance's cap; False once the cap is spent (→ labelled script)."""
        if advance_id is None:
            return True
        used = self._live_by_advance.get(advance_id, 0)
        if used >= self.advance_live_run_cap:
            return False
        self._live_by_advance[advance_id] = used + 1
        return True

    def live_runs(self, advance_id: str | None) -> int:
        return self._live_by_advance.get(advance_id or "", 0)

    @property
    def semaphore(self) -> asyncio.Semaphore:
        if self._sem is None:
            self._sem = asyncio.Semaphore(max(1, self.live_concurrency))
        return self._sem


# ──────────────────────────────────────────────────────────────────────────────────────────── facade


def default_agent_for(claim: Claim) -> AgentKind:
    if claim.status in (ClaimStatus.READY, ClaimStatus.REJECTED):
        return "claims"
    return "followup"


class AgentRuntime:
    """One process's agent runtime over the api worker's Store, Clock and World."""

    _cache: dict[tuple[int, int], AgentRuntime] = {}

    def __init__(
        self,
        store: Store,
        clock: Any,
        world: Any,
        cfg: AgentConfig | None = None,
        *,
        world_port: WorldPort | None = None,
        bus: EventBus | None = None,
        enqueue: Callable[..., Job] | None = None,
    ) -> None:
        from torch.agents.executor import Executor
        from torch.agents.tools.adapters import SimWorld, StoreDomain
        from torch.agents.tools.registry import ToolRegistry
        from torch.scheduler.queue import JobQueue

        self.cfg = cfg or AgentConfig()
        self.store = store
        self.clock = clock
        self.world = world
        self.sim = SimWorld(world)
        self.port: WorldPort = world_port or self.sim
        self.dom = StoreDomain(store, self.sim)
        self.tools = ToolRegistry(self.port)
        self.runs = RunStore(store, clock)
        self.bus = bus or EventBus(store, clock)
        self.queue = JobQueue(store, clock, owner="agents")
        self._enqueue = enqueue or self.queue.enqueue
        self.limits = AdvanceLimits.from_config(self.cfg)
        #: live mode: the model client LivePlanner uses (HTTP or cassette transport); set by the integration
        self.llm_client: Any = None
        self.executor = Executor(self)

    # ── construction ──
    @classmethod
    def shared(cls, store: Store, clock: Any, world: Any, cfg: AgentConfig | None = None) -> AgentRuntime:
        """The process-wide runtime for a store and world (a reseed swaps the world). Job handlers and the
        HTTP hooks share it, so SSE subscribers see the executor's events without polling."""
        key = (id(store), id(world))
        rt = cls._cache.get(key)
        if rt is None or rt.store is not store or (cfg is not None and rt.cfg is not cfg):
            rt = cls(store, clock, world, cfg or AgentConfig.from_env())
            cls._cache = {k: v for k, v in cls._cache.items() if k[0] != key[0]}
            cls._cache[key] = rt
        return rt

    @classmethod
    def for_job(cls, ctx: Any, cfg: AgentConfig | None = None) -> AgentRuntime:
        """The shared runtime for a scheduler JobContext."""
        return cls.shared(ctx.store, ctx.clock, ctx.world, cfg)

    @classmethod
    def from_runtime(cls, rt: Any, cfg: AgentConfig | None = None, **kw: Any) -> AgentRuntime:
        return cls(rt.store, rt.clock, rt.world, cfg, enqueue=kw.pop("enqueue", rt.scheduler.enqueue), **kw)

    def enqueue(self, kind: str, due_at: datetime, payload: dict[str, Any], key: str, **kw: Any) -> Job:
        return self._enqueue(kind, due_at, payload, key, **kw)

    # ── practice ──
    def practice(self) -> Practice:
        return self.store.all(Practice)[0]

    def paused(self) -> bool:
        practices = self.store.all(Practice)
        return bool(practices and practices[0].agents_paused)

    # ── runs ──
    async def start_run(self, run_id: str, *, advance_id: str | None = None) -> Any:
        """Execute (or resume) a Run the API or a trigger created. Idempotent: a finished run is returned."""
        return await self.executor.run(run_id, advance_id=advance_id)

    def create_triage_run(
        self,
        claim_id: str,
        *,
        agent: AgentKind | None = None,
        parent_run_id: str | None = None,
        trigger: str = "rule",
        key: str | None = None,
        actor: str | None = None,
    ) -> Run:
        claim = self.store.require(Claim, claim_id)
        kind = agent or default_agent_for(claim)
        idem = key or f"triage:{claim_id}:{kind}:{self.clock.now().isoformat()}"
        existing = self.runs.by_key(idem)
        if existing is not None:
            return existing
        return self.runs.create(
            Run(
                id=run_id_for(idem),
                agent=DomainAgentKind(kind),
                trigger=RunTrigger(trigger),
                actor=actor,
                claim_id=claim.id,
                patient_id=claim.patient_id,
                parent_run_id=parent_run_id,
                idempotency_key=idem,
                status=RunStatus.QUEUED,
                started_at=self.clock.now(),
            )
        )

    async def triage(
        self,
        claim_id: str,
        parent_run_id: str | None = None,
        *,
        agent: AgentKind | None = None,
        key: str | None = None,
        advance_id: str | None = None,
        trigger: str = "rule",
    ) -> Any:
        """Agent-started triage of one claim. Skipped (None) while another run on the claim is active."""
        run = self.runs.by_key(key) if key else None
        if run is None:
            active = [r for r in self.runs.list(claim_id=claim_id) if r.status in ACTIVE_RUN_STATUSES]
            if active:
                return None
            run = self.create_triage_run(claim_id, agent=agent, parent_run_id=parent_run_id, key=key, trigger=trigger)
        return await self.start_run(run.id, advance_id=advance_id)

    # ── pause / resume / recover ──
    def pause(self, by: str) -> dict[str, Any]:
        """Kill switch: queued agent jobs are parked (never re-polled); running runs stop at the next step
        boundary with status `paused`; the world keeps running."""
        from torch.scheduler.kinds import AGENT_KINDS

        with self.store.tx():
            p = self.practice()
            p.agents_paused, p.agents_paused_by, p.agents_paused_at = True, by, self.clock.now()
            self.store.update(p)
            self.queue.park_kinds(set(AGENT_KINDS))
        self.bus.publish(FIREHOSE, "agents", {"paused": True, "by": by, "at": self.clock.now().isoformat()})
        return self.status()

    def resume(self, by: str) -> dict[str, Any]:
        """Re-queue parked jobs; paused runs get a resume job and continue from their last ok step."""
        with self.store.tx():
            p = self.practice()
            p.agents_paused, p.agents_paused_by, p.agents_paused_at = False, None, None
            self.store.update(p)
            self.queue.unpark()
            for run in self.runs.list(status=RunStatus.PAUSED.value):
                self.ensure_resume_job(run.id)
        self.bus.publish(FIREHOSE, "agents", {"paused": False, "by": by, "at": self.clock.now().isoformat()})
        return self.status()

    def ensure_resume_job(self, run_id: str, exclude_job_id: str | None = None) -> Job:
        """A queued (or, while paused, parked) `run.start` for a run that must continue. Idempotent per run
        state: an existing queued/parked/leased run.start for the run is reused."""
        from torch.scheduler.kinds import RUN_START

        live = [
            j
            for j in self.store.find(Job, {"kind": RUN_START, "state": [JobState.QUEUED, JobState.PARKED, JobState.LEASED]})
            if j.payload.get("run_id") == run_id and j.id != exclude_job_id
        ]
        if live:
            return live[0]
        n = sum(1 for j in self.store.find(Job, {"kind": RUN_START}) if j.payload.get("run_id") == run_id)
        job = self.enqueue(RUN_START, self.clock.now(), {"run_id": run_id, "resume": True}, f"run.start:{run_id}:resume:{n}")
        if self.paused() and job.state is JobState.QUEUED:
            job.state = JobState.PARKED
            self.store.update(job)
        return job

    def recover(self) -> int:
        """After a restart: expired/foreign leases go back to queued (their run.start resumes from the
        checkpoint), and a `running` run with a checkpoint but no live job gets one. Seeded runs (no
        checkpoint) are history, not work. Returns how many runs will resume."""
        self.queue.recover()
        n = 0
        for run in self.runs.list(status=RunStatus.RUNNING.value):
            if self.store.get(RunCheckpoint, run.id) is None:
                continue
            self.ensure_resume_job(run.id)
            n += 1
        return n

    def status(self) -> dict[str, Any]:
        p = self.practice()
        active = [r for r in self.store.find(Run, {"status": [s.value for s in ACTIVE_RUN_STATUSES]})]
        return {
            "paused": p.agents_paused,
            "paused_by": p.agents_paused_by,
            "paused_at": p.agents_paused_at.isoformat() if p.agents_paused_at else None,
            "mode": "live" if self.cfg.agent_mode == "live" else "deterministic",
            "live_agents": sorted(self.cfg.live_agents) if self.cfg.agent_mode == "live" else [],
            "running": sum(1 for r in active if r.status is RunStatus.RUNNING),
            "queued": sum(1 for r in active if r.status is RunStatus.QUEUED),
            "paused_runs": sum(1 for r in active if r.status is RunStatus.PAUSED),
            "parked_jobs": self.store.count(Job, {"state": JobState.PARKED}),
        }

    def reschedule_after_outage(self, run: Run) -> Job | None:
        """07 §9: a triage run that failed on an outage is retried as a *new* triage run +2 h sim. Approval
        runs never re-run automatically (a retry is a new approval)."""
        from torch.scheduler.kinds import TRIAGE

        if run.trigger is RunTrigger.APPROVAL or not run.claim_id:
            return None
        due = self.clock.now() + timedelta(minutes=self.cfg.outage_reschedule_minutes)
        return self.enqueue(
            TRIAGE,
            due,
            {"claim_id": run.claim_id, "agent": run.agent.value, "parent_run_id": run.id},
            f"triage:{run.claim_id}:retry:{run.id}",
        )


def is_unknown_situation(key: str | None) -> bool:
    return (key or UNKNOWN) == UNKNOWN
