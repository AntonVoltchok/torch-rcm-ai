"""Patient ledger: checkout charges (signed estimates, then 835 patient responsibility), payments, credits and
the October non-contractual write-offs, sized to the reconciled patient numbers.

Charges come from data: the patient share the payer adjudicated, or, before an 835, the share computed from the
contract allowed at checkout (what the signed estimate said). Payments are what the generator chooses: most
patients pay at checkout, some carry balances, a few overpaid (credits).
"""

from __future__ import annotations

import random
from collections import defaultdict
from datetime import date, timedelta

from torch_rcm.domain.entities import Claim, Coverage, Patient, PatientLedgerEntry, ProcedureLine, Visit
from torch_rcm.domain.enums import ClaimStatus, ClosedReason, LedgerEntryKind, RootCause
from torch_rcm.domain.values import Denial
from torch_rcm.seed import targets as T
from torch_rcm.seed.builder import Builder, dt
from torch_rcm.world.payers.adjudicate import LineIn, adjudicate
from torch_rcm.world.payers.profiles import profile

S = ClaimStatus
ADJUDICATED = (S.PAID, S.PARTIAL)


def estimate_patient_share(b: Builder, claim: Claim, coverage: Coverage) -> int:
    """The checkout estimate: adjudicate as if clean (no denial) with the plan as tracked at checkout."""
    result = adjudicate(
        [LineIn(line.id, line.cdt, line.fee_cents, line.tooth) for line in claim.lines],
        payer=profile(coverage.payer_key),
        plan=coverage.plan,
        schedule=b.schedule_for(coverage),
        attachments=frozenset({"pa"}),
    )
    return result.patient


