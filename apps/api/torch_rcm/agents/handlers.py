"""Scheduler job handlers for the agent runtime (07 §8).

Principle: the model proposes; code gates and executes. Handlers only start runs; the executor decides
nothing either — policy does. Delivery is at-least-once, so every handler is idempotent: `run.start` on a
finished run returns it unchanged, triage runs are keyed by their trigger, and recipe steps carry idempotency
keys the world honours.

    from torch_rcm.agents.handlers import register
    register(registry)          # torch_rcm.scheduler.registry.registry (the API's) or a test registry

Kinds: `run.start {run_id}` (approval / manual triage runs the API created), `triage {claim_id, agent?,
parent_run_id?}` (agent-started), and `era.arrived {remittance_id}` → one overnight `triage` job per denied
claim on the 835 (only when no other package registered `era.arrived`; posting runs are not part of slice A).
"""

from __future__ import annotations

from typing import Any

from torch_rcm.agents.config import AgentConfig
from torch_rcm.agents.runtime import AgentRuntime
from torch_rcm.domain.entities import Claim, InboxItem, Remittance, Run
from torch_rcm.domain.enums import ClaimStatus, InboxItemState, RunTrigger
from torch_rcm.domain.enums import PayerKey as DomainPayerKey
from torch_rcm.domain.enums import RootCause as DomainRootCause
from torch_rcm.domain.routing import route_denial
from torch_rcm.scheduler import kinds as K
from torch_rcm.scheduler.registry import JobContext, JobOutcome, Registry, registry

__all__ = ["era_arrived", "register", "run_start", "status_check_due", "triage"]

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
    out.add(
        "run_finished",
        f"{run.agent.value} · {run.outcome or run.status.value}",
        run_id=run.id,
        status=run.status.value,
        claim_id=run.claim_id,
    )
    if res.failure == "world_unavailable":
        job = rt.reschedule_after_outage(run)
        if job is not None:
            out.add(
                "run_rescheduled",
                f"retrying {run.claim_id} at {job.due_at:%H:%M}",
                run_id=run.id,
                due_at=job.due_at.isoformat(),
            )
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
        agent = owner_agent(claim)
        if agent is None:
            continue  # patient-responsibility / write-off lines close in Payments, not in a triage run
        ctx.enqueue(
            K.TRIAGE,
            ctx.now,
            {"claim_id": claim.id, "agent": agent, "remittance_id": remit.id, "trigger": "rule"},
            f"triage:{claim.id}:era:{remit.id}",
        )
        summary = f"{agent.capitalize()} will look at #{claim.number} ({claim.denial.carc})"
        out.add("triage_enqueued", summary, claim_id=claim.id)
    return out


def status_check_due(ctx: JobContext) -> JobOutcome:
    """Day-30/45/… status check on a pending claim → a Follow-up triage run (trigger `schedule`). Claims that
    moved on (adjudicated, denied — the 835 path owns those) or that already wait on a person are skipped."""
    out = JobOutcome()
    claim = ctx.store.get(Claim, str(ctx.job.payload["claim_id"]))
    if claim is None or claim.status is not ClaimStatus.PENDING:
        return out
    if ctx.store.find(InboxItem, {"claim_id": claim.id, "state": InboxItemState.OPEN}):
        return out
    ctx.enqueue(
        K.TRIAGE,
        ctx.now,
        {"claim_id": claim.id, "agent": "followup", "trigger": RunTrigger.SCHEDULE.value},
        f"triage:{claim.id}:{ctx.job.idempotency_key}",
    )
    out.add("triage_enqueued", f"Follow-up status check on #{claim.number}", claim_id=claim.id)
    return out


def owner_agent(claim: Claim) -> str | None:
    """The agent that owns a denial — the same router the Denials worklist uses (torch_rcm.domain.routing), so an
    overnight CO-50 goes to Appeals, not to a Follow-up run that cannot classify it."""
    assert claim.denial is not None
    d = claim.denial
    route = route_denial(
        d.carc, d.rarc, root_cause=DomainRootCause.UNKNOWN, payer=DomainPayerKey(claim.payer_key), self_funded=False
    )
    return route.agent.value if route.agent.value in ("followup", "appeals", "claims") else None


def register(reg: Registry = registry, cfg: AgentConfig | None = None, *, replace: bool = False) -> list[str]:
    """Register the agent handlers; returns the kinds registered. `era.arrived` is skipped when another
    package already handles it (unless `replace`)."""
    if cfg is not None:
        _CONFIG[0] = cfg
    done: list[str] = []
    for kind, fn in HANDLERS:
        if reg.get(kind) is not None and not replace:
            if reg.get(kind) in tuple(f for _, f in HANDLERS):
                done.append(kind)
            continue
        reg.register(kind, fn, replace=replace)
        done.append(kind)
    return done


HANDLERS = (
    (K.RUN_START, run_start),
    (K.TRIAGE, triage),
    (K.ERA_ARRIVED, era_arrived),
    (K.STATUS_CHECK_DUE, status_check_due),
)
