from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from torch.api.deps import CtxDep
from torch.api.schemas import (
    ClaimDetail,
    ClaimList,
    ClaimMutationOut,
    CorrectedIn,
    LedgerToday,
    Strip,
    TimelinePage,
    TriageIn,
    TriageOut,
    ViewIn,
    ViewList,
    VoidIn,
)
from torch.api.services import claims as svc
from torch.api.services import screens
from torch.domain.entities import SavedView
from torch.domain.enums import ClaimStatus
from torch.readmodels.claims import ClaimQuery

router = APIRouter(tags=["claims"])


@router.get("/claims", response_model=ClaimList)
def list_claims(
    ctx: CtxDep,
    status: Annotated[list[ClaimStatus] | None, Query(alias="status[]")] = None,
    status_plain: Annotated[list[ClaimStatus] | None, Query(alias="status")] = None,
    needs_action: bool | None = None,
    payer: str | None = None,
    provider: str | None = None,
    age_bucket: Annotated[str | None, Query(pattern="^(0_30|31_60|61_90|90_plus)$")] = None,
    q: str | None = None,
    sort: str = "-age",
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    location_id: str | None = None,
) -> ClaimList:
    statuses = tuple(status or status_plain or ())
    query = ClaimQuery(
        status=statuses,
        needs_action=needs_action,
        payer=payer,
        provider=provider,
        age_bucket=age_bucket,
        q=q,
        sort=sort,
        cursor=cursor,
        limit=limit,
        location_id=location_id,
    )
    return svc.list_claims(ctx, query)


@router.get("/claims/{claim_id}", response_model=ClaimDetail)
def claim_detail(ctx: CtxDep, claim_id: str) -> ClaimDetail:
    return svc.claim_detail(ctx, claim_id)


@router.get("/claims/{claim_id}/timeline", response_model=TimelinePage)
def claim_timeline(ctx: CtxDep, claim_id: str, cursor: str | None = None) -> TimelinePage:
    return svc.claim_timeline(ctx, claim_id, cursor)


@router.post("/claims/{claim_id}:void", response_model=ClaimMutationOut)
def void(ctx: CtxDep, claim_id: str, body: VoidIn) -> ClaimMutationOut:
    return svc.void_claim(ctx, claim_id, body.reason)


@router.post("/claims/{claim_id}:corrected", response_model=ClaimMutationOut, status_code=201)
def corrected(ctx: CtxDep, claim_id: str, body: CorrectedIn) -> ClaimMutationOut:
    return svc.corrected_claim(ctx, claim_id, body.changes)


@router.post("/claims/{claim_id}:triage", response_model=TriageOut, status_code=202)
def triage(ctx: CtxDep, claim_id: str, body: TriageIn | None = None) -> TriageOut:
    return svc.triage(ctx, claim_id, body.agent if body else None)


@router.get("/summary/strip", response_model=Strip, tags=["summary"])
def summary_strip(ctx: CtxDep, location_id: str | None = None) -> Strip:
    return screens.summary_strip(ctx, location_id)


@router.get("/views", response_model=ViewList, tags=["views"])
def list_views(ctx: CtxDep) -> ViewList:
    return svc.list_views(ctx)


@router.post("/views", response_model=SavedView, status_code=201, tags=["views"])
def create_view(ctx: CtxDep, body: ViewIn) -> SavedView:
    return svc.create_view(ctx, body.name, body.search_params)


@router.get("/ledger/today", response_model=LedgerToday, tags=["ledger"])
def ledger_today(ctx: CtxDep) -> LedgerToday:
    return screens.ledger_today(ctx)
