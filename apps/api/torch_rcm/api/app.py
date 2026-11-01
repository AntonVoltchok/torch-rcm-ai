"""FastAPI app factory: `torch_rcm.api.app:app` (uvicorn) and `create_app()` (tests).

Lifespan: open the Runtime, seed if the DB is empty, recover stale job leases, start the background worker
(it takes jobs due at the current frozen instant — approval and triage runs). OpenAPI at /api/openapi.json.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import cache
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from torch_rcm.api.errors import ApiError
from torch_rcm.api.routers import claims, inbox, screens, system
from torch_rcm.api.routers import settings as settings_routes
from torch_rcm.config import Settings, get_settings
from torch_rcm.log import configure, get_logger
from torch_rcm.runtime import Runtime

API_PREFIX = "/api/v1"
log = get_logger(__name__)


def _ensure_seeded(runtime: Runtime) -> None:
    if not runtime.is_seeded():
        from torch_rcm.seed.persist import persist
        from torch_rcm.world.scenarios import build_scenario

        persist(runtime.store, build_scenario(runtime.settings.scenario))
        runtime.reload_world()


def _load_agents(settings: Settings) -> bool:
    """Import torch_rcm.agents and register its job handlers (run.start, triage, era.arrived).

    An import failure is logged and re-raised: an API without agents boots "fine" and the demo is inert, so it
    refuses to start unless TORCH_ALLOW_WORLD_ONLY=1 asks for a world-only API explicitly.
    """
    try:
        import torch_rcm.agents  # noqa: F401
        from torch_rcm.agents.handlers import register
        from torch_rcm.scheduler.registry import registry
    except ImportError as exc:
        log.error("agents.import_failed", error=repr(exc), allow_world_only=settings.allow_world_only)
        if not settings.allow_world_only:
            raise
        return False
    register(registry)
    return True


def _wire_agent_runtime(rt: Runtime) -> None:
    """Attach the shared AgentRuntime: model client per TORCH_AGENT_MODE, then resume checkpointed runs."""
    from torch_rcm.agents.config import AgentConfig
    from torch_rcm.agents.runtime import AgentRuntime

    cfg = AgentConfig()
    agent_rt = AgentRuntime.shared(rt.store, rt.clock, rt.world, cfg)
    if cfg.agent_mode == "live":
        from torch_rcm.agents.llm.cassette import CANONICAL_DIR, CassetteClient, RecordingClient
        from torch_rcm.agents.llm.client import LlmClient

        def sink(rec: Any) -> None:
            rt.store.insert(rec.to_entity())

        client: Any
        if cfg.cassette_mode == "replay":
            client = CassetteClient(CANONICAL_DIR / "canonical", sink=sink, clock=rt.clock.now)
        else:
            client = LlmClient(cfg, sink=sink, clock=rt.clock.now)
            if cfg.cassette_mode == "record":
                client = RecordingClient(client, CANONICAL_DIR / "live", recorded_at=rt.clock.now().isoformat())
        agent_rt.llm_client = client
    resumed = agent_rt.recover()
    log.info("agents.wired", mode=rt.settings.agent_mode, resumed_runs=resumed)


def create_app(
    settings: Settings | None = None, runtime: Runtime | None = None, *, start_worker: bool | None = None
) -> FastAPI:
    settings = settings or get_settings()
    configure(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        rt = runtime or Runtime.open(settings)
        _ensure_seeded(rt)
        app.state.runtime = rt
        agents = _load_agents(settings)
        rt.scheduler.queue.recover()
        if agents:
            _wire_agent_runtime(rt)
        stop = asyncio.Event()
        worker = None
        if start_worker if start_worker is not None else settings.worker:
            worker = asyncio.create_task(rt.scheduler.worker_loop(stop))
        log.info("api.started", agents_loaded=agents, now=rt.clock.now().isoformat())
        try:
            yield
        finally:
            stop.set()
            if worker is not None:
                await worker

    app = FastAPI(
        title="Torch API",
        version="0.1.0",
        description=(
            "Agentic dental RCM demo: inbox, claims, rules, runs and the simulated world. "
            "Money is integer cents; times are ISO-8601 with offset (sim clock)."
        ),
        openapi_url="/api/openapi.json",
        docs_url="/api/docs",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Last-Event-ID"],
    )

    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(exc.body(), status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {
                "error": {
                    "code": "invalid_request",
                    "message": "request did not validate",
                    "details": {"errors": exc.errors()},
                }
            },
            status_code=422,
        )

    for router in (inbox.router, claims.router, settings_routes.router, screens.router, system.router):
        app.include_router(router, prefix=API_PREFIX)
    return app


@cache
def _default_app() -> FastAPI:
    return create_app()


def __getattr__(name: str) -> FastAPI:
    """Lazy `app` (PEP 562): importing this module for OpenAPI or tests never opens the database."""
    if name == "app":
        return _default_app()
    raise AttributeError(name)
