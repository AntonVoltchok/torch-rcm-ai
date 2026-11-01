from __future__ import annotations

from datetime import date

from fastapi import APIRouter

from torch_rcm.api.deps import CtxDep
from torch_rcm.api.schemas import (
    ActivityOut,
    BenefitsPanel,
    CashOut,
    DenialsOut,
    EligibilityOut,
    PatientBalances,
    RemittanceList,
)
from torch_rcm.api.services import screens as svc
from torch_rcm.domain.entities import Remittance
from torch_rcm.domain.enums import Role

router = APIRouter()


@router.get("/activity", response_model=ActivityOut, tags=["activity"])
def activity(ctx: CtxDep, day: date | None = None, agent: str | None = None, outcome: str | None = None) -> ActivityOut:
    return svc.activity(ctx, day, agent, outcome)


@router.get("/eligibility", response_model=EligibilityOut, tags=["eligibility"])
def eligibility(ctx: CtxDep, date: date | None = None) -> EligibilityOut:
    return svc.eligibility(ctx, date)


@router.get("/eligibility/{appointment_id}", response_model=BenefitsPanel, tags=["eligibility"])
def benefits(ctx: CtxDep, appointment_id: str) -> BenefitsPanel:
    return svc.benefits(ctx, appointment_id)


@router.get("/cash", response_model=CashOut, tags=["cash"])
def cash(ctx: CtxDep, location_id: str | None = None) -> CashOut:
    ctx.require_role(Role.OWNER, code="forbidden", message="Cash is the owner's screen.")
    return svc.cash(ctx, location_id)


@router.get("/denials", response_model=DenialsOut, tags=["denials"])
def denials(ctx: CtxDep) -> DenialsOut:
    ctx.require_role(
        Role.OWNER,
        Role.BILLING,
        Role.DENTIST,
        code="forbidden",
        message="Denials is not a front-desk screen.",
    )
    return svc.denials(ctx)


@router.get("/remittances", response_model=RemittanceList, tags=["payments"])
def remittances(ctx: CtxDep) -> RemittanceList:
    return svc.remittances(ctx)


@router.get("/remittances/{remittance_id}", response_model=Remittance, tags=["payments"])
def remittance(ctx: CtxDep, remittance_id: str) -> Remittance:
    return svc.remittance(ctx, remittance_id)


@router.get("/patients/balances", response_model=PatientBalances, tags=["patients"])
def patient_balances(ctx: CtxDep) -> PatientBalances:
    return svc.patient_balances(ctx)
