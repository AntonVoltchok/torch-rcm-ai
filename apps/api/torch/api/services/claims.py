"""Claims: list (server-side filter/sort/cursor), detail with merged timeline, void (tier 3), corrected (tier 2),
manual triage (enqueues a run for torch.agents), saved views."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from torch.api.errors import conflict, forbidden, not_found, unprocessable
from torch.api.schemas import (
    ClaimDetail,
    ClaimList,
    ClaimMutationOut,
    CoverageOut,
    MoneyMath,
    TimelinePage,
    TriageOut,
    ViewList,
)
from torch.api.services.context import Ctx
from torch.domain.entities import Claim, ClaimLine, Coverage, FileEntry, Run, SavedView
from torch.domain.enums import (
    ACTIVE_RUN_STATUSES,
    AgentKind,
    ClaimStatus,
    ClosedReason,
    FileEntryKind,
    FileEntryState,
    Role,
    RunStatus,
    RunTrigger,
)
from torch.domain.routing import route_denial
from torch.readmodels.claims import (
    ClaimQuery,
    decode_cursor,
    encode_cursor,
    patient_ref,
    payer_ref,
    query_claims,
    summarize,
)
from torch.readmodels.inbox import item_out
from torch.readmodels.snapshot import Snapshot
from torch.readmodels.timeline import timeline
from torch.scheduler import kinds as K
from torch.world.fees import ScheduleBook
from torch.world.payers.adjudicate import LineIn, adjudicate
from torch.world.payers.profiles import profile
from torch.world.sim import HoldWindowClosedError

TIMELINE_PAGE = 100


def list_claims(ctx: Ctx, q: ClaimQuery) -> ClaimList:
    return query_claims(ctx.snapshot(), q)


def coverage_out(cov: Coverage) -> CoverageOut:
    p = cov.plan
    return CoverageOut(
        id=cov.id,
        payer_key=cov.payer_key,
        plan_name=cov.plan_name,
        subscriber_id=cov.subscriber_id,
        group_no=cov.group_no,
        order=cov.order.value,
        self_funded=cov.self_funded,
        annual_max_cents=p.annual_max_cents,
        used_cents=p.used_cents,
        remaining_max_cents=p.remaining_max_cents,
        deductible_cents=p.deductible_cents,
        deductible_met_cents=p.deductible_met_cents,
        pct_preventive=p.pct_preventive,
        pct_basic=p.pct_basic,
        pct_major=p.pct_major,
        verified_at=cov.verified_at,
        verified_via=cov.verified_via.value if cov.verified_via else None,
    )


def money(claim: Claim, coverage: Coverage, schedules: ScheduleBook) -> MoneyMath:
    """The header money math: billed, contract allowed, contractual, and paid/patient per the 835 — or, before
    the 835, the estimate the checkout used (same adjudication function, no denial)."""
    allowed = sum(line.allowed_cents or 0 for line in claim.lines)
    if claim.paid_cents is not None and claim.status in (ClaimStatus.PAID, ClaimStatus.PARTIAL):
        ins_est, pt_est, basis = claim.paid_cents, claim.patient_resp_cents, "per 835"
    else:
        est = adjudicate(
            [LineIn(line.id, line.cdt, line.fee_cents, line.tooth) for line in claim.lines],
            payer=profile(claim.payer_key),
            plan=coverage.plan,
            schedule=schedules.get(coverage.plan.fee_schedule),
            attachments=frozenset({"pa"}),
        )
        ins_est, pt_est, basis = (
            est.paid,
            est.patient,
            f"estimate from contract allowed · {coverage.plan_name}",
        )
    return MoneyMath(
        billed_cents=claim.billed_cents,
        allowed_cents=allowed,
        contractual_cents=claim.billed_cents - allowed,
        insurance_est_cents=ins_est,
        patient_est_cents=pt_est,
        paid_cents=claim.paid_cents,
        writeoff_cents=claim.writeoff_cents,
        patient_resp_cents=claim.patient_resp_cents,
        basis=basis,
    )


def claim_detail(ctx: Ctx, claim_id: str) -> ClaimDetail:
    snap = ctx.snapshot()
    claim = _claim(snap, claim_id)
    cov = snap.coverages[claim.coverage_id]
    entries = timeline(snap, claim)
    page = entries[-TIMELINE_PAGE:]
    provider = snap.providers[claim.provider_id]
    return ClaimDetail(
        claim=summarize(snap, claim),
        provider_name=provider.name,
        location_name=snap.locations[claim.location_id].name,
        coverage=coverage_out(cov),
        patient=patient_ref(snap.patients[claim.patient_id]),
        payer=payer_ref(snap, claim.payer_key.value),
        lines=claim.lines,
        attachments=claim.attachments,
        acks=snap.acks_by_claim.get(claim.id, []),
        readiness=claim.readiness,
        denial=claim.denial,
        deadline=claim.deadline,
        money=money(claim, cov, ctx.rt.world.payers[claim.payer_key].schedules),
        timeline=page,
        timeline_next_cursor=encode_cursor(len(entries) - len(page)) if len(entries) > len(page) else None,
        open_inbox_items=[item_out(snap, i) for i in snap.open_items_by_claim.get(claim.id, [])],
        holds=snap.holds_by_subject.get(claim.id, []),
        file_entries=snap.file_entries_by_claim.get(claim.id, []),
        parent_claim_id=claim.parent_claim_id,
        frequency_code=claim.frequency_code,
        closed_reason=claim.closed_reason.value if claim.closed_reason else None,
        timely_filing_due=claim.timely_filing_due,
    )


def claim_timeline(ctx: Ctx, claim_id: str, cursor: str | None) -> TimelinePage:
    """Older pages: the cursor counts entries remaining before the current page (newest last)."""
    snap = ctx.snapshot()
    entries = timeline(snap, _claim(snap, claim_id))
    end = decode_cursor(cursor) if cursor else len(entries)
    start = max(0, end - TIMELINE_PAGE)
    return TimelinePage(items=entries[start:end], next_cursor=encode_cursor(start) if start > 0 else None)


def _claim(snap: Snapshot, claim_id: str) -> Claim:
    claim = snap.claims.get(claim_id)
    if claim is None:
        raise not_found("claim", claim_id)
    return claim


def void_claim(ctx: Ctx, claim_id: str, reason: str) -> ClaimMutationOut:
    """Tier 3, owner only: frequency 8 after the file left; before that, withdraw from the file."""
    ctx.require_role(Role.OWNER, code="tier_requires_owner", message="Void is tier 3: Dr. Morgan only.")
    claim = ctx.rt.store.get(Claim, claim_id)
    if claim is None:
        raise not_found("claim", claim_id)
    if claim.closed_reason is not None:
        raise conflict("already_closed", f"#{claim.number} is already {claim.closed_reason.value}")
    with ctx.rt.store.tx():
        for entry in ctx.rt.store.find(FileEntry, {"claim_id": claim.id, "state": FileEntryState.QUEUED}):
            entry.state = FileEntryState.WITHDRAWN
            ctx.rt.store.update(entry)
        claim.closed_reason, claim.closed_at, claim.frequency_code = ClosedReason.VOIDED, ctx.now, 8
        ctx.rt.store.update(claim)
        ctx.audit("claim.void", "claim", claim.id, f"{ctx.user.name} voided #{claim.number} (frequency 8): {reason}")
    return ClaimMutationOut(claim=summarize(ctx.snapshot(), claim), meta=ctx.meta())


def corrected_claim(ctx: Ctx, claim_id: str, changes: dict[str, Any]) -> ClaimMutationOut:
    """Tier 2: a new claim (frequency 7) that links the original and leaves in the next file."""
    if ctx.user.role not in (Role.OWNER, Role.BILLING):
        raise forbidden("forbidden", f"{ctx.user.name} cannot send corrected claims")
    original = ctx.rt.store.get(Claim, claim_id)
    if original is None:
        raise not_found("claim", claim_id)
    if (
        original.status
        not in (
            ClaimStatus.DENIED,
            ClaimStatus.REJECTED,
            ClaimStatus.SENT,
            ClaimStatus.ACCEPTED,
            ClaimStatus.PENDING,
            ClaimStatus.PARTIAL,
        )
        or original.closed_reason
    ):
        raise conflict(
            "not_correctable",
            f"#{original.number} is {original.status.value}; a corrected claim replaces a claim the payer has",
        )
    lines = [
        ClaimLine(
            **{
                **line.model_dump(),
                **changes.get("lines", {}).get(line.id, {}),
                "paid_cents": None,
                "adj": [],
                "patient_adj": [],
                "patient_cents": None,
            }
        )
        for line in original.lines
    ]
    number = int(ctx.rt.store.scalar('SELECT MAX("number") FROM claims') or 0) + 1
    new = original.model_copy(
        update={
            "id": f"clm_{number}",
            "number": number,
            "status": ClaimStatus.READY,
            "frequency_code": 7,
            "parent_claim_id": original.id,
            "built_at": ctx.now,
            "sent_at": None,
            "file_time": None,
            "icn": original.icn,
            "lines": [line.model_copy(update={"id": f"cl_{number}_{i}"}) for i, line in enumerate(lines, 1)],
            "billed_cents": sum(line.fee_cents for line in lines),
            "denial": None,
            "paid_cents": None,
            "paid_at": None,
            "patient_resp_cents": None,
            "reason_text": "corrected claim (frequency 7)",
            "in_flight": None,
        }
    )
    with ctx.rt.store.tx():
        ctx.rt.store.insert(new)
        original.closed_reason, original.closed_at = ClosedReason.SUPERSEDED, ctx.now
        ctx.rt.store.update(original)
        ctx.rt.world.vyne.queue(new.id, FileEntryKind.CORRECTED, by=ctx.user.id, key=f"corrected:{new.id}")
        ctx.audit(
            "claim.corrected",
            "claim",
            original.id,
            f"{ctx.user.name} sent corrected claim #{number} replacing #{original.number}",
            claim_id=new.id,
        )
    return ClaimMutationOut(claim=summarize(ctx.snapshot(), ctx.rt.store.require(Claim, new.id)), meta=ctx.meta())


def triage(ctx: Ctx, claim_id: str, agent: str | None) -> TriageOut:
    """Manual triage run (trigger manual, actor = caller), handed to torch.agents through `run.start`."""
    claim = ctx.rt.store.get(Claim, claim_id)
    if claim is None:
        raise not_found("claim", claim_id)
    if ctx.user.role not in (Role.OWNER, Role.BILLING):
        raise forbidden("forbidden", f"{ctx.user.name} cannot start agent runs")
    from torch.domain.entities import Practice

    if ctx.rt.store.all(Practice)[0].agents_paused:
        raise conflict("agents_paused", "Agents are paused; resume them first.")
    active = [r for r in ctx.rt.store.find(Run, {"claim_id": claim.id}) if r.status in ACTIVE_RUN_STATUSES]
    if active:
        raise conflict("run_in_progress", f"A run on #{claim.number} is {active[0].status.value}", run_id=active[0].id)
    kind = AgentKind(agent) if agent else _default_agent(claim)
    run = Run(
        id=f"run_triage_{claim.number}_{ctx.now:%m%d%H%M%S}",
        agent=kind,
        trigger=RunTrigger.MANUAL,
        actor=ctx.user.id,
        claim_id=claim.id,
        patient_id=claim.patient_id,
        idempotency_key=f"triage:{claim.id}:{ctx.now.isoformat()}",
        status=RunStatus.QUEUED,
        started_at=ctx.now,
    )
    with ctx.rt.store.tx():
        ctx.rt.store.insert(run)
        ctx.rt.scheduler.enqueue(
            K.RUN_START,
            ctx.now,
            {"run_id": run.id, "claim_id": claim.id, "manual": True},
            f"run.start:{run.id}",
        )
        ctx.audit(
            "claim.triage",
            "claim",
            claim.id,
            f"{ctx.user.name} asked {kind.value} to look at #{claim.number}",
        )
    return TriageOut(run=run, meta=ctx.meta())


def _default_agent(claim: Claim) -> AgentKind:
    if claim.status in (ClaimStatus.READY, ClaimStatus.REJECTED):
        return AgentKind.CLAIMS
    if claim.denial:
        return route_denial(
            claim.denial.carc,
            claim.denial.rarc,
            root_cause=claim.denial.root_cause,
            payer=claim.payer_key,
            self_funded=False,
        ).agent
    return AgentKind.FOLLOWUP


def assert_editable(ctx: Ctx, claim_id: str) -> None:
    try:
        ctx.rt.world.vyne.assert_editable(claim_id)
    except HoldWindowClosedError as exc:
        raise conflict("file_departed", str(exc), alternatives=["corrected_claim"]) from exc


def list_views(ctx: Ctx) -> ViewList:
    rows = [v for v in ctx.rt.store.all(SavedView) if v.owner_user_id in (None, ctx.user.id)]
    rows.sort(key=lambda v: (not v.builtin, v.created_at))
    return ViewList(items=rows, total=len(rows))


def create_view(ctx: Ctx, name: str, search_params: dict[str, Any]) -> SavedView:
    allowed = {"status", "flag", "payer", "provider", "age", "q", "sort"}
    unknown = set(search_params) - allowed
    if unknown:
        raise unprocessable("invalid_search_params", f"unknown search params: {sorted(unknown)}")
    view = SavedView(
        id=f"view_{ctx.user.id}_{ctx.now:%m%d%H%M%S}",
        name=name,
        search_params=search_params,
        owner_user_id=ctx.user.id,
        created_at=ctx.now,
    )
    ctx.rt.store.insert(view)
    return view


EDIT_WINDOW = timedelta(seconds=60)
