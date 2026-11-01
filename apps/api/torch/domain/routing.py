"""Deterministic denial routing: CARC·RARC (+ facts) → next action and the agent that owns it.

One function, shared by the Denials worklist (GET /denials) and torch.agents (07-agents "Router"), so the
worklist and the agents never disagree about what a denial needs. The 835 group code and RARC decide the path,
not whose fault it was (decisions log, round 5).
"""

from __future__ import annotations

from dataclasses import dataclass

from torch.domain.enums import AgentKind, NextAction, PayerKey, RootCause


@dataclass(frozen=True, slots=True)
class Route:
    next_action: NextAction
    agent: AgentKind
    why: str
    signer_role: str | None = None  # "rendering_dentist" | "owner" for tier-3 paths
    checklist: tuple[str, ...] = ()


def route_denial(carc: str, rarc: str | None, *, root_cause: RootCause, payer: PayerKey, self_funded: bool) -> Route:
    key = f"{carc}:{rarc}" if rarc else carc
    if key in ("CO-16:N29", "CO-16:M127") or carc == "CO-16":
        return Route(NextAction.RECONSIDERATION, AgentKind.FOLLOWUP, "missing documentation: send it, no appeal needed")
    if carc == "CO-119":
        return Route(
            NextAction.RECONSIDERATION,
            AgentKind.FOLLOWUP,
            "frequency: claim inquiry with the payer's own history",
        )
    if carc == "CO-22":
        return Route(
            NextAction.CORRECTED,
            AgentKind.FOLLOWUP,
            "coordination of benefits: fix coverage order, resubmit to the primary",
        )
    if carc in ("CO-50", "CO-29", "CO-197"):
        checklist = ["rendering dentist signs the attestation"]
        if self_funded:
            checklist.append("patient authorization required (ERISA)")
        if carc == "CO-29":
            checklist = ["proof of timely receipt (payer 277CA)", *checklist]
        return Route(
            NextAction.FORMAL_APPEAL,
            AgentKind.APPEALS,
            "formal appeal: attests clinical facts, burns a level",
            "rendering_dentist",
            tuple(checklist),
        )
    if carc in ("PR-119", "PR-204", "CO-204") and payer is not PayerKey.NY_MEDICAID and carc.startswith("PR"):
        return Route(
            NextAction.BILL_PATIENT_LINK,
            AgentKind.POSTING,
            "patient responsibility: closes in Payments",
            "owner",
            ("write off the contractual difference (tier 3)",),
        )
    if carc == "CO-204" or payer is PayerKey.NY_MEDICAID:
        return Route(
            NextAction.WRITE_OFF,
            AgentKind.POSTING,
            "not billable to the patient without dated consent",
            "owner",
        )
    return Route(NextAction.RECONSIDERATION, AgentKind.FOLLOWUP, "review the denial with the payer")


def patient_billable_if_lost(carc: str, payer: PayerKey) -> bool:
    """CO = contractual obligation: the practice cannot bill the patient if the appeal is lost; PR can be."""
    return carc.startswith("PR") and payer is not PayerKey.NY_MEDICAID
