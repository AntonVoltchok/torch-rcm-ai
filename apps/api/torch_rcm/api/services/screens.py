"""Static-screen reads: Today's claims, Activity, Eligibility, Cash, Denials, Remittances, Patient balances."""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta

from torch_rcm.api.errors import not_found
from torch_rcm.api.schemas import (
    ActivityOut,
    BenefitsPanel,
    CashOut,
    DenialGroup,
    DenialMatrix,
    DenialMatrixCell,
    DenialMatrixRow,
    DenialReason,
    DenialReasonColumn,
    DenialRow,
    DenialsOut,
    EligibilityDay,
    EligibilityOut,
    EligibilityRow,
    FrequencyRow,
    HeldRow,
    LedgerFile,
    LedgerRow,
    LedgerToday,
    LedgerTotal,
    LedgerTotals,
    NotBillableRow,
    PatientBalanceRow,
    PatientBalances,
    PayerRef,
    RemittanceList,
    Strip,
)
from torch_rcm.api.services.claims import coverage_out
from torch_rcm.api.services.context import Ctx
from torch_rcm.clock import to_practice_tz
from torch_rcm.domain.entities import (
    Appointment,
    Claim,
    Coverage,
    Estimate,
    InboxItem,
    PatientLedgerEntry,
    ProcedureLine,
    Remittance,
    Visit,
)
from torch_rcm.domain.enums import (
    AttachmentSource,
    ClaimStatus,
    CoverageOrder,
    EligibilityStatus,
    FileEntryState,
    NextAction,
)
from torch_rcm.domain.routing import patient_billable_if_lost, route_denial
from torch_rcm.readmodels import activity as A
from torch_rcm.readmodels import cash as C
from torch_rcm.readmodels.claims import AGE_BUCKETS, age_bucket, patient_ref, payer_ref, strip, summarize
from torch_rcm.readmodels.moves import claim_signer, signer
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.world.calendar import FILE_TIMES, is_business_day, next_file_time
from torch_rcm.world.sim import EDIT_LOCK

S = ClaimStatus
NEXT_ACTION_LABEL = {
    NextAction.RECONSIDERATION: "Reconsideration · resend or inquiry, no signature",
    NextAction.CORRECTED: "Corrected claim / COB resubmit",
    NextAction.FORMAL_APPEAL: "Formal appeal · the rendering dentist signs",
    NextAction.BILL_PATIENT_LINK: "Bill patient · closes in Payments",
    NextAction.WRITE_OFF: "Write-off · Dr. Morgan",
}
NOT_BILLABLE_REASON = "no pocket depths charted for this quadrant · not billable (TorchRCM never nudges documentation)"
FREQUENCY_RULES = {
    "D4341": ("1 / 24 mo", 24),
    "D1110": ("2 / yr", 6),
    "D0274": ("1 / yr", 12),
    "D0210": ("1 / 5 yr", 60),
    "D0120": ("2 / yr", 6),
}


def summary_strip(ctx: Ctx, location_id: str | None) -> Strip:
    return strip(ctx.snapshot(), ctx.user.id, location_id)


# ── Today's claims ─────────────────────────────────────────────────────────────────────────────────────────


