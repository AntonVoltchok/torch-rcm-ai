from __future__ import annotations

from fastapi import APIRouter

from torch_rcm.api.deps import CtxDep, IdempotencyKey
from torch_rcm.api.schemas import (
    PracticeSettingsIn,
    PracticeSettingsOut,
    PreviewOut,
    ProposalList,
    ProposalOut,
    RuleChangeList,
    RulePatchIn,
    RulePatchOut,
    RulesOut,
)
from torch_rcm.api.services import rules as svc
from torch_rcm.domain.enums import RuleMode

router = APIRouter(tags=["settings"])


@router.get("/rules", response_model=RulesOut)
def list_rules(ctx: CtxDep) -> RulesOut:
    return svc.list_rules(ctx)


@router.get("/rules/changes", response_model=RuleChangeList)
def list_changes(ctx: CtxDep) -> RuleChangeList:
    return svc.list_changes(ctx)


@router.patch("/rules/{rule_id}", response_model=RulePatchOut)
def patch_rule(ctx: CtxDep, rule_id: str, body: RulePatchIn, idempotency_key: IdempotencyKey = None) -> RulePatchOut:
    return svc.patch_rule(ctx, rule_id, body, idempotency_key=idempotency_key)


@router.get("/settings/preview", response_model=PreviewOut)
def preview(ctx: CtxDep, rule_id: str, mode: RuleMode | None = None, max_cents: int | None = None) -> PreviewOut:
    return svc.preview(ctx, rule_id, mode, max_cents)


@router.patch("/settings/practice", response_model=PracticeSettingsOut)
def patch_practice(
    ctx: CtxDep, body: PracticeSettingsIn, idempotency_key: IdempotencyKey = None
) -> PracticeSettingsOut:
    return svc.patch_practice(ctx, body, idempotency_key=idempotency_key)


@router.get("/proposals", response_model=ProposalList)
def list_proposals(ctx: CtxDep) -> ProposalList:
    return svc.list_proposals(ctx)


@router.post("/proposals/{proposal_id}:accept", response_model=ProposalOut)
def accept(ctx: CtxDep, proposal_id: str) -> ProposalOut:
    return svc.accept_proposal(ctx, proposal_id)


@router.post("/proposals/{proposal_id}:dismiss", response_model=ProposalOut)
def dismiss(ctx: CtxDep, proposal_id: str) -> ProposalOut:
    return svc.dismiss_proposal(ctx, proposal_id)
