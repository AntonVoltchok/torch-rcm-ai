"""Clock, runs (reads + cancel), the agents kill switch, and the `_world` demo admin."""

from __future__ import annotations

from datetime import datetime, timedelta

from torch_rcm.api.errors import ApiError, conflict, not_found, unprocessable
from torch_rcm.api.schemas import (
    AdvanceAccepted,
    AdvanceOut,
    Advancing,
    AgentsStatus,
    ClockOut,
    EventFired,
    InjectIn,
    InjectOut,
    ReseedOut,
    RunDetail,
    RunList,
    WorldPayer,
)
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import Advance, Claim, Evidence, Practice, Run
from torch_rcm.domain.enums import ACTIVE_RUN_STATUSES, AgentKind, InboxItemState, PayerKey, Role, RunStatus
from torch_rcm.events import FIREHOSE, last_seq, publish
from torch_rcm.scheduler import kinds as K
from torch_rcm.scheduler.runner import AdvanceInProgressError
from torch_rcm.world.payers.profiles import PROFILES

DEMO_LIVE_AGENTS = [AgentKind.CLAIMS, AgentKind.FOLLOWUP, AgentKind.APPEALS]


def clock(ctx: Ctx) -> ClockOut:
    running = ctx.rt.scheduler.current_advance()
    return ClockOut(
        now=ctx.now,
        frozen=True,
        advancing=Advancing(advance_id=running.id, to=running.to_at) if running else None,
    )


def advance_target(ctx: Ctx, minutes: int | None, to: datetime | None) -> datetime:
    if (minutes is None) == (to is None):
        raise unprocessable("invalid_advance", "Give exactly one of minutes or to.")
    target = ctx.now + timedelta(minutes=minutes) if minutes is not None else to
    assert target is not None
    if target.tzinfo is None:
        raise unprocessable("invalid_advance", "`to` must carry a UTC offset.")
    if target <= ctx.now:
        raise unprocessable("invalid_advance", "The clock only moves forward.")
    return target


def start_advance(ctx: Ctx, minutes: int | None, to: datetime | None) -> AdvanceAccepted:
    target = advance_target(ctx, minutes, to)
    try:
        advance = ctx.rt.scheduler.start_advance(target, ctx.user.id)
    except AdvanceInProgressError as exc:
        raise conflict("advance_in_progress", str(exc), advance_id=exc.advance_id) from exc
    return AdvanceAccepted(advance_id=advance.id, **{"from": advance.from_at}, to=advance.to_at)


async def run_advance_inline(ctx: Ctx, minutes: int | None, to: datetime | None) -> AdvanceOut:
    """`?wait=true`: the same advance, awaited (CLI, tests, e2e)."""
    target = advance_target(ctx, minutes, to)
    try:
        advance = ctx.rt.scheduler.begin_advance(target, ctx.user.id)
    except AdvanceInProgressError as exc:
        raise conflict("advance_in_progress", str(exc), advance_id=exc.advance_id) from exc
    advance = await ctx.rt.scheduler.execute_advance(advance)
    return advance_out(ctx, advance, with_meta=True)


def get_advance(ctx: Ctx, advance_id: str) -> AdvanceOut:
    advance = ctx.rt.store.get(Advance, advance_id)
    if advance is None:
        raise not_found("advance", advance_id)
    return advance_out(ctx, advance, with_meta=advance.state.value != "running")


def advance_out(ctx: Ctx, advance: Advance, *, with_meta: bool) -> AdvanceOut:
    return AdvanceOut(
        advance_id=advance.id,
        state=advance.state.value,
        **{"from": advance.from_at},
        to=advance.to_at,
        now=advance.now,
        events_fired=[
            EventFired(
                at=datetime.fromisoformat(e["at"]),
                kind=e["kind"],
                summary=e["summary"],
                job_id=e.get("job_id", ""),
                data=e.get("data", {}),
            )
            for e in advance.events_fired
        ],
        runs_started=advance.runs_started,
        live_runs=advance.live_runs,
        skipped_unhandled=advance.skipped_unhandled,
        done=advance.state.value != "running",
        error=advance.error,
        meta=ctx.meta() if with_meta else None,
    )


