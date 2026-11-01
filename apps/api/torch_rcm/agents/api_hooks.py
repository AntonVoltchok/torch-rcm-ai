"""HTTP + SSE hooks for the agent runtime (02-api "Runs (agents)", "Agents (runtime control)").

Principle: the model proposes; code gates and executes. These routes only observe runs and flip the
practice kill switch; starting a triage run creates a queued Run and a `run.start` job, nothing more.

`include_agents(app)` adds, under `/api/v1`, every route below that the app does not already serve (the api
worker's routers already ship store-polling versions of most of them; the existing route wins, and both read
the same persisted `run_events` log, so behaviour is identical):

- `GET  /runs/{id}/events`  SSE, honours `Last-Event-ID`
- `GET  /runs/stream`       firehose: run status, `advance`, `agents`
- `GET  /agents/status`
- `POST /agents:pause` · `POST /agents:resume`   owner only (`X-Torch-User`)
- `POST /claims/{id}:triage`

FastAPI and sse_starlette are imported lazily, so this module imports without them.
"""

# No `from __future__ import annotations`: FastAPI must see the route annotations (built from names imported
# inside `include_agents`) as objects, not strings it would resolve against this module's globals.
import json
from typing import Any

from torch_rcm.events import FIREHOSE

API_PREFIX = "/api/v1"

__all__ = ["agent_runtime", "include_agents"]


def agent_runtime(request: Any) -> Any:
    from torch_rcm.agents.runtime import AgentRuntime

    rt = request.app.state.runtime
    return AgentRuntime.shared(rt.store, rt.clock, rt.world)


def _existing(app: Any) -> set[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    for r in getattr(app, "routes", []):
        for m in getattr(r, "methods", None) or ():
            out.add((getattr(r, "path", ""), m))
    return out


def _sse(events: Any) -> Any:
    from sse_starlette.sse import EventSourceResponse

    async def gen() -> Any:
        async for ev in events:
            yield {**ev, "data": json.dumps(ev["data"], default=str)}

    return EventSourceResponse(gen())


def include_agents(app: Any, prefix: str = API_PREFIX) -> list[str]:
    """Add the agent routes the app lacks; returns `"METHOD path"` for each route added."""
    from typing import Annotated

    from fastapi import APIRouter, Header, Request

    from torch_rcm.api.deps import CtxDep
    from torch_rcm.domain.enums import Role

    router = APIRouter(tags=["agents"])
    have = _existing(app)
    added: list[str] = []

    def want(method: str, path: str) -> bool:
        if (prefix + path, method) in have:
            return False
        added.append(f"{method} {prefix}{path}")
        return True

    if want("GET", "/runs/stream"):

        @router.get("/runs/stream")
        async def runs_stream(
            request: Request, last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None
        ) -> Any:
            return _sse(agent_runtime(request).bus.subscribe(FIREHOSE, last_event_id, until_done=False))

    if want("GET", "/runs/{run_id}/events"):

        @router.get("/runs/{run_id}/events")
        async def run_events(
            request: Request, run_id: str, last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None
        ) -> Any:
            return _sse(agent_runtime(request).bus.subscribe(run_id, last_event_id))

    if want("GET", "/agents/status"):

        @router.get("/agents/status")
        def agents_status(request: Request, ctx: CtxDep) -> dict[str, Any]:
            return dict(agent_runtime(request).status())

    def _toggle(request: Request, ctx: Any, paused: bool) -> dict[str, Any]:
        ctx.require_role(Role.OWNER, code="forbidden", message="Only the owner can pause or resume agents.")
        art = agent_runtime(request)
        status = art.pause(ctx.user.id) if paused else art.resume(ctx.user.id)
        ctx.audit(
            "agents.pause" if paused else "agents.resume",
            "practice",
            art.practice().id,
            f"Agents {'paused' if paused else 'resumed'} by {ctx.user.name}",
        )
        return dict(status)

    if want("POST", "/agents:pause"):

        @router.post("/agents:pause")
        def pause(request: Request, ctx: CtxDep) -> dict[str, Any]:
            return _toggle(request, ctx, True)

    if want("POST", "/agents:resume"):

        @router.post("/agents:resume")
        def resume(request: Request, ctx: CtxDep) -> dict[str, Any]:
            return _toggle(request, ctx, False)

    if want("POST", "/claims/{claim_id}:triage"):

        @router.post("/claims/{claim_id}:triage", status_code=202)
        def triage(ctx: CtxDep, claim_id: str, body: dict[str, Any] | None = None) -> Any:
            from torch_rcm.api.services.claims import triage as start_triage

            return start_triage(ctx, claim_id, (body or {}).get("agent"))

    if added:
        app.include_router(router, prefix=prefix)
    return added
