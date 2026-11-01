"""FastAPI dependencies: the process Runtime and the per-request Ctx (acting user from `X-Torch-User`)."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, Request

from torch.api.services.context import Ctx
from torch.runtime import Runtime


def get_runtime(request: Request) -> Runtime:
    runtime: Runtime = request.app.state.runtime
    return runtime


def get_ctx(
    runtime: Annotated[Runtime, Depends(get_runtime)],
    x_torch_user: Annotated[str | None, Header(description="Demo auth: the acting user id, e.g. usr_dana")] = None,
) -> Ctx:
    return Ctx.for_user(runtime, x_torch_user)


CtxDep = Annotated[Ctx, Depends(get_ctx)]
