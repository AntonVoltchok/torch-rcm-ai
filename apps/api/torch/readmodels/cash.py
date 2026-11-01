"""Owner KPIs (GET /cash): production, collections, A/R and days in A/R, each with its formula and basis."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from torch.api.schemas import AgentImpact, AgingBucket, Breakdown, CashOut, Kpi
from torch.domain.entities import AppealRecord, Claim, PatientLedgerEntry, ProcedureLine, Run
from torch.domain.enums import AppealKind, ClaimStatus, ClosedReason, LedgerEntryKind, RunStatus
from torch.readmodels.activity import week_decisions
from torch.readmodels.claims import AGE_BUCKETS, age_bucket, ar_aging, ar_by_payer, in_ar, paid_this_month
from torch.readmodels.snapshot import Snapshot

WINDOW_DAYS = 90
MINUTES_PER_ITEM_EST = 9  # Activity "hours saved" is an estimate, labelled as such


def month_start(today: date) -> date:
    return today.replace(day=1)


def window_start(today: date) -> date:
    return today - timedelta(days=WINDOW_DAYS - 1)  # 90 days of visits, today inclusive


def gross_production(snap: Snapshot, start: date, end: date) -> int:
    return sum(p.fee_cents for p in snap.of(ProcedureLine) if start <= p.dos <= end)


def contractual(snap: Snapshot, start: date, end: date) -> int:
    """Scheduled PPO write-offs by DOS: fee − contract allowed on every billed (primary, live) claim line."""
    total = 0
    for c in snap.of(Claim):
        if c.secondary or c.closed_reason is ClosedReason.SUPERSEDED or not start <= c.dos <= end:
            continue
        if c.closed_reason is ClosedReason.VOIDED:
            continue
        total += sum(line.fee_cents - (line.allowed_cents or 0) for line in c.lines)
    return total


def net_production(snap: Snapshot, start: date, end: date) -> int:
    return gross_production(snap, start, end) - contractual(snap, start, end)


def insurance_collections(snap: Snapshot, start: date, end: date) -> int:
    """Insurance paid on claims that closed as Paid in the period (04-seed composes collections from the
    "Paid · Oct" set; partial payments count when their claim closes — docs/plans/api-core.md D14)."""
    return sum(
        c.paid_cents or 0
        for c in snap.of(Claim)
        if c.status is ClaimStatus.PAID and c.paid_at and start <= c.paid_at.date() <= end
    )


def patient_collections(snap: Snapshot, start: date, end: date) -> int:
    return -sum(
        e.cents for e in snap.of(PatientLedgerEntry) if e.kind is LedgerEntryKind.PAYMENT and start <= e.on <= end
    )


def non_contractual_writeoffs(snap: Snapshot, start: date, end: date) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for c in snap.of(Claim):
        if c.closed_reason is ClosedReason.WRITE_OFF and c.closed_at and start <= c.closed_at.date() <= end:
            kind = (
                (c.denial.carc if c.denial else "other")
                .replace("CO-29", "timely filing")
                .replace("CO-50", "medical necessity")
            )
            out[kind] += c.writeoff_cents or 0
    for e in snap.of(PatientLedgerEntry):
        if e.kind is LedgerEntryKind.ADJUSTMENT and start <= e.on <= end:
            out["small patient balance"] += -e.cents
    return dict(out)


def patient_balances(snap: Snapshot) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for e in snap.of(PatientLedgerEntry):
        out[e.patient_id] += e.cents
    return dict(out)


def patient_ar(snap: Snapshot) -> tuple[int, int, int]:
    """(patient A/R cents, credit cents, credit count)."""
    balances = patient_balances(snap)
    positive = sum(v for v in balances.values() if v > 0)
    credits = [v for v in balances.values() if v < 0]
    return positive, -sum(credits), len(credits)


def oldest_open_charge(snap: Snapshot) -> dict[str, date]:
    """Age patient balances from DOS: the oldest charge not covered by payments (FIFO)."""
    charges: dict[str, list[PatientLedgerEntry]] = defaultdict(list)
    paid: dict[str, int] = defaultdict(int)
    for e in snap.of(PatientLedgerEntry):
        if e.cents > 0:
            charges[e.patient_id].append(e)
        else:
            paid[e.patient_id] += -e.cents
    out: dict[str, date] = {}
    for pid, rows in charges.items():
        remaining = paid[pid]
        for e in sorted(rows, key=lambda r: (r.dos or r.on, r.id)):
            if remaining >= e.cents:
                remaining -= e.cents
                continue
            out[pid] = e.dos or e.on
            break
    return out


def appeals_12mo(snap: Snapshot) -> dict[str, int]:
    since = snap.today - timedelta(days=365)
    rows = [a for a in snap.of(AppealRecord) if a.decided_on and a.decided_on >= since]
    recon = [a for a in rows if a.kind is AppealKind.RECONSIDERATION]
    formal = [a for a in rows if a.kind is AppealKind.FORMAL]
    return {
        "won": sum(1 for a in rows if a.won),
        "total": len(rows),
        "reconsideration_won": sum(1 for a in recon if a.won),
        "reconsideration_total": len(recon),
        "formal_won": sum(1 for a in formal if a.won),
        "formal_total": len(formal),
    }


def cash(snap: Snapshot) -> CashOut:
    today = snap.today
    m0, w0 = month_start(today), window_start(today)
    ar_cents = sum(c.billed_cents for c in snap.of(Claim) if in_ar(c))
    pat_ar, credits, _ = patient_ar(snap)
    net_90 = net_production(snap, w0, today)
    avg_daily = round(net_90 / WINDOW_DAYS)
    days_in_ar = round((ar_cents + pat_ar) / avg_daily) if avg_daily else 0
    gross_m, contr_m = gross_production(snap, m0, today), contractual(snap, m0, today)
    ins_m, pat_m = insurance_collections(snap, m0, today), patient_collections(snap, m0, today)
    collections_90 = insurance_collections(snap, w0, today) + patient_collections(snap, w0, today)
    ncr = collections_90 / net_90 * 100 if net_90 else 0.0
    paid_count = sum(1 for c in snap.of(Claim) if paid_this_month(c, today))
    writeoffs = non_contractual_writeoffs(snap, m0, today)
    kpis = [
        Kpi(
            key="days_in_ar",
            label="Days in A/R",
            value=days_in_ar,
            unit="days",
            formula="(insurance A/R + patient A/R) ÷ average daily net production (90 d)",
            basis=f"(${ar_cents / 100:,.0f} + ${pat_ar / 100:,.0f}) ÷ ${avg_daily / 100:,.0f}/day",
        ),
        Kpi(
            key="insurance_ar",
            label="Insurance A/R",
            value=ar_cents,
            unit="cents",
            formula="Σ billed of claims sent and not paid",
            basis=f"{sum(1 for c in snap.of(Claim) if in_ar(c))} claims",
        ),
        Kpi(
            key="patient_ar",
            label="Patient A/R",
            value=pat_ar,
            unit="cents",
            formula="Σ positive patient balances, aged from DOS",
            basis=f"credits ${credits / 100:,.2f} shown separately",
        ),
        Kpi(
            key="avg_daily_net_production",
            label="Avg daily net production",
            value=avg_daily,
            unit="cents",
            formula="net production (90 d) ÷ 90",
            basis=f"${net_90 / 100:,.0f} over 90 days",
        ),
        Kpi(
            key="gross_production_month",
            label=f"Gross production · {today:%b}",
            value=gross_m,
            unit="cents",
            formula="Σ fees of procedures by DOS this month",
            basis="practice fee schedule",
        ),
        Kpi(
            key="contractual_month",
            label=f"Contractual write-offs · {today:%b}",
            value=contr_m,
            unit="cents",
            formula="Σ (fee − contract allowed) by DOS",
            basis="plan contract schedules",
        ),
        Kpi(
            key="net_production_month",
            label=f"Net production · {today:%b}",
            value=gross_m - contr_m,
            unit="cents",
            formula="gross − contractual",
            basis="by DOS",
        ),
        Kpi(
            key="insurance_collections_month",
            label=f"Insurance paid · {today:%b}",
            value=ins_m,
            unit="cents",
            formula="Σ paid on 835s received this month",
            basis=f"{paid_count} claims paid",
        ),
        Kpi(
            key="patient_collections_month",
            label=f"Patient collections · {today:%b}",
            value=pat_m,
            unit="cents",
            formula="Σ patient payments this month",
            basis="checkout + statements",
        ),
        Kpi(
            key="collections_month",
            label=f"Collections · {today:%b}",
            value=ins_m + pat_m,
            unit="cents",
            formula="insurance paid + patient collections",
            basis="cash basis",
        ),
        Kpi(
            key="net_collection_rate",
            label="Net collection rate (90 d)",
            value=round(ncr, 1),
            unit="pct",
            formula="collections ÷ (production − contractual adjustments), 90 d",
            basis="cash vs. net production; lags payer latency",
        ),
        Kpi(
            key="non_contractual_month",
            label=f"Non-contractual write-offs · {today:%b}",
            value=sum(writeoffs.values()),
            unit="cents",
            formula="tier-3 write-offs + small-balance adjustments",
            basis="signed by Dr. Morgan",
        ),
    ]
    aging = ar_aging(snap)
    total_ar = sum(cents for _, cents in aging.values()) or 1
    by_provider: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for c in snap.of(Claim):
        if in_ar(c):
            row = by_provider[c.provider_id]
            row[0] += 1
            row[1] += c.billed_cents
    oldest = oldest_open_charge(snap)
    balances = patient_balances(snap)
    pat_aging: dict[str, list[int]] = {k: [0, 0] for k, _, _ in AGE_BUCKETS}
    for pid, bal in balances.items():
        if bal > 0:
            bucket = age_bucket((today - oldest.get(pid, today)).days)
            pat_aging[bucket][0] += 1
            pat_aging[bucket][1] += bal
    decisions = week_decisions(snap)
    auto = decisions["ran"]
    return CashOut(
        kpis=kpis,
        aging=[
            AgingBucket(bucket=k, count=n, cents=cents, pct=round(cents / total_ar * 100, 1))
            for k, (n, cents) in aging.items()
        ],
        by_payer=[
            Breakdown(key=k, label=snap.payers[k].short_name, count=n, cents=cents)
            for k, (n, cents) in sorted(ar_by_payer(snap).items(), key=lambda kv: -kv[1][1])
        ],
        by_provider=[
            Breakdown(key=k, label=snap.providers[k].name, count=n, cents=cents)
            for k, (n, cents) in sorted(by_provider.items(), key=lambda kv: -kv[1][1])
        ],
        writeoffs_by_type=[Breakdown(key=k, label=k, count=1, cents=v) for k, v in sorted(writeoffs.items())],
        patient_aging=[
            AgingBucket(bucket=k, count=n, cents=cents, pct=round(cents / (pat_ar or 1) * 100, 1))
            for k, (n, cents) in pat_aging.items()
        ],
        agent_impact=AgentImpact(
            items_auto=auto,
            items_to_you=decisions["to_dana"],
            hours_saved_est=Kpi(
                key="hours_saved",
                label="Hours saved (estimate)",
                value=round(auto * MINUTES_PER_ITEM_EST / 60, 1),
                unit="count",
                formula=f"items run without review × {MINUTES_PER_ITEM_EST} min",
                basis="estimate: median manual handling time from the 12-month approval log",
            ),
        ),
        appeals_12mo=appeals_12mo(snap),
    )


def running_runs(snap: Snapshot) -> int:
    return sum(1 for r in snap.of(Run) if r.status is RunStatus.RUNNING)
