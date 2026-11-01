"""Seed builder: creates entities with the money invariants held by construction.

Claim lines take the practice fee; `allowed_cents` comes from the coverage's plan schedule; remittance lines come
from the payer adjudication function, so `billed = paid + Σadj + patient` holds for every line ever created.
"""

from __future__ import annotations

import random
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta

from torch_rcm.clock import PRACTICE_TZ
from torch_rcm.domain.entities import (
    AckEvent,
    Advance,
    AppealRecord,
    Appointment,
    Attachment,
    AuditEvent,
    Claim,
    ClaimLine,
    Coverage,
    Entity,
    Estimate,
    Evidence,
    FileEntry,
    Hold,
    Image,
    InboxItem,
    Job,
    Location,
    Patient,
    PatientLedgerEntry,
    Payer,
    PayerClaim,
    Practice,
    ProcedureLine,
    Provider,
    RemitLine,
    Remittance,
    Rule,
    RuleChange,
    RuleProposal,
    Run,
    SavedView,
    Statement,
    User,
    Visit,
)
from torch_rcm.domain.enums import (
    AckStage,
    AttachmentKind,
    AttachmentSource,
    ClaimStatus,
    CoverageOrder,
    DepositStatus,
    LineMatch,
    PayerKey,
    RemitKind,
    RemitStatus,
)
from torch_rcm.domain.values import Denial, PlanBenefits
from torch_rcm.world.fees import CODES, PlanSchedule, ScheduleBook
from torch_rcm.world.payers.adjudicate import ClaimResult, LineIn, Outcome, adjudicate, decode
from torch_rcm.world.payers.profiles import profile


def dt(d: date, hhmm: str) -> datetime:
    hours, minutes = (int(x) for x in hhmm.split(":"))
    return datetime.combine(d, time(hours, minutes), tzinfo=PRACTICE_TZ)


@dataclass
class SeedWorld:
    """Everything the generator produced, grouped by entity type, ready to persist."""

    seed: int
    scenario: str
    now: datetime
    entities: dict[type[Entity], list[Entity]] = field(default_factory=lambda: defaultdict(list))
    schedules: ScheduleBook = field(default_factory=ScheduleBook)

    def add(self, *items: Entity) -> None:
        for item in items:
            self.entities[type(item)].append(item)

    def of[E: Entity](self, kind: type[E]) -> list[E]:
        return self.entities.get(kind, [])  # type: ignore[return-value]

    def index[E: Entity](self, kind: type[E]) -> dict[str, E]:
        return {e.id: e for e in self.of(kind)}

    def all(self) -> list[Entity]:
        return [e for items in self.entities.values() for e in items]


LineSpec = tuple[str, str | None] | tuple[str, str | None, str | None]
Lines = Sequence[LineSpec]