def ledger_today(ctx: Ctx) -> LedgerToday:
    snap = ctx.snapshot()
    today = snap.today
    built_today = [c for c in snap.of(Claim) if c.built_at.date() == today and c.closed_reason is None]
    sent: list[LedgerRow] = []
    leaving: list[LedgerRow] = []
    held: list[HeldRow] = []
    for claim in sorted(built_today, key=lambda c: c.built_at):
        holds = snap.holds_by_subject.get(claim.id, [])
        if holds:
            held.append(_held(snap, claim, holds[0], ctx.user.id))
        elif claim.status is S.READY or any(
            e.state is FileEntryState.QUEUED for e in snap.file_entries_by_claim.get(claim.id, [])
        ):
            leaving.append(_ledger_row(snap, claim, ctx.user.id))
        else:
            sent.append(_ledger_row(snap, claim, ctx.user.id))
    for claim in snap.of(Claim):
        if claim.built_at.date() < today and claim.closed_reason is None:
            holds = snap.holds_by_subject.get(claim.id, [])
            if holds:
                held.append(_held(snap, claim, holds[0], ctx.user.id))
            elif any(
                e.state is FileEntryState.QUEUED and e.file_time.date() == today
                for e in snap.file_entries_by_claim.get(claim.id, [])
            ):
                leaving.append(_ledger_row(snap, claim, ctx.user.id))
    billed_lines = {line.procedure_line_id for c in snap.of(Claim) for line in c.lines}
    not_billable = []
    for proc in snap.of(ProcedureLine):
        if proc.dos == today and proc.id not in billed_lines and not snap.visits[proc.visit_id].self_pay:
            visit = snap.visits[proc.visit_id]
            not_billable.append(
                NotBillableRow(
                    patient=patient_ref(snap.patients[visit.patient_id]),
                    cdt=proc.cdt,
                    quadrant=proc.quadrant,
                    fee_cents=proc.fee_cents,
                    reason=NOT_BILLABLE_REASON,
                )
            )
    departed = [
        e.file_time for e in _entries(snap) if e.state is FileEntryState.DEPARTED and e.file_time.date() == today
    ]
    # Today's seeded sends carry their file time on the claim, with no file entry.
    departed += [r.file_time for r in sent if r.file_time and r.file_time <= snap.now and r.file_time.date() == today]
    held = sorted(held, key=lambda h: h.timely_days_left if h.timely_days_left is not None else 10**6)
    return LedgerToday(
        date=today,
        sent=sent,
        leaving_next_file=leaving,
        held=held,
        not_billable=not_billable,
        next_file_time=next_file_time(snap.now, FILE_TIMES),
        last_file_time=max(departed) if departed else None,
        totals=LedgerTotals(
            on_ledger=len(sent) + len(leaving) + len(held),
            sent=_total(r.claim.billed_cents for r in sent),
            leaving=_total(r.claim.billed_cents for r in leaving),
            held=_total(r.claim.billed_cents for r in held),
            not_billable=_total(r.fee_cents for r in not_billable),
        ),
        files=_files(leaving),
    )


def _total(cents: Iterable[int]) -> LedgerTotal:
    values = list(cents)
    return LedgerTotal(count=len(values), cents=sum(values))


def _files(leaving: list[LedgerRow]) -> list[LedgerFile]:
    """ "Leaving in the 10:45 file · 4 · $2,985": one group per file time, earliest first, "not yet filed" last."""
    by: dict[datetime | None, list[LedgerRow]] = {}
    for r in leaving:
        by.setdefault(r.file_time, []).append(r)
    order = sorted(by, key=lambda t: (t is None, t or datetime.min.replace(tzinfo=UTC)))
    return [
        LedgerFile(
            file_time=t,
            count=len(by[t]),
            cents=sum(r.claim.billed_cents for r in by[t]),
            claim_ids=[r.claim.id for r in by[t]],
        )
        for t in order
    ]


def _entries(snap: Snapshot) -> list:  # type: ignore[type-arg]
    return [e for rows in snap.file_entries_by_claim.values() for e in rows]


def _ledger_row(snap: Snapshot, claim: Claim, viewer_id: str | None) -> LedgerRow:
    queued = [e for e in snap.file_entries_by_claim.get(claim.id, []) if e.state is FileEntryState.QUEUED]
    file_time = queued[0].file_time if queued else claim.file_time
    checks = claim.readiness or []
    return LedgerRow(
        claim=summarize(snap, claim, viewer_id),
        built_at=claim.built_at,
        file_time=file_time,
        editable_until=queued[0].file_time - EDIT_LOCK if queued else None,
        ack_stage=claim.ack_stage.value,
        acks=snap.acks_by_claim.get(claim.id, []),
        checks_passed=sum(1 for c in checks if c.status.value in ("pass", "na")) if checks else 13,
        checks_total=len(checks) or 13,
        agent_text=any(a.source is AttachmentSource.AGENT and a.kind.value == "narrative" for a in claim.attachments),
        note=claim.reason_text,
    )


def _held(snap: Snapshot, claim: Claim, hold, viewer_id: str | None) -> HeldRow:  # type: ignore[no-untyped-def]
    owner = snap.users.get(hold.owner_user_id or "")
    left = (hold.timely_due - snap.today).days if hold.timely_due else None
    return HeldRow(
        claim=summarize(snap, claim, viewer_id),
        hold=hold,
        timely_days_left=left,
        owner_name=owner.name if owner else None,
    )


# ── Activity, Cash ─────────────────────────────────────────────────────────────────────────────────────────


