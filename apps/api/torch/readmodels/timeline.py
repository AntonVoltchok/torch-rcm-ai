"""Claim timeline: runs, acks, remittances, audit events and the visit, merged newest last."""

from __future__ import annotations

from torch.api.schemas import TimelineEntry
from torch.domain.entities import AuditEvent, Claim, Remittance
from torch.domain.enums import RootCause, RunStatus
from torch.readmodels.snapshot import Snapshot


def timeline(snap: Snapshot, claim: Claim) -> list[TimelineEntry]:
    out: list[TimelineEntry] = []
    visit = snap.visits.get(claim.visit_id or "")
    if visit is not None:
        provider = snap.providers.get(visit.provider_id)
        out.append(
            TimelineEntry(
                id=f"visit_{visit.id}",
                at=visit.completed_at,
                lane="system",
                kind="visit",
                title=f"Visit completed · {claim.procedures_summary} · {provider.name if provider else ''}",
                detail=f"{len(claim.lines)} lines posted to the PMS ledger",
            )
        )
    out.append(
        TimelineEntry(
            id=f"built_{claim.id}",
            at=claim.built_at,
            lane="agent",
            kind="built",
            title=f"Claims agent built claim #{claim.number} at checkout",
            detail=", ".join(
                a.kind.value.upper() + (f" NEA# {a.nea_number}" if a.nea_number else "") for a in claim.attachments
            )
            or None,
        )
    )
    for ack in snap.acks_by_claim.get(claim.id, []):
        out.append(
            TimelineEntry(
                id=ack.id,
                at=ack.at,
                lane="payer" if ack.source == "payer" else "system",
                kind=ack.stage.value,
                title=ack.message,
            )
        )
    for run in snap.runs_by_claim.get(claim.id, []):
        if run.status is RunStatus.QUEUED and not run.steps:
            title = f"{run.action_label or run.agent.value} · queued"
        else:
            title = run.result_summary or run.action_label
        evidence = sorted({e for s in run.steps for e in s.evidence_ids})
        out.append(
            TimelineEntry(
                id=run.id,
                at=run.started_at,
                lane="agent",
                kind=f"run:{run.status.value}",
                title=title,
                detail=run.audit_line or None,
                actor=run.actor,
                run_id=run.id,
                evidence_ids=evidence,
            )
        )
    for remit in snap.of(Remittance):
        lines = [line for line in remit.lines if line.claim_id == claim.id]
        if not lines:
            continue
        paid = sum(line.paid for line in lines)
        denied = claim.denial if claim.denial and paid == 0 else None
        title = (
            f"{snap.payers[remit.payer_key.value].short_name} {'ERA' if remit.kind.value == '835' else 'paper EOB'} · "
            + (
                f"Denied {denied.carc}{' · ' + denied.rarc if denied.rarc else ''} · {denied.decoded}"
                if denied
                else f"paid ${paid / 100:,.2f}"
            )
        )
        root = denied.root_cause if denied and denied.root_cause is RootCause.OURS else None
        out.append(
            TimelineEntry(
                id=f"{remit.id}_{claim.id}",
                at=remit.received_at,
                lane="payer",
                kind="remittance",
                title=title,
                detail=f"trace {remit.trace}",
                root_cause=root,
            )
        )
        if root is RootCause.OURS:
            out.append(
                TimelineEntry(
                    id=f"rootcause_{claim.id}",
                    at=remit.received_at,
                    lane="agent",
                    kind="root_cause",
                    title="Root cause: ours — our Claims agent sent the wrong attachment for the payer's rule",
                    root_cause=RootCause.OURS,
                )
            )
    for ev in snap.of(AuditEvent):
        if ev.subject_id == claim.id or ev.data.get("claim_id") == claim.id:
            user = snap.users.get(ev.actor)
            out.append(
                TimelineEntry(
                    id=ev.id,
                    at=ev.at,
                    lane="human",
                    kind=ev.action,
                    title=ev.detail,
                    actor=user.name if user else ev.actor,
                )
            )
    for entry in snap.file_entries_by_claim.get(claim.id, []):
        state = "left in" if entry.state.value == "departed" else "queued for"
        out.append(
            TimelineEntry(
                id=entry.id,
                at=entry.departed_at or entry.queued_at,
                lane="system",
                kind=f"file:{entry.state.value}",
                title=(
                    f"{entry.kind.value.capitalize()} {state} the {entry.file_time:%H:%M} "
                    f"{snap.payers[entry.payer_key.value].short_name} file via Vyne"
                ),
            )
        )
    out.sort(key=lambda e: (e.at, e.id))
    return out
