from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Query

from torch_rcm.api.deps import CtxDep, IdempotencyKey
from torch_rcm.api.schemas import (
    ApproveIn,
    ApproveOut,
    GroupApproveIn,
    GroupApproveOut,
    InboxItemDetail,
    InboxList,
    ItemOut,
    ProposalOut,
    RejectIn,
    SnoozeIn,
)
from torch_rcm.api.services import inbox as svc

router = APIRouter(tags=["inbox"])


@router.get("/inbox", response_model=InboxList)
def list_inbox(
    ctx: CtxDep,
    state: Literal["open", "snoozed", "done"] = "open",
    kind: str | None = None,
    agent: str | None = None,
    group: bool = False,
    location_id: str | None = Query(default=None),
) -> InboxList:
    return svc.get_inbox(ctx, state, kind, agent, group)


@router.get("/inbox/{item_id}", response_model=InboxItemDetail)
def get_item(ctx: CtxDep, item_id: str) -> InboxItemDetail:
    return svc.get_item(ctx, item_id)


@router.post("/inbox/{item_id}:approve", response_model=ApproveOut, status_code=202)
def approve(
    ctx: CtxDep, item_id: str, body: ApproveIn | None = None, idempotency_key: IdempotencyKey = None
) -> ApproveOut:
    return svc.approve(ctx, item_id, body.edits if body else None, idempotency_key=idempotency_key)


@router.post("/inbox:approve-group", response_model=GroupApproveOut, status_code=202)
def approve_group(ctx: CtxDep, body: GroupApproveIn, idempotency_key: IdempotencyKey = None) -> GroupApproveOut:
    return svc.approve_group(ctx, body.group_key, idempotency_key=idempotency_key)


@router.post("/inbox/{item_id}:reject", response_model=ItemOut)
def reject(ctx: CtxDep, item_id: str, body: RejectIn, idempotency_key: IdempotencyKey = None) -> ItemOut:
    return svc.reject(ctx, item_id, body.reason, idempotency_key=idempotency_key)


@router.post("/inbox/{item_id}:snooze", response_model=ItemOut)
def snooze(ctx: CtxDep, item_id: str, body: SnoozeIn, idempotency_key: IdempotencyKey = None) -> ItemOut:
    return svc.snooze(ctx, item_id, body.until, idempotency_key=idempotency_key)


@router.post("/inbox/{item_id}:reopen", response_model=ItemOut)
def reopen(ctx: CtxDep, item_id: str) -> ItemOut:
    return svc.reopen(ctx, item_id)


@router.post("/inbox/{item_id}:always-auto-run", response_model=ProposalOut, status_code=201)
def always_auto_run(ctx: CtxDep, item_id: str) -> ProposalOut:
    return svc.always_auto_run(ctx, item_id)