def activity(ctx: Ctx, day: date | None, agent: str | None, outcome: str | None) -> ActivityOut:
    return A.activity(ctx.snapshot(), day, agent, outcome, ctx.user.id)


def cash(ctx: Ctx, location_id: str | None) -> CashOut:
    snap = ctx.snapshot()
    if location_id:
        snap = _scoped(snap, location_id)
    return C.cash(snap)


def _scoped(snap: Snapshot, location_id: str) -> Snapshot:
    rows = dict(snap.rows)
    rows[Claim] = [c for c in snap.of(Claim) if c.location_id == location_id]
    visits = {v.id for v in snap.of(Visit) if v.location_id == location_id}
    rows[ProcedureLine] = [p for p in snap.of(ProcedureLine) if p.visit_id in visits]
    patients = {p.id for p in snap.patients.values() if p.location_id == location_id}
    rows[PatientLedgerEntry] = [e for e in snap.of(PatientLedgerEntry) if e.patient_id in patients]
    return Snapshot(now=snap.now, rows=rows)


# ── Eligibility ────────────────────────────────────────────────────────────────────────────────────────────


def eligibility(ctx: Ctx, day: date | None) -> EligibilityOut:
    snap = ctx.snapshot()
    start = day or _next_business(snap.today)
    end = start + timedelta(days=1) if day else start + timedelta(days=3)
    items = {i.appointment_id: i.id for i in snap.open_items if i.appointment_id}
    rows: list[EligibilityRow] = []
    for appt in sorted(snap.of(Appointment), key=lambda a: a.start):
        if not start <= appt.start.date() <= end or appt.checkout_at is not None:
            continue
        cov = _primary(snap, appt.patient_id)
        provider = snap.providers[appt.provider_id]
        rows.append(
            EligibilityRow(
                appointment_id=appt.id,
                start=appt.start,
                patient=patient_ref(snap.patients[appt.patient_id]),
                provider_name=provider.name,
                payer=payer_ref(snap, cov.payer_key.value) if cov else None,
                planned=appt.planned_procedures,
                planned_fee_cents=sum(p.fee_cents for p in appt.planned_procedures),
                remaining_max_cents=cov.plan.remaining_max_cents if cov else None,
                status=appt.eligibility_status,
                note=appt.eligibility_note,
                inbox_item_id=items.get(appt.id),
            )
        )
    return EligibilityOut(
        date=start,
        rows=rows,
        need_human=sum(1 for r in rows if r.inbox_item_id),
        total=len(rows),
        by_day=_eligibility_days(rows, start, end),
    )


def _day(at: datetime) -> date:
    return to_practice_tz(at).date()


def _eligibility_days(rows: list[EligibilityRow], start: date, end: date) -> list[EligibilityDay]:
    """Every business day in [start, end] (an empty one reads "No appointments booked"), plus any day with rows."""
    days = {start + timedelta(days=n) for n in range((end - start).days + 1)}
    days = {d for d in days if is_business_day(d)} | {_day(r.start) for r in rows} | {start}
    out = []
    for d in sorted(days):
        of_day = [r for r in rows if _day(r.start) == d]
        n = {s: sum(1 for r in of_day if r.status is s) for s in EligibilityStatus}
        out.append(
            EligibilityDay(
                date=d,
                count=len(of_day),
                verified=n[EligibilityStatus.VERIFIED],
                issue=n[EligibilityStatus.ISSUE],
                unverified=n[EligibilityStatus.UNVERIFIED],
                checking=n[EligibilityStatus.CHECKING],
            )
        )
    return out


def _next_business(d: date) -> date:
    from torch_rcm.world.calendar import next_business_day

    return next_business_day(d)


def _primary(snap: Snapshot, patient_id: str) -> Coverage | None:
    return next(
        (c for c in snap.of(Coverage) if c.patient_id == patient_id and c.order is CoverageOrder.PRIMARY),
        None,
    )


