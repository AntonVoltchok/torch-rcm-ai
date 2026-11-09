"""Activity: the run log, this week's decisions (ran without review vs. came to a person)."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from torch_rcm.api.schemas import ActivityDay, ActivityOut, ActivityRow, ActivitySummary, ClaimMove
from torch_rcm.clock import to_practice_tz
from torch_rcm.domain.entities import AuditEvent, Run
from torch_rcm.domain.enums import ROUTINE_ACTIONS, PolicyVerdict, RuleAction, RunStatus
from torch_rcm.readmodels.moves import claim_move
from torch_rcm.readmodels.snapshot import Snapshot

DECIDED = (RunStatus.SUCCEEDED, RunStatus.WOULD_HAVE_RUN, RunStatus.FAILED)


def week_start(today: date) -> date:
    return today - timedelta(days=today.weekday())


def is_decision(run: Run) -> bool:
    """A decision is a run whose policy verdict executed or proposed a non-routine action (status checks and
    payer calls are counted separately, as in the Activity header)."""
    if run.status not in DECIDED or run.verdict not in (
        PolicyVerdict.EXECUTE,
        PolicyVerdict.PROPOSE,
        PolicyVerdict.OBSERVE,
    ):
        return False
    return run.action not in ROUTINE_ACTIONS or run.verdict is PolicyVerdict.PROPOSE


def ran_without_review(run: Run) -> bool:
    return run.verdict in (PolicyVerdict.EXECUTE, PolicyVerdict.OBSERVE) and run.inbox_item_id is None


def this_week(snap: Snapshot) -> list[Run]:
    start = week_start(snap.today)
    return [
        r for r in snap.of(Run) if r.started_at.date() >= start and is_decision(r) and r.trigger.value != "approval"
    ]


def week_decisions(snap: Snapshot) -> dict[str, Any]:
    runs = this_week(snap)
    by_agent: dict[str, dict[str, int]] = {}
    by_tier: dict[str, dict[str, int]] = {}
    ran = to_dana = 0
    for r in runs:
        bucket = "ran" if ran_without_review(r) else "to_dana"
        ran += bucket == "ran"
        to_dana += bucket == "to_dana"
        by_agent.setdefault(r.agent.value, {"ran": 0, "to_dana": 0})[bucket] += 1
        tier = str(int(r.tier)) if r.tier is not None else "none"
        by_tier.setdefault(tier, {"ran": 0, "to_dana": 0})[bucket] += 1
    return {"total": len(runs), "ran": ran, "to_dana": to_dana, "by_agent": by_agent, "by_tier": by_tier}


def activity(
    snap: Snapshot,
    day: date | None = None,
    agent: str | None = None,
    outcome: str | None = None,
    viewer_id: str | None = None,
) -> ActivityOut:
    start = week_start(snap.today)
    runs = [r for r in snap.of(Run) if r.started_at.date() >= start]
    if day:
        runs = [r for r in runs if r.started_at.date() == day]
    if agent:
        runs = [r for r in runs if r.agent.value == agent]
    moves: dict[str, ClaimMove] = {}

    def move(claim_id: str | None) -> ClaimMove | None:
        claim = snap.claims.get(claim_id or "")
        if claim is None:
            return None
        if claim.id not in moves:
            moves[claim.id] = claim_move(snap, claim, viewer_id)
        return moves[claim.id]

    rows = [_row(snap, r, move(r.claim_id)) for r in runs]
    for ev in snap.of(AuditEvent):
        if ev.at.date() >= start and (day is None or ev.at.date() == day) and agent is None:
            rows.append(
                ActivityRow(
                    run_id=ev.id,
                    at=ev.at,
                    agent=None,
                    actor=ev.actor,
                    action=ev.detail,
                    subject=ev.subject_id,
                    claim_id=ev.subject_id if ev.subject_type == "claim" else None,
                    outcome=ev.action,
                    would_have_run=False,
                    awaiting_you=False,
                    evidence_kinds=[],
                    audit_line=ev.detail,
                    tier=None,
                    move=move(ev.subject_id if ev.subject_type == "claim" else None),
                )
            )
    if outcome == "awaiting":
        rows = [r for r in rows if r.awaiting_you]
    elif outcome == "ran":
        rows = [r for r in rows if not r.awaiting_you and r.agent is not None]
    elif outcome == "would_have_run":
        rows = [r for r in rows if r.would_have_run]
    rows.sort(key=lambda r: r.at, reverse=True)
    week = week_decisions(snap)
    week_runs = [r for r in snap.of(Run) if r.started_at.date() >= start]
    summary = ActivitySummary(
        ran_without_you=week["ran"],
        awaiting_you=len(snap.open_items),
        decisions=week["total"],
        status_checks=sum(1 for r in week_runs if r.action is RuleAction.STATUS_CHECK),
        payer_calls=sum(1 for r in week_runs if r.action is RuleAction.PAYER_REP_CALL),
        claims_sent=sum(
            1
            for r in week_runs
            if r.action in (RuleAction.SEND_CLAIM_PMS_CODES, RuleAction.SEND_CLAIM_AGENT_TEXT)
            and r.verdict is PolicyVerdict.EXECUTE
        ),
        remittances_posted=sum(
            1 for r in week_runs if r.action is RuleAction.POST_ERA_LINE and r.verdict is PolicyVerdict.EXECUTE
        ),
    )
    return ActivityOut(
        rows=rows, summary=summary, by_agent=week["by_agent"], by_tier=week["by_tier"], by_day=_by_day(rows)
    )


def _by_day(rows: list[ActivityRow]) -> list[ActivityDay]:
    """Rows per practice-local day, after the filters, in the rows' (newest first) order."""
    counts: dict[date, int] = {}
    for r in rows:
        d = to_practice_tz(r.at).date()
        counts[d] = counts.get(d, 0) + 1
    return [ActivityDay(date=d, count=n) for d, n in counts.items()]


def _row(snap: Snapshot, r: Run, move: ClaimMove | None) -> ActivityRow:
    subject = ""
    if r.claim_id and r.claim_id in snap.claims:
        c = snap.claims[r.claim_id]
        subject = f"#{c.number} · {snap.patients[c.patient_id].display_name}"
    elif r.patient_id and r.patient_id in snap.patients:
        subject = snap.patients[r.patient_id].display_name
    elif r.remittance_id:
        subject = r.remittance_id
    evidence_ids = {e for step in r.steps for e in step.evidence_ids}
    kinds = sorted({snap.evidence[e].kind.value for e in evidence_ids if e in snap.evidence})
    awaiting = r.inbox_item_id is not None and any(i.id == r.inbox_item_id for i in snap.open_items)
    return ActivityRow(
        run_id=r.id,
        at=r.started_at,
        agent=r.agent,
        actor=r.actor,
        action=r.result_summary or r.action_label,
        subject=subject,
        claim_id=r.claim_id,
        outcome=r.outcome or r.status.value,
        would_have_run=r.status is RunStatus.WOULD_HAVE_RUN,
        awaiting_you=awaiting,
        evidence_kinds=kinds,
        audit_line=r.audit_line,
        tier=r.tier,
        move=move,
    )
