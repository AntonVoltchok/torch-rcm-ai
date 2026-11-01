"""Scheduler job handlers for the agent runtime (07 §8).

Principle: the model proposes; code gates and executes. Handlers only start runs; the executor decides
nothing either — policy does. Delivery is at-least-once, so every handler is idempotent: `run.start` on a
finished run returns it unchanged, triage runs are keyed by their trigger, and recipe steps carry idempotency
keys the world honours.

    from torch.agents.handlers import register
    register(registry)          # torch.scheduler.registry.registry (the API's) or a test registry

Kinds: `run.start {run_id}` (approval / manual triage runs the API created), `triage {claim_id, agent?,
parent_run_id?}` (agent-started), and `era.arrived {remittance_id}` → one overnight `triage` job per denied
claim on the 835 (only when no other package registered `era.arrived`; posting runs are not part of slice A).
"""

from __future__ import annotations

from typing import Any

from torch.agents.config import AgentConfig
from torch.agents.runtime import AgentRuntime
from torch.domain.entities import Claim, Remittance, Run
from torch.domain.enums import RunTrigger
from torch.scheduler import kinds as K
from torch.scheduler.registry import JobContext, JobOutcome, Registry, registry

__all__ = ["era_arrived", "register", "run_start", "triage"]

_CONFIG: list[AgentConfig | None] = [None]  # set by register(cfg=…); default AgentConfig.from_env()


def _rt(ctx: JobContext) -> AgentRuntime:
    rt = AgentRuntime.for_job(ctx, _CONFIG[0])
    rt._enqueue = ctx.enqueue_fn  # follow-ups are stamped with the current advance
    return rt


def _outcome(rt: AgentRuntime, res: Any, ctx: JobContext) -> JobOutcome:
    out = JobOutcome()
    if res is None:
        return out
    run: Run = res.run
    if res.paused:
        rt.ensure_resume_job(run.id, exclude_job_id=ctx.job.id)
        out.add("run_paused", f"{run.agent.value} run {run.id} paused", run_id=run.id)
        return out
    if res.replayed:
        return out
    out.runs_started = 1
    out.live_runs = 1 if res.live else 0
    out.add("run_finished", f"{run.agent.value} · {run.outcome or run.status.value}", run_id=run.id, status=run.status.value, claim_id=run.claim_id)
    if res.failure == "world_unavailable":
        job = rt.reschedule_after_outage(run)
        if job is not None:
            out.add("run_rescheduled", f"retrying {run.claim_id} at {job.due_at:%H:%M}", run_id=run.id, due_at=job.due_at.isoformat())
    return out


async def run_start(ctx: JobContext) -> JobOutcome:
    rt = _rt(ctx)
    run_id = str(ctx.job.payload["run_id"])
    if rt.runs.get(run_id) is None:
        return JobOutcome()  # the run was reseeded away; nothing to do
    res = await rt.start_run(run_id, advance_id=ctx.advance_id)
    return _outcome(rt, res, ctx)


async def triage(ctx: JobContext) -> JobOutcome:
    rt = _rt(ctx)
    p = ctx.job.payload
    claim_id = str(p["claim_id"])
    if rt.store.get(Claim, claim_id) is None:
        return JobOutcome()
    res = await rt.triage(
        claim_id,
        p.get("parent_run_id"),
        agent=p.get("agent"),
        key=f"triage:{claim_id}:{ctx.job.idempotency_key}",
        advance_id=ctx.advance_id,
        trigger=str(p.get("trigger") or RunTrigger.RULE.value),
    )
    return _outcome(rt, res, ctx)


def era_arrived(ctx: JobContext) -> JobOutcome:
    """An 835 landed: every denied claim on it gets an overnight Follow-up triage job (due now, so the
    advance drains it before the next world event)."""
    out = JobOutcome()
    remit = ctx.store.get(Remittance, str(ctx.job.payload["remittance_id"]))
    if remit is None:
        return out
    claim_ids = sorted({line.claim_id for line in remit.lines if line.claim_id})
    for claim in ctx.store.get_many(Claim, claim_ids).values():
        if claim.denial is None:
            continue
        ctx.enqueue(
            K.TRIAGE,
            ctx.now,
            {"claim_id": claim.id, "agent": "followup", "remittance_id": remit.id, "trigger": "rule"},
            f"triage:{claim.id}:era:{remit.id}",
        )
        out.add("triage_enqueued", f"Follow-up will look at #{claim.number} ({claim.denial.carc})", claim_id=claim.id)
    return out


def register(reg: Registry = registry, cfg: AgentConfig | None = None, *, replace: bool = False) -> list[str]:
    """Register the agent handlers; returns the kinds registered. `era.arrived` is skipped when another
    package already handles it (unless `replace`)."""
    if cfg is not None:
        _CONFIG[0] = cfg
    done: list[str] = []
    for kind, fn in ((K.RUN_START, run_start), (K.TRIAGE, triage), (K.ERA_ARRIVED, era_arrived)):
        if reg.get(kind) is not None and not replace:
            if reg.get(kind) in (run_start, triage, era_arrived):
                done.append(kind)
            continue
        reg.register(kind, fn, replace=replace)
        done.append(kind)
    return done