def benefits(ctx: Ctx, appointment_id: str) -> BenefitsPanel:
    snap = ctx.snapshot()
    appt = next((a for a in snap.of(Appointment) if a.id == appointment_id), None)
    if appt is None:
        raise not_found("appointment", appointment_id)
    cov = _primary(snap, appt.patient_id)
    if cov is None:
        raise not_found("coverage for", appt.patient_id)
    est = next((e for e in snap.of(Estimate) if e.appointment_id == appt.id), None)
    item = next((i for i in snap.open_items if i.appointment_id == appt.id), None)
    freqs = []
    history = _last_done(snap, appt.patient_id)
    planned = list(dict.fromkeys(p.cdt for p in appt.planned_procedures))
    # planned codes first, then frequency-limited codes the PMS history shows (the card's "last done" rows)
    codes = planned + sorted(c for c in history if c in FREQUENCY_RULES and c not in planned)
    for cdt in codes:
        rule, months = FREQUENCY_RULES.get(cdt, ("no limit", 0))
        last = history.get(cdt)
        ok_from = _add_months(last, months) if last and months else None
        ok_from = ok_from if ok_from and ok_from > snap.today else None
        freqs.append(FrequencyRow(cdt=cdt, rule=rule, last_done=last, ok_from=ok_from))
    return BenefitsPanel(
        appointment_id=appt.id,
        patient=patient_ref(snap.patients[appt.patient_id]),
        coverage=coverage_out(cov),
        frequencies=freqs,
        planned=appt.planned_procedures,
        planned_fee_cents=sum(p.fee_cents for p in appt.planned_procedures),
        insurance_est_cents=est.insurance_est_cents if est else None,
        patient_est_cents=est.patient_est_cents if est else None,
        basis=f"as of {cov.verified_at:%m/%d %H:%M} · {cov.verified_via.value if cov.verified_via else 'intake'}"
        if cov.verified_at
        else "unverified",
        agent_note=item.recommendation if item else appt.eligibility_note,
        inbox_item_id=item.id if item else None,
    )


def _last_done(snap: Snapshot, patient_id: str) -> dict[str, date]:
    out: dict[str, date] = {}
    visits = {v.id for v in snap.of(Visit) if v.patient_id == patient_id}
    for proc in snap.of(ProcedureLine):
        if proc.visit_id in visits and (proc.cdt not in out or proc.dos > out[proc.cdt]):
            out[proc.cdt] = proc.dos
    return out


def _add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    return date(d.year + y, m + 1, min(d.day, 28))


# ── Denials ────────────────────────────────────────────────────────────────────────────────────────────────


def _denial_signer(snap: Snapshot, claim: Claim, role: str | None, items: list[InboxItem]) -> str | None:
    """Who signs the route's next step: the open item's named signer, else the route's own (`moves.claim_signer`:
    the treating dentist attests a formal appeal, the owner signs the rest), so the row says what the Inbox says."""
    named = next((u for i in items if (u := signer(snap, i)) is not None), None)
    if named is None and role is not None:
        named = claim_signer(snap, claim, clinical=role == "rendering_dentist")
    return named.name if named else None


def denials(ctx: Ctx) -> DenialsOut:
    snap = ctx.snapshot()
    items_by_claim = snap.open_items_by_claim
    groups: dict[NextAction, list[DenialRow]] = {}
    in_flight = []
    for claim in snap.of(Claim):
        if claim.closed_reason is not None or claim.denial is None:
            continue
        if claim.status is not S.DENIED:
            continue
        if claim.in_flight:
            in_flight.append(summarize(snap, claim, ctx.user.id))
        cov = snap.coverages[claim.coverage_id]
        route = route_denial(
            claim.denial.carc,
            claim.denial.rarc,
            root_cause=claim.denial.root_cause,
            payer=claim.payer_key,
            self_funded=cov.self_funded,
        )
        items = items_by_claim.get(claim.id, [])
        signer = _denial_signer(snap, claim, route.signer_role, items)
        groups.setdefault(route.next_action, []).append(
            DenialRow(
                claim=summarize(snap, claim, ctx.user.id),
                carc=claim.denial.carc,
                rarc=claim.denial.rarc,
                decoded=claim.denial.decoded,
                root_cause=claim.denial.root_cause,
                next_action=route.next_action,
                agent=route.agent,
                signer=signer,
                deadline=claim.deadline,
                patient_billable_if_lost=patient_billable_if_lost(claim.denial.carc, claim.payer_key),
                erisa=cov.self_funded,
                checklist=list(route.checklist),
                inbox_item_id=items[0].id if items else None,
            )
        )
    out = [
        DenialGroup(
            next_action=k,
            label=NEXT_ACTION_LABEL[k],
            count=len(rows),
            cents=sum(r.claim.billed_cents for r in rows),
            rows=sorted(rows, key=lambda r: r.claim.number),
        )
        for k, rows in sorted(groups.items(), key=lambda kv: list(NextAction).index(kv[0]))
    ]
    rows = [r for g in out for r in g.rows]
    return DenialsOut(groups=out, total=len(rows), in_flight=in_flight, matrix=denial_matrix(rows))


