"""Deterministic denial routing: CARC·RARC (+ facts) → next action and the agent that owns it.

One function, shared by the Denials worklist (GET /denials) and torch_rcm.agents (07-agents "Router"), so the
worklist and the agents never disagree about what a denial needs. The 835 group code and RARC decide the path,
not whose fault it was (decisions log, round 5).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from torch_rcm.domain.enums import AgentKind, DeadlineKind, NextAction, PayerKey, RootCause
from torch_rcm.domain.values import Deadline


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


def denial_deadline(
    carc: str,
    rarc: str | None,
    *,
    payer_short: str,
    eob_on: date,
    appeal_window_days: int,
    self_funded: bool,
    dos: date,
    refile: tuple[str, int] | None = None,
) -> Deadline:
    """The clock a new denial starts, typed (Denials worklist, inbox priority). Pure: the 835 handler passes the
    payer's windows. `refile` = (payer short name, timely-filing days) of the plan a COB denial says is primary.

    - CO-16 (missing documentation / records): no appeal clock — the payer reprocesses when the records land.
    - CO-22 (coordination of benefits): timely filing on the new primary claim, from the date of service.
    - CO-29 (timely filing): the timely-filing appeal window, from this EOB.
    - otherwise (CO-50 and the rest): the appeal window from this EOB; ERISA plans name the federal floor."""
    eob = f"{eob_on:%m/%d}"
    if carc == "CO-16":
        return Deadline(kind=DeadlineKind.NONE, due_on=None, basis="records request · no appeal clock")
    if carc == "CO-22":
        short, days = refile or (payer_short, 0)
        if days <= 0:
            return Deadline(kind=DeadlineKind.NONE, due_on=None, basis="other plan not on file")
        return Deadline(
            kind=DeadlineKind.TIMELY_FILING,
            due_on=dos + timedelta(days=days),
            basis=f"{short}: file as primary within {days} days of the {dos:%m/%d} DOS",
        )
    due = eob_on + timedelta(days=appeal_window_days)
    if carc == "CO-29":
        return Deadline(
            kind=DeadlineKind.APPEAL,
            due_on=due,
            basis=f"{payer_short}: timely-filing appeal {appeal_window_days} days from the {eob} ERA",
        )
    erisa = " · ERISA (29 CFR 2560.503-1)" if self_funded else ""
    return Deadline(
        kind=DeadlineKind.APPEAL,
        due_on=due,
        basis=f"{payer_short}: {appeal_window_days} days from the {eob} ERA{erisa}",
    )