class Builder:
    def __init__(self, seed: int, scenario: str, now: datetime) -> None:
        self.w = SeedWorld(seed=seed, scenario=scenario, now=now)
        self.rng = random.Random(seed)
        self._visit_n: dict[str, int] = defaultdict(int)
        self._seq: dict[str, int] = defaultdict(int)

    # ── ids ────────────────────────────────────────────────────────────────────────────────────────────────

    def next_id(self, prefix: str) -> str:
        self._seq[prefix] += 1
        return f"{prefix}_{self._seq[prefix]:05d}"

    # ── people ─────────────────────────────────────────────────────────────────────────────────────────────

    def patient(self, pid: str, first: str, last: str, dob: date, location_id: str, contact: str = "text") -> Patient:
        p = Patient(id=pid, first=first, last=last, dob=dob, location_id=location_id, contact_pref=contact)  # type: ignore[arg-type]
        self.w.add(p)
        return p

    def coverage(
        self,
        patient: Patient,
        payer: PayerKey,
        *,
        schedule: str,
        subscriber_id: str,
        group_no: str,
        plan_name: str,
        order: CoverageOrder = CoverageOrder.PRIMARY,
        self_funded: bool = False,
        verified_at: datetime | None = None,
        plan: Mapping[str, object] | None = None,
        alternate_benefit: bool | None = None,
    ) -> Coverage:
        base: dict[str, object] = {
            "annual_max_cents": 150_000,
            "deductible_cents": 5_000,
            "deductible_met_cents": 5_000,
            "used_cents": 0,
            "pct_preventive": 100,
            "pct_basic": 80,
            "pct_major": 50,
            "fee_schedule": schedule,
        }
        if payer is PayerKey.NY_MEDICAID:
            base.update(
                annual_max_cents=10_000_000,
                deductible_cents=0,
                deductible_met_cents=0,
                pct_basic=100,
                pct_major=100,
            )
        base.update(plan or {})
        if alternate_benefit is not None:
            base["alternate_benefit"] = alternate_benefit
        suffix = "1" if order is CoverageOrder.PRIMARY else "2"
        cov = Coverage(
            id=f"cov_{patient.id.removeprefix('pat_')}_{suffix}",
            patient_id=patient.id,
            payer_key=payer,
            plan_name=plan_name,
            subscriber_id=subscriber_id,
            group_no=group_no,
            order=order,
            self_funded=self_funded,
            plan=PlanBenefits.model_validate(base),
            verified_at=verified_at,
            verified_via="portal" if verified_at else None,  # type: ignore[arg-type]
        )
        self.w.add(cov)
        return cov

    # ── visits ─────────────────────────────────────────────────────────────────────────────────────────────

    def visit(
        self,
        patient: Patient,
        dos: date,
        provider_id: str,
        lines: Lines,
        *,
        at: str = "10:00",
        note: str = "",
        signed_by: str | None = None,
        self_pay: bool = False,
        vid: str | None = None,
        location_id: str | None = None,
    ) -> tuple[Visit, list[ProcedureLine]]:
        last = patient.last.lower().replace(" ", "").replace("'", "")
        base = vid or f"vis_{dos:%m%d}_{last}"
        self._visit_n[base] += 1
        visit_id = base if self._visit_n[base] == 1 else f"{base}_{self._visit_n[base]}"
        completed = dt(dos, at) + timedelta(minutes=50)
        visit = Visit(
            id=visit_id,
            appointment_id=None,
            patient_id=patient.id,
            provider_id=provider_id,
            location_id=location_id or patient.location_id,
            dos=dos,
            completed_at=completed,
            note_text=note,
            note_signed_by=signed_by if signed_by is not None else provider_id,
            note_signed_at=completed if signed_by != "" else None,
            self_pay=self_pay,
        )
        procs = [
            ProcedureLine(
                id=f"pl_{visit_id.removeprefix('vis_')}_{i}",
                visit_id=visit_id,
                dos=dos,
                cdt=spec[0],
                tooth=spec[1],
                surface=spec[2] if len(spec) == 3 else None,
                fee_cents=CODES[spec[0]].fee_cents,
                provider_id=provider_id,
            )
            for i, spec in enumerate(lines, 1)
        ]
        self.w.add(visit, *procs)
        return visit, procs

    # ── claims ─────────────────────────────────────────────────────────────────────────────────────────────

    def schedule_for(self, coverage: Coverage) -> PlanSchedule:
        return self.w.schedules.get(coverage.plan.fee_schedule)

    def claim(
        self,
        number: int,
        visit: Visit,
        procs: list[ProcedureLine],
        coverage: Coverage,
        status: ClaimStatus,
        *,
        built_at: datetime | None = None,
        sent_at: datetime | None = None,
        secondary: bool = False,
        **fields: object,
    ) -> Claim:
        schedule = self.schedule_for(coverage)
        lines = [
            ClaimLine(
                id=f"cl_{number}_{i}",
                cdt=p.cdt,
                tooth=p.tooth,
                surface=p.surface,
                fee_cents=p.fee_cents,
                allowed_cents=min(schedule.allowed(p.cdt, p.fee_cents), p.fee_cents),
                procedure_line_id=p.id,
            )
            for i, p in enumerate(procs, 1)
        ]
        built = built_at or visit.completed_at + timedelta(minutes=3)
        payer = profile(coverage.payer_key)
        claim = Claim(
            id=f"clm_{number}",
            number=number,
            visit_id=visit.id,
            patient_id=visit.patient_id,
            coverage_id=coverage.id,
            payer_key=coverage.payer_key,
            provider_id=visit.provider_id,
            location_id=visit.location_id,
            status=status,
            dos=visit.dos,
            built_at=built,
            sent_at=sent_at,
            billed_cents=sum(line.fee_cents for line in lines),
            allowed_cents=sum(line.allowed_cents or 0 for line in lines),
            lines=lines,
            secondary=secondary,
            timely_filing_due=visit.dos + timedelta(days=payer.timely_filing_days),
            **fields,  # type: ignore[arg-type]
        )
        self.w.add(claim)
        return claim

    def attach(
        self,
        claim: Claim,
        kind: AttachmentKind,
        at: datetime,
        *,
        nea: str | None = None,
        source: AttachmentSource = AttachmentSource.PMS_IMAGING,
        image_id: str | None = None,
        note: str | None = None,
    ) -> Attachment:
        att = Attachment(
            id=f"att_{claim.number}_{len(claim.attachments) + 1}",
            kind=kind,
            nea_number=nea,
            source=source,
            image_id=image_id,
            created_at=at,
            note=note,
        )
        claim.attachments.append(att)
        return att

    def image(self, patient: Patient, kind: str, tooth: str | None, at: datetime, cdt: str | None) -> Image:
        img = Image(
            id=f"img_{patient.id.removeprefix('pat_')}_{at:%m%d}_{kind}{'_' + tooth if tooth else ''}",
            patient_id=patient.id,
            kind=kind,  # type: ignore[arg-type]
            tooth=tooth,
            taken_at=at,
            cdt=cdt,
        )
        self.w.add(img)
        return img

    # ── acknowledgements ───────────────────────────────────────────────────────────────────────────────────

    def ack(self, claim: Claim, stage: AckStage, at: datetime, message: str, code: str | None = None) -> AckEvent:
        event = AckEvent(
            id=f"ack_{claim.number}_{stage.value}_{at:%m%d%H%M}",
            claim_id=claim.id,
            stage=stage,
            code=code,
            message=message,
            at=at,
            source="payer" if stage.value.startswith("payer") else "vyne",
        )
        claim.ack_stage = stage
        self.w.add(event)
        return event

    def send(self, claim: Claim, file_time: datetime, *, payer_ack: datetime | None, icn: str | None) -> None:
        """The standard ack trail: the claim leaves in a file, 999 accepted, Vyne 277CA A1, payer 277CA A1."""
        claim.sent_at = file_time
        claim.file_time = file_time
        self.ack(claim, AckStage.FILE_999_OK, file_time + timedelta(minutes=2), "999 accepted (file level)")
        self.ack(claim, AckStage.CH_277CA_A1, file_time + timedelta(minutes=4), "Vyne 277CA A1: forwarded to payer")
        if payer_ack is not None:
            claim.icn = icn
            self.ack(claim, AckStage.PAYER_277CA_A1, payer_ack, f"Payer 277CA A1: accepted · ICN {icn}", "A1")

    # ── adjudication ───────────────────────────────────────────────────────────────────────────────────────

    def adjudicate(
        self,
        claim: Claim,
        coverage: Coverage,
        *,
        outcome: str | None = None,
        other_paid: dict[str, int] | None = None,
        alternate_benefit: bool | None = None,
    ) -> ClaimResult:
        return adjudicate(
            [LineIn(line.id, line.cdt, line.fee_cents, line.tooth) for line in claim.lines],
            payer=profile(coverage.payer_key),
            plan=coverage.plan,
            schedule=self.schedule_for(coverage),
            attachments=frozenset(a.kind.value for a in claim.attachments) | {"pa"},
            outcome=Outcome.parse(outcome) if outcome else None,
            alternate_benefit=alternate_benefit,
            other_paid=other_paid,
        )

    def apply(self, claim: Claim, result: ClaimResult, paid_at: datetime, root_cause: str = "payer") -> None:
        """Write an adjudication onto the claim (status, per-line money, denial)."""
        by_id = {line.line_id: line for line in result.lines}
        for line in claim.lines:
            out = by_id[line.id]
            line.paid_cents = out.paid
            line.adj = list(out.adj)
            line.patient_adj = list(out.patient_adj)
            line.patient_cents = out.patient_cents
        claim.status = result.status
        claim.paid_cents = result.paid
        claim.patient_resp_cents = result.patient
        claim.paid_at = paid_at
        if result.denial_carc:
            claim.denial = Denial(
                carc=result.denial_carc,
                rarc=result.denial_rarc,
                decoded=decode(result.denial_carc, result.denial_rarc),
                root_cause=root_cause,  # type: ignore[arg-type]
            )
            claim.reason_text = (
                f"{result.denial_carc} · {result.denial_rarc}" if result.denial_rarc else result.denial_carc
            )

    def remittance(
        self,
        rid: str,
        payer: PayerKey,
        received_at: datetime,
        items: list[tuple[Claim, ClaimResult]],
        *,
        kind: RemitKind = RemitKind.X835,
        deposit: DepositStatus = DepositStatus.DEPOSITED,
        status: RemitStatus = RemitStatus.AUTO_POSTED,
        held: dict[str, tuple[int, str]] | None = None,
        trace: str | None = None,
        check_number: str | None = None,
    ) -> Remittance:
        held = held or {}
        lines: list[RemitLine] = []
        for claim, result in items:
            for out in result.lines:
                variance = held.get(out.line_id)
                lines.append(
                    RemitLine(
                        id=f"rl_{rid.removeprefix('rem_')}_{len(lines) + 1}",
                        claim_id=claim.id,
                        claim_line_id=out.line_id,
                        cdt=out.cdt,
                        billed=out.billed,
                        allowed=out.allowed,
                        paid=out.paid,
                        adj=list(out.adj),
                        patient_adj=list(out.patient_adj),
                        patient_cents=out.patient_cents,
                        match=LineMatch.REVIEW if variance else LineMatch.AUTO,
                        variance_cents=variance[0] if variance else None,
                        rarc=out.rarc,
                        note=variance[1] if variance else None,
                    )
                )
        remit = Remittance(
            id=rid,
            payer_key=payer,
            kind=kind,
            trace=trace or f"{profile(payer).icn_prefix}{received_at:%y%m%d}{len(lines):03d}",
            amount_cents=sum(line.paid for line in lines),
            received_at=received_at,
            deposit_status=deposit,
            lines=lines,
            status=status,
            check_number=check_number,
        )
        self.w.add(remit)
        return remit


__all__ = [
    "Advance",
    "AppealRecord",
    "Appointment",
    "AuditEvent",
    "Builder",
    "Estimate",
    "Evidence",
    "FileEntry",
    "Hold",
    "InboxItem",
    "Job",
    "Location",
    "PatientLedgerEntry",
    "Payer",
    "PayerClaim",
    "Practice",
    "Provider",
    "Rule",
    "RuleChange",
    "RuleProposal",
    "Run",
    "SavedView",
    "SeedWorld",
    "Statement",
    "User",
    "dt",
]