#: Payer × reason columns, in screen order. Plan limits (PR-*) are not denials of care and get no column.
DENIAL_REASONS: tuple[tuple[DenialReason, str], ...] = (
    ("doc", "Doc"),
    ("freq", "Freq"),
    ("cob", "COB"),
    ("tf", "TF"),
    ("med_nec", "Med. nec."),
    ("other", "Other"),
)
_CARC_REASON: dict[str, DenialReason] = {
    "CO-16": "doc",
    "CO-119": "freq",
    "CO-22": "cob",
    "CO-29": "tf",
    "CO-50": "med_nec",
}


def denial_reason(carc: str) -> DenialReason | None:
    """The matrix column for a CARC; None for a plan limit (PR-*), which the matrix leaves out."""
    if carc.startswith("PR-"):
        return None
    return _CARC_REASON.get(carc, "other")


def denial_matrix(rows: list[DenialRow]) -> DenialMatrix:
    """Count the worklist rows by payer × reason (the Denials side panel; the browser adds nothing)."""
    keys = [k for k, _ in DENIAL_REASONS]
    by_payer: dict[str, tuple[PayerRef, Counter[DenialReason]]] = {}
    totals: Counter[DenialReason] = Counter()
    excluded = 0
    for r in rows:
        reason = denial_reason(r.carc)
        if reason is None:
            excluded += 1
            continue
        payer = r.claim.payer
        by_payer.setdefault(payer.key, (payer, Counter()))[1][reason] += 1
        totals[reason] += 1
    payers = [
        DenialMatrixRow(
            payer=payer,
            cells=[DenialMatrixCell(reason=k, count=counts[k]) for k in keys],
            total=sum(counts.values()),
        )
        for payer, counts in by_payer.values()
    ]
    payers.sort(key=lambda p: (-p.total, p.payer.short_name))
    return DenialMatrix(
        columns=[DenialReasonColumn(key=k, label=label) for k, label in DENIAL_REASONS],
        payers=payers,
        totals=[DenialMatrixCell(reason=k, count=totals[k]) for k in keys],
        total=sum(totals.values()),
        excluded=excluded,
    )


# ── Remittances, patient balances ──────────────────────────────────────────────────────────────────────────


def remittances(ctx: Ctx) -> RemittanceList:
    rows = sorted(ctx.rt.store.all(Remittance), key=lambda r: r.received_at, reverse=True)
    return RemittanceList(items=rows, total=len(rows))


def remittance(ctx: Ctx, remittance_id: str) -> Remittance:
    row = ctx.rt.store.get(Remittance, remittance_id)
    if row is None:
        raise not_found("remittance", remittance_id)
    return row


def patient_balances(ctx: Ctx) -> PatientBalances:
    snap = ctx.snapshot()
    balances = C.patient_balances(snap)
    oldest = C.oldest_open_charge(snap)
    last_paid: dict[str, date] = {}
    for e in snap.of(PatientLedgerEntry):
        if (
            e.cents < 0
            and e.kind.value == "payment"
            and (e.patient_id not in last_paid or e.on > last_paid[e.patient_id])
        ):
            last_paid[e.patient_id] = e.on
    rows = []
    for pid, bal in balances.items():
        if bal == 0:
            continue
        since = oldest.get(pid)
        rows.append(
            PatientBalanceRow(
                patient=patient_ref(snap.patients[pid]),
                balance_cents=bal,
                oldest_dos=since,
                aging_bucket=age_bucket((snap.today - since).days) if since and bal > 0 else AGE_BUCKETS[0][0],
                last_payment_on=last_paid.get(pid),
                on_hold=bool(snap.holds_by_subject.get(pid)),
            )
        )
    rows.sort(key=lambda r: -r.balance_cents)
    ar, credits, n_credits = C.patient_ar(snap)
    return PatientBalances(items=rows, total=len(rows), ar_cents=ar, credits_cents=credits, credit_count=n_credits)


def inbox_item_for(snap: Snapshot, claim_id: str) -> InboxItem | None:
    items = snap.open_items_by_claim.get(claim_id, [])
    return items[0] if items else None