# ── runs ───────────────────────────────────────────────────────────────────────────────────────────────────


def list_runs(
    ctx: Ctx, agent: str | None, status: str | None, since: datetime | None, claim_id: str | None, limit: int
) -> RunList:
    rows = ctx.rt.store.all(Run)
    if agent:
        rows = [r for r in rows if r.agent.value == agent]
    if status:
        rows = [r for r in rows if r.status.value == status]
    if since:
        rows = [r for r in rows if r.started_at >= since]
    if claim_id:
        rows = [r for r in rows if r.claim_id == claim_id]
    rows.sort(key=lambda r: r.started_at, reverse=True)
    return RunList(items=rows[:limit], total=len(rows))


def get_run(ctx: Ctx, run_id: str) -> RunDetail:
    run = ctx.rt.store.get(Run, run_id)
    if run is None:
        raise not_found("run", run_id)
    ids = sorted({e for s in run.steps for e in s.evidence_ids})
    evidence = list(ctx.rt.store.get_many(Evidence, ids).values())
    return RunDetail(run=run, evidence=evidence, last_event_id=last_seq(ctx.rt.store, run.id))


def cancel_run(ctx: Ctx, run_id: str) -> Run:
    run = ctx.rt.store.get(Run, run_id)
    if run is None:
        raise not_found("run", run_id)
    if run.status is not RunStatus.QUEUED:
        raise conflict("not_cancellable", f"run is {run.status.value}; only queued runs can be cancelled")
    from torch_rcm.domain.entities import InboxItem

    with ctx.rt.store.tx():
        run.status, run.finished_at = RunStatus.CANCELLED, ctx.now
        run.audit_line = f"cancelled by {ctx.user.name} before it started"
        ctx.rt.store.update(run)
        if run.inbox_item_id:
            item = ctx.rt.store.get(InboxItem, run.inbox_item_id)
            if item and item.state in (InboxItemState.APPROVED, InboxItemState.EDITED):
                item.state, item.resolved_by, item.resolved_at = InboxItemState.OPEN, None, None
                ctx.rt.store.update(item)
        ctx.audit("run.cancel", "run", run.id, f"{ctx.user.name} cancelled {run.action_label or run.agent.value}")
    publish(ctx.rt.store, run.id, "status", {"status": "cancelled"}, ctx.now)
    return run


# ── agents kill switch ─────────────────────────────────────────────────────────────────────────────────────


def agents_status(ctx: Ctx) -> AgentsStatus:
    practice = ctx.rt.store.all(Practice)[0]
    runs = ctx.rt.store.find(Run, {"status": [s.value for s in ACTIVE_RUN_STATUSES]})
    mode = ctx.rt.settings.agent_mode
    return AgentsStatus(
        paused=practice.agents_paused,
        paused_by=practice.agents_paused_by,
        paused_at=practice.agents_paused_at,
        mode=mode,
        live_agents=DEMO_LIVE_AGENTS if mode == "live" else [],
        agents=len(AgentKind),
        running=sum(1 for r in runs if r.status is RunStatus.RUNNING),
        queued=sum(1 for r in runs if r.status is RunStatus.QUEUED),
        paused_runs=sum(1 for r in runs if r.status is RunStatus.PAUSED),
    )


