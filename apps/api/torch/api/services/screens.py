"""Static-screen reads: Today's claims, Activity, Eligibility, Cash, Denials, Remittances, Patient balances."""

from __future__ import annotations

from datetime import date, timedelta

from torch.api.errors import not_found
from torch.api.schemas import (
    ActivityOut,
    BenefitsPanel,
    CashOut,
    DenialGroup,
    DenialRow,
    DenialsOut,
    EligibilityOut,
    EligibilityRow,
    FrequencyRow,
    HeldRow,
    LedgerRow,
    LedgerToday,
    NotBillableRow,
    PatientBalanceRow,
    PatientBalances,
    RemittanceList,
    Strip,
)
from torch.api.services.claims import coverage_out
from torch.api.services.context import Ctx
from torch.domain.entities import (
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
from torch.domain.enums import AttachmentSource, ClaimStatus, CoverageOrder, FileEntryState, NextAction
from torch.domain.routing import patient_billable_if_lost, route_denial
from torch.readmodels import activity as A
from torch.readmodels import cash as C
from torch.readmodels.claims import AGE_BUCKETS, age_bucket, patient_ref, payer_ref, strip, summarize
from torch.readmodels.snapshot import Snapshot
from torch.world.calendar import FILE_TIMES, next_file_time
from torch.world.sim import EDIT_LOCK

S = ClaimStatus
NEXT_ACTION_LABEL = {
    NextAction.RECONSIDERATION: "Reconsideration · resend or inquiry, no signature",
    NextAction.CORRECTED: "Corrected claim / COB resubmit",
    NextAction.FORMAL_APPEAL: "Formal appeal · the rendering dentist signs",
    NextAction.BILL_PATIENT_LINK: "Bill patient · closes in Payments",
    NextAction.WRITE_OFF: "Write-off · Dr. Morgan",
}
NOT_BILLABLE_REASON = "no pocket depths charted for this quadrant · not billable (Torch never nudges documentation)"
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
            held.append(_held(snap, claim, holds[0]))
        elif claim.status is S.READY or any(
            e.state is FileEntryState.QUEUED for e in snap.file_entries_by_claim.get(claim.id, [])
        ):
            leaving.append(_ledger_row(snap, claim))
        else:
            sent.append(_ledger_row(snap, claim))
    for claim in snap.of(Claim):
        if claim.built_at.date() < today and claim.closed_reason is None:
            holds = snap.holds_by_subject.get(claim.id, [])
            if holds:
                held.append(_held(snap, claim, holds[0]))
            elif any(
                e.state is FileEntryState.QUEUED and e.file_time.date() == today
                for e in snap.file_entries_by_claim.get(claim.id, [])
            ):
                leaving.append(_ledger_row(snap, claim))
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
    return LedgerToday(
        date=today,
        sent=sent,
        leaving_next_file=leaving,
        held=sorted(held, key=lambda h: h.timely_days_left if h.timely_days_left is not None else 10**6),
        not_billable=not_billable,
        next_file_time=next_file_time(snap.now, FILE_TIMES),
        last_file_time=max(departed) if departed else None,
    )


def _entries(snap: Snapshot) -> list:  # type: ignore[type-arg]
    return [e for rows in snap.file_entries_by_claim.values() for e in rows]


def _ledger_row(snap: Snapshot, claim: Claim) -> LedgerRow:
    queued = [e for e in snap.file_entries_by_claim.get(claim.id, []) if e.state is FileEntryState.QUEUED]
    file_time = queued[0].file_time if queued else claim.file_time
    checks = claim.readiness or []
    return LedgerRow(
        claim=summarize(snap, claim),
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


def _held(snap: Snapshot, claim: Claim, hold) -> HeldRow:  # type: ignore[no-untyped-def]
    owner = snap.users.get(hold.owner_user_id or "")
    left = (hold.timely_due - snap.today).days if hold.timely_due else None
    return HeldRow(
        claim=summarize(snap, claim),
        hold=hold,
        timely_days_left=left,
        owner_name=owner.name if owner else None,
    )


# ── Activity, Cash ─────────────────────────────────────────────────────────────────────────────────────────


def activity(ctx: Ctx, day: date | None, agent: str | None, outcome: str | None) -> ActivityOut:
    return A.activity(ctx.snapshot(), day, agent, outcome)


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
    return EligibilityOut(date=start, rows=rows, need_human=sum(1 for r in rows if r.inbox_item_id))


def _next_business(d: date) -> date:
    from torch.world.calendar import next_business_day

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
            in_flight.append(summarize(snap, claim))
        cov = snap.coverages[claim.coverage_id]
        route = route_denial(
            claim.denial.carc,
            claim.denial.rarc,
            root_cause=claim.denial.root_cause,
            payer=claim.payer_key,
            self_funded=cov.self_funded,
        )
        signer = None
        if route.signer_role == "rendering_dentist":
            signer = snap.providers[claim.provider_id].name
        elif route.signer_role == "owner":
            signer = "Dr. Morgan"
        items = items_by_claim.get(claim.id, [])
        groups.setdefault(route.next_action, []).append(
            DenialRow(
                claim=summarize(snap, claim),
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
    return DenialsOut(groups=out, total=sum(g.count for g in out), in_flight=in_flight)


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
