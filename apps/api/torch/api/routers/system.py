from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from torch.api.deps import CtxDep
from torch.api.schemas import (
    AdvanceAccepted,
    AdvanceIn,
    AdvanceOut,
    AgentsStatus,
    ClockOut,
    InjectIn,
    InjectOut,
    ReseedIn,
    ReseedOut,
    RunDetail,
    RunList,
    WorldPayer,
)
from torch.api.services import system as svc
from torch.domain.entities import Run
from torch.domain.enums import RunStatus
from torch.events import FIREHOSE, replay

router = APIRouter()
TERMINAL = {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED, RunStatus.WOULD_HAVE_RUN}
POLL_SECONDS = 0.3


# ── clock ──────────────────────────────────────────────────────────────────────────────────────────────────


@router.get("/clock", response_model=ClockOut, tags=["clock"])
def get_clock(ctx: CtxDep) -> ClockOut:
    return svc.clock(ctx)


@router.post(
    "/clock/advance",
    status_code=202,
    tags=["clock"],
    responses={202: {"model": AdvanceAccepted}, 200: {"model": AdvanceOut}},
)
async def advance(ctx: CtxDep, body: AdvanceIn, wait: bool = False) -> Any:
    """Async (ADR-0001): 202 + advance id; progress on `/runs/stream` (`event: advance`) and
    `GET /clock/advance/{id}`. `?wait=true` awaits it and returns the final snapshot (CLI, tests, e2e)."""
    if wait:
        out = await svc.run_advance_inline(ctx, body.minutes, body.to)
        return JSONResponse(out.model_dump(mode="json", by_alias=True), status_code=200)
    accepted = svc.start_advance(ctx, body.minutes, body.to)
    return JSONResponse(accepted.model_dump(mode="json", by_alias=True), status_code=202)


@router.get("/clock/advance/{advance_id}", response_model=AdvanceOut, tags=["clock"])
def get_advance(ctx: CtxDep, advance_id: str) -> AdvanceOut:
    return svc.get_advance(ctx, advance_id)


@router.post("/clock/reset", response_model=ReseedOut, tags=["clock"])
def reset_clock(ctx: CtxDep) -> ReseedOut:
    return svc.reseed(ctx, None)


# ── runs ───────────────────────────────────────────────────────────────────────────────────────────────────


@router.get("/runs", response_model=RunList, tags=["runs"])
def list_runs(
    ctx: CtxDep,
    agent: str | None = None,
    status: str | None = None,
    since: datetime | None = None,
    claim_id: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
) -> RunList:
    return svc.list_runs(ctx, agent, status, since, claim_id, limit)


@router.get("/runs/stream", tags=["runs"])
async def runs_stream(
    request: Request, last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None
) -> EventSourceResponse:
    """SSE firehose: run status changes, `advance` progress and `agents` pause/resume. Replays from the
    persisted log after Last-Event-ID. (torch.agents publishes run events into the same log.)"""
    store = request.app.state.runtime.store

    async def events() -> AsyncIterator[dict[str, Any]]:
        seq = int(last_event_id or 0)
        while not await request.is_disconnected():
            for ev in replay(store, FIREHOSE, seq):
                seq = ev.seq
                yield {"id": str(ev.seq), "event": ev.event, "data": _json(ev.data)}
            await asyncio.sleep(POLL_SECONDS)

    return EventSourceResponse(events())


@router.get("/runs/{run_id}", response_model=RunDetail, tags=["runs"])
def get_run(ctx: CtxDep, run_id: str) -> RunDetail:
    return svc.get_run(ctx, run_id)


@router.get("/runs/{run_id}/events", tags=["runs"])
async def run_events(
    request: Request, run_id: str, last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None
) -> EventSourceResponse:
    """SSE for one run: replays the persisted `run_events` after Last-Event-ID, then follows new ones until the
    run ends. Runs seeded without an event log replay their stored steps (`phase: completed`)."""
    store = request.app.state.runtime.store

    async def events() -> AsyncIterator[dict[str, Any]]:
        seq = int(last_event_id or 0)
        run = store.get(Run, run_id)
        if run is None:
            yield {
                "event": "error",
                "data": _json({"code": "not_found", "message": f"run {run_id} not found"}),
            }
            return
        if seq == 0 and not replay(store, run_id, 0, limit=1):
            for step in run.steps:
                yield {
                    "id": f"s{step.idx}",
                    "event": "step",
                    "data": _json(
                        {
                            "idx": step.idx,
                            "name": step.name,
                            "phase": "completed" if step.status.value == "ok" else step.status.value,
                            "status": step.status.value,
                            "output_summary": step.output_summary,
                        }
                    ),
                }
        while not await request.is_disconnected():
            for ev in replay(store, run_id, seq):
                seq = ev.seq
                yield {"id": str(ev.seq), "event": ev.event, "data": _json(ev.data)}
            current = store.get(Run, run_id)
            if current is None or current.status in TERMINAL:
                yield {
                    "event": "status",
                    "data": _json({"status": current.status.value if current else "missing"}),
                }
                yield {"event": "done", "data": _json({"run_id": run_id})}
                return
            await asyncio.sleep(POLL_SECONDS)

    return EventSourceResponse(events())


@router.post("/runs/{run_id}:cancel", response_model=Run, tags=["runs"])
def cancel_run(ctx: CtxDep, run_id: str) -> Run:
    return svc.cancel_run(ctx, run_id)


# ── agents ─────────────────────────────────────────────────────────────────────────────────────────────────


@router.get("/agents/status", response_model=AgentsStatus, tags=["agents"])
def agents_status(ctx: CtxDep) -> AgentsStatus:
    return svc.agents_status(ctx)


@router.post("/agents:pause", response_model=AgentsStatus, tags=["agents"])
def pause(ctx: CtxDep) -> AgentsStatus:
    return svc.set_paused(ctx, True)


@router.post("/agents:resume", response_model=AgentsStatus, tags=["agents"])
def resume(ctx: CtxDep) -> AgentsStatus:
    return svc.set_paused(ctx, False)


# ── _world (demo admin) ────────────────────────────────────────────────────────────────────────────────────


@router.post("/_world/reseed", response_model=ReseedOut, tags=["_world"])
def world_reseed(ctx: CtxDep, body: ReseedIn | None = None) -> ReseedOut:
    return svc.reseed(ctx, body.scenario if body else None)


@router.get("/_world/payers", response_model=list[WorldPayer], tags=["_world"])
def world_payers(ctx: CtxDep) -> list[WorldPayer]:
    return svc.world_payers(ctx)


@router.post("/_world/inject", response_model=InjectOut, tags=["_world"])
def world_inject(ctx: CtxDep, body: InjectIn) -> InjectOut:
    return svc.inject(ctx, body)


def _json(data: dict[str, Any]) -> str:
    import json

    return json.dumps(data, default=str)