def set_paused(ctx: Ctx, paused: bool) -> AgentsStatus:
    ctx.require_role(Role.OWNER, code="forbidden", message="Only the owner can pause or resume agents.")
    practice = ctx.rt.store.all(Practice)[0]
    practice.agents_paused = paused
    practice.agents_paused_by = ctx.user.id if paused else None
    practice.agents_paused_at = ctx.now if paused else None
    with ctx.rt.store.tx():
        ctx.rt.store.update(practice)
        if paused:
            ctx.rt.scheduler.queue.park_kinds(set(K.AGENT_KINDS))
        else:
            ctx.rt.scheduler.queue.unpark()
        ctx.audit(
            "agents.pause" if paused else "agents.resume",
            "practice",
            practice.id,
            f"Agents {'paused' if paused else 'resumed'} by {ctx.user.name}",
        )
    publish(
        ctx.rt.store,
        FIREHOSE,
        "agents",
        {"paused": paused, "by": ctx.user.id, "at": ctx.now.isoformat()},
        ctx.now,
    )
    return agents_status(ctx)


# ── _world ─────────────────────────────────────────────────────────────────────────────────────────────────


def world_payers(ctx: Ctx) -> list[WorldPayer]:
    out = []
    for key, p in PROFILES.items():
        down = ctx.rt.world.outages.window(f"payer:{key.value}:portal", ctx.now) is not None
        out.append(
            WorldPayer(
                key=key,
                name=p.name,
                payer_id=p.payer_id,
                type=p.type.value,
                timely_filing_days=p.timely_filing_days,
                appeal_window_days=p.appeal_window_days,
                era_weekdays=list(p.era_weekdays),
                latency_bd=p.latency_bd,
                rules=list(p.rules),
                portal_down=down,
            )
        )
    return out


def inject(ctx: Ctx, body: InjectIn) -> InjectOut:
    world = ctx.rt.world
    if body.event == "clearinghouse_reject":
        if not body.claim_id or ctx.rt.store.get(Claim, body.claim_id) is None:
            raise unprocessable("invalid_inject", "clearinghouse_reject needs an existing claim_id")
        ctx.rt.scheduler.enqueue(
            K.ACK_CLEARINGHOUSE,
            ctx.now,
            {"claim_id": body.claim_id, "code": body.code or "A7:164"},
            f"inject:ackch:{body.claim_id}:{ctx.now.isoformat()}",
        )
        detail = f"Vyne 277CA {body.code or 'A7:164'} queued for {body.claim_id}"
    elif body.event in ("portal_outage", "portal_restore"):
        payer = body.payer_key or PayerKey.DELTA_NY
        system = f"payer:{payer.value}:portal"
        if body.event == "portal_outage":
            world.outages.inject(system, ctx.now)
            world.outages.inject(f"payer:{payer.value}:ivr", ctx.now)
            detail = f"{PROFILES[payer].short_name} portal and IVR down since {ctx.now:%H:%M}"
        else:
            world.outages.restore(system)
            world.outages.restore(f"payer:{payer.value}:ivr")
            detail = f"{PROFILES[payer].short_name} portal restored"
    else:
        payer = body.payer_key or PayerKey.DELTA_NY
        ctx.rt.scheduler.enqueue(
            K.ERA_ARRIVE,
            ctx.now,
            {"payer": payer.value, "day": ctx.now.date().isoformat()},
            f"inject:era:{payer.value}:{ctx.now.isoformat()}",
        )
        detail = f"{PROFILES[payer].short_name} 835 queued now"
    ctx.audit("world.inject", "world", body.event, detail)
    return InjectOut(ok=True, detail=detail, meta=ctx.meta())


def reseed(ctx: Ctx, scenario: str | None) -> ReseedOut:
    from torch_rcm.world.scenarios import SCENARIOS, build_scenario

    name = scenario or ctx.rt.settings.scenario
    if name not in SCENARIOS:
        raise ApiError(422, "unknown_scenario", f"scenario {name!r} not in {sorted(SCENARIOS)}")
    if ctx.rt.scheduler.advance_lock.locked():
        raise conflict("advance_in_progress", "wait for the advance to finish")
    from torch_rcm.seed.persist import persist

    persist(ctx.rt.store, build_scenario(name))
    ctx.rt.reload_world()
    return ReseedOut(scenario=name, now=ctx.rt.clock.now(), meta=ctx.meta())
