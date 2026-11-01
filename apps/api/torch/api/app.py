"""FastAPI app factory: `torch.api.app:app` (uvicorn) and `create_app()` (tests).

Lifespan: open the Runtime, seed if the DB is empty, recover stale job leases, start the background worker
(it takes jobs due at the current frozen instant — approval and triage runs). OpenAPI at /api/openapi.json.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import cache

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from torch.api.errors import ApiError
from torch.api.routers import claims, inbox, screens, system
from torch.api.routers import settings as settings_routes
from torch.config import Settings, get_settings
from torch.log import configure, get_logger
from torch.runtime import Runtime

API_PREFIX = "/api/v1"
log = get_logger(__name__)


def _ensure_seeded(runtime: Runtime) -> None:
    if not runtime.is_seeded():
        from torch.seed.persist import persist
        from torch.world.scenarios import build_scenario

        persist(runtime.store, build_scenario(runtime.settings.scenario))
        runtime.reload_world()


def _load_agents() -> bool:
    """torch.agents registers its job handlers on import; the API runs without it (world-only)."""
    try:
        import torch.agents  # noqa: F401
    except ImportError:
        return False
    return True


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
        agents = _load_agents()
        rt.scheduler.queue.recover()
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