class LedgerBuilder:
    def __init__(self, b: Builder) -> None:
        self.b = b
        self.rng = random.Random(b.w.seed * 13 + 5)
        self.entries: list[PatientLedgerEntry] = []

    def build(self) -> None:
        self.non_contractual_writeoffs()
        charges = self.charges()
        balances = self.target_balances(charges)
        self.payments(charges, balances)
        self.fix_october_payments()
        self.b.w.add(*self.entries)

    def entry(
        self,
        patient_id: str,
        kind: LedgerEntryKind,
        cents: int,
        on: date,
        *,
        claim_id: str | None = None,
        dos: date | None = None,
        memo: str = "",
    ) -> PatientLedgerEntry:
        e = PatientLedgerEntry(
            id=f"led_{len(self.entries) + 1:05d}",
            patient_id=patient_id,
            kind=kind,
            cents=cents,
            on=on,
            dos=dos,
            claim_id=claim_id,
            memo=memo,
        )
        self.entries.append(e)
        return e

    # ── charges ────────────────────────────────────────────────────────────────────────────────────────────

    def charges(self) -> dict[str, list[tuple[date, int, str | None]]]:
        coverages = self.b.w.index(Coverage)
        out: dict[str, list[tuple[date, int, str | None]]] = defaultdict(list)
        for e in self.entries:
            if e.kind is LedgerEntryKind.CHARGE:
                out[e.patient_id].append((e.on, e.cents, e.claim_id))
        for claim in self.b.w.of(Claim):
            if claim.secondary or claim.closed_reason is ClosedReason.SUPERSEDED or claim.dos < date(2026, 5, 1):
                continue
            cov = coverages[claim.coverage_id]
            share = (
                claim.patient_resp_cents if claim.status in ADJUDICATED else estimate_patient_share(self.b, claim, cov)
            )
            if share:
                memo = "patient share per 835" if claim.status in ADJUDICATED else "signed checkout estimate"
                self.entry(
                    claim.patient_id,
                    LedgerEntryKind.CHARGE,
                    share,
                    claim.dos,
                    claim_id=claim.id,
                    dos=claim.dos,
                    memo=memo,
                )
                out[claim.patient_id].append((claim.dos, share, claim.id))
        visits = self.b.w.index(Visit)
        self_pay: dict[str, int] = defaultdict(int)
        for proc in self.b.w.of(ProcedureLine):
            if visits[proc.visit_id].self_pay:
                self_pay[proc.visit_id] += proc.fee_cents
        for visit_id, cents in sorted(self_pay.items()):
            visit = visits[visit_id]
            self.entry(
                visit.patient_id,
                LedgerEntryKind.CHARGE,
                cents,
                visit.dos,
                dos=visit.dos,
                memo="self-pay services",
            )
            out[visit.patient_id].append((visit.dos, cents, None))
        return out

    # ── balances ───────────────────────────────────────────────────────────────────────────────────────────

    def target_balances(self, charges: dict[str, list[tuple[date, int, str | None]]]) -> dict[str, int]:
        rng = self.rng
        totals = {pid: sum(c for _, c, _ in rows) for pid, rows in charges.items()}
        eligible = sorted(pid for pid, total in totals.items() if total >= 8_000)
        rng.shuffle(eligible)
        holders = eligible[: max(40, len(eligible) // 3)]
        raw = {pid: totals[pid] * rng.uniform(0.2, 0.85) for pid in holders}
        scale = T.PATIENT_AR / sum(raw.values())
        balances = {pid: min(totals[pid], int(v * scale)) for pid, v in raw.items()}
        self._spread(balances, totals, T.PATIENT_AR, holders)
        creditors = [pid for pid in eligible[len(holders) :] if totals[pid] >= 5_000][:14]
        raw_c = {pid: rng.uniform(30, 400) for pid in creditors}
        scale_c = T.PATIENT_CREDITS / sum(raw_c.values())
        credits = {pid: int(v * scale_c) // 100 * 100 for pid, v in raw_c.items()}
        credits[creditors[0]] += T.PATIENT_CREDITS - sum(credits.values())
        balances.update({pid: -c for pid, c in credits.items()})
        return balances

    @staticmethod
    def _spread(balances: dict[str, int], caps: dict[str, int], target: int, order: list[str]) -> None:
        gap = target - sum(balances.values())
        for pid in order:
            if gap == 0:
                return
            room = caps[pid] - balances[pid] if gap > 0 else balances[pid] - 1
            step = max(-room, min(room, gap)) if gap < 0 else min(room, gap)
            balances[pid] += step
            gap -= step
        assert gap == 0, f"patient A/R short by {gap}"

    # ── payments ───────────────────────────────────────────────────────────────────────────────────────────

    def payments(self, charges: dict[str, list[tuple[date, int, str | None]]], balances: dict[str, int]) -> None:
        adjustments: dict[str, int] = defaultdict(int)
        for e in self.entries:
            if e.kind is LedgerEntryKind.ADJUSTMENT:
                adjustments[e.patient_id] += -e.cents
        for pid, rows in sorted(charges.items()):
            to_pay = sum(c for _, c, _ in rows) - balances.get(pid, 0) - adjustments[pid]
            for on, cents, claim_id in sorted(rows, key=lambda r: (r[0], r[2] or "")):
                if to_pay <= 0:
                    break
                pay = min(cents, to_pay)
                self.entry(pid, LedgerEntryKind.PAYMENT, -pay, on, claim_id=claim_id, memo="card at checkout")
                to_pay -= pay
            if to_pay > 0:  # credit balance: paid more than owed (estimate above the 835's patient share)
                last = max(on for on, _, _ in rows)
                self.entry(
                    pid,
                    LedgerEntryKind.PAYMENT,
                    -to_pay,
                    last,
                    memo="card at checkout · above the 835's patient share",
                )

    def fix_october_payments(self) -> None:
        """Hit October patient collections exactly by moving part of one payment across the month boundary
        (an installment that cleared on the 1st instead of the 30th)."""
        paid_oct = -sum(e.cents for e in self.entries if e.kind is LedgerEntryKind.PAYMENT and e.on >= T.MONTH_START)
        gap = T.PATIENT_COLLECTIONS_MONTH - paid_oct
        if gap == 0:
            return
        if gap > 0:
            source = [
                e
                for e in self.entries
                if e.kind is LedgerEntryKind.PAYMENT and date(2026, 9, 1) <= e.on < T.MONTH_START
            ]
            moved_to = T.MONTH_START
        else:
            source = [e for e in self.entries if e.kind is LedgerEntryKind.PAYMENT and e.on >= T.MONTH_START]
            moved_to = T.MONTH_START - timedelta(days=1)
        need = abs(gap)
        for e in sorted(source, key=lambda e: e.cents):
            if need == 0:
                break
            take = min(need, -e.cents)
            e.cents += take
            self.entry(
                e.patient_id,
                LedgerEntryKind.PAYMENT,
                -take,
                moved_to,
                claim_id=e.claim_id,
                memo="installment",
            )
            need -= take
        assert need == 0, f"cannot move {need} cents of patient payments"
        self.entries = [e for e in self.entries if e.cents != 0]

    # ── write-offs ─────────────────────────────────────────────────────────────────────────────────────────

    def non_contractual_writeoffs(self) -> None:
        """$876 in October: two denied claims written off by Dr. Morgan (tier 3) + small patient balances."""
        b = self.b
        patients = b.w.index(Patient)
        rows = [
            (
                4166,
                "D2393",
                "19",
                date(2026, 6, 2),
                "CO-29",
                "timely filing · no proof of receipt",
                date(2026, 10, 9),
            ),
            (
                4193,
                "D7210",
                "32",
                date(2026, 6, 12),
                "CO-50",
                "not medically necessary · appeal declined",
                date(2026, 10, 16),
            ),
        ]
        coverages = sorted(
            (c for c in b.w.of(Coverage) if c.plan.fee_schedule in ("delta_ppo", "cigna_dppo")),
            key=lambda c: c.id,
        )
        for (number, cdt, tooth, dos, carc, memo, closed_on), cov in zip(rows, coverages[40:42], strict=True):
            visit, procs = b.visit(patients[cov.patient_id], dos, "prv_morgan", [(cdt, tooth)], at="10:00")
            claim = b.claim(number, visit, procs, cov, S.DENIED, closed_reason=ClosedReason.WRITE_OFF)
            b.send(claim, dt(dos, "11:15"), payer_ack=dt(dos + timedelta(days=1), "06:40"), icn=f"WO{number}")
            claim.denial = Denial(carc=carc, rarc=None, decoded=memo, root_cause=RootCause.PAYER)
            claim.writeoff_cents = claim.billed_cents
            claim.paid_cents = 0
            claim.closed_at = dt(closed_on, "15:20")
            claim.reason_text = f"{carc} · written off by Dr. Morgan"
        small = [5_600, 7_200, 6_100, 6_700]  # $256 of small patient balances adjusted off in October
        others = sorted((c for c in b.w.of(Coverage) if c.payer_key.value in ("metlife", "aetna")), key=lambda c: c.id)
        for cov, cents, day in zip(others[10:14], small, (6, 13, 20, 27), strict=True):
            self.entry(cov.patient_id, LedgerEntryKind.CHARGE, cents, date(2026, 9, 2), memo="patient share per 835")
            self.entry(
                cov.patient_id,
                LedgerEntryKind.ADJUSTMENT,
                -cents,
                date(2026, 10, day),
                memo="small-balance write-off (non-contractual)",
            )


def build_ledger(b: Builder) -> None:
    LedgerBuilder(b).build()


NON_CONTRACTUAL_CLAIMS = 62_000
