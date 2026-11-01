"""The simulated world the agents act on: PMS, Vyne (clearinghouse), NEA (attachments) and one PayerSim per payer.

Each system is a thin class over the store. World events (files leaving, acks, 835s) are invoked by scheduler
handlers; agent-facing calls (reads, contacts, mutations) go through `CallLog.record`, so every call is evidence
and every mutation is idempotent by key.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from torch_rcm.clock import ClockLike
from torch_rcm.db.store import Store
from torch_rcm.domain.entities import (
    AckEvent,
    Appointment,
    Attachment,
    Claim,
    ClaimLine,
    Coverage,
    FileEntry,
    Image,
    PayerClaim,
    ProcedureLine,
    RemitLine,
    Remittance,
    Visit,
)
from torch_rcm.domain.enums import (
    AckStage,
    AttachmentKind,
    AttachmentSource,
    ClaimStatus,
    DepositStatus,
    FileEntryKind,
    FileEntryState,
    LineMatch,
    PayerKey,
    RemitKind,
    RemitStatus,
    RootCause,
    Tier,
)
from torch_rcm.domain.routing import denial_deadline
from torch_rcm.domain.transitions import Cause, apply_transition
from torch_rcm.domain.values import Denial
from torch_rcm.world.calendar import (
    FILE_TIMES,
    add_business_days,
    business_morning,
    next_business_day,
    next_file_time,
    next_weekday_on,
)
from torch_rcm.world.calllog import CallLog, WorldUnavailableError
from torch_rcm.world.fees import ScheduleBook
from torch_rcm.world.outages import Outages
from torch_rcm.world.payers.adjudicate import LineIn, Outcome, adjudicate, decode
from torch_rcm.world.payers.profiles import PROFILES, PayerProfile, profile
from torch_rcm.world.rng import keyed_chance, keyed_int

S = ClaimStatus
EDIT_LOCK = timedelta(seconds=60)  # edits lock 60 s before the file leaves (Engineering notes §6)


class HoldWindowClosedError(RuntimeError):
    def __init__(self, claim_id: str, left_at: datetime | None) -> None:
        super().__init__(f"{claim_id}: the file left at {left_at:%H:%M}" if left_at else f"{claim_id}: file departed")
        self.claim_id = claim_id
        self.left_at = left_at


@dataclass
class WorldEvent:
    """Something that happened in the world during a handler (reported in `events_fired`)."""

    kind: str
    summary: str
    data: dict[str, Any]


# ── PMS ───────────────────────────────────────────────────────────────────────────────────────────────────


class Pms:
    system = "pms"

    def __init__(self, store: Store, clock: ClockLike, calls: CallLog) -> None:
        self.store, self.clock, self.calls = store, clock, calls

    def get_visit(self, visit_id: str, *, run_id: str | None = None) -> dict[str, Any]:
        def read() -> dict[str, Any]:
            visit = self.store.require(Visit, visit_id)
            lines = self.store.find(ProcedureLine, {"visit_id": visit_id})
            return {
                "visit": visit.model_dump(mode="json"),
                "lines": [p.model_dump(mode="json") for p in lines],
            }

        return self.calls.record(self.system, "pms.get_visit", read, run_id=run_id, request={"visit_id": visit_id})

    def get_coverage(self, patient_id: str, *, run_id: str | None = None) -> dict[str, Any]:
        def read() -> dict[str, Any]:
            covs = self.store.find(Coverage, {"patient_id": patient_id})
            return {"coverages": [c.model_dump(mode="json") for c in covs]}

        return self.calls.record(
            self.system, "pms.get_coverage", read, run_id=run_id, request={"patient_id": patient_id}
        )

    def find_images(
        self,
        patient_id: str,
        on_or_before: date,
        kinds: list[str],
        tooth: str | None,
        *,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        def read() -> dict[str, Any]:
            images = [
                i
                for i in self.store.find(Image, {"patient_id": patient_id})
                if i.taken_at.date() <= on_or_before
                and (not kinds or i.kind.value in kinds)
                and (tooth is None or i.tooth in (tooth, None))
            ]
            return {
                "images": [i.model_dump(mode="json") for i in sorted(images, key=lambda i: i.taken_at, reverse=True)]
            }

        return self.calls.record(
            self.system,
            "pms.find_images",
            read,
            run_id=run_id,
            request={"patient_id": patient_id, "kinds": kinds, "tooth": tooth},
        )

    def checkout(self, appointment_id: str) -> Visit:
        """World event: the front desk checks the patient out; the PMS records the visit and its procedures."""
        appt = self.store.require(Appointment, appointment_id)
        visit_id = f"vis_{appt.start:%m%d}_{appt.patient_id.removeprefix('pat_').split('_')[0]}_co"
        existing = self.store.get(Visit, visit_id)
        if existing:
            return existing
        at = appt.checkout_at or self.clock.now()
        visit = Visit(
            id=visit_id,
            appointment_id=appt.id,
            patient_id=appt.patient_id,
            provider_id=appt.provider_id,
            location_id=appt.location_id,
            dos=appt.start.date(),
            completed_at=at,
            note_signed_by=appt.provider_id,
            note_signed_at=at,
        )
        procs = [
            ProcedureLine(
                id=f"pl_{visit_id.removeprefix('vis_')}_{i}",
                visit_id=visit_id,
                dos=visit.dos,
                cdt=p.cdt,
                tooth=p.tooth,
                fee_cents=p.fee_cents,
                provider_id=appt.provider_id,
            )
            for i, p in enumerate(appt.planned_procedures, 1)
        ]
        with self.store.tx():
            self.store.insert_many([visit, *procs])
        return visit


# ── NEA ───────────────────────────────────────────────────────────────────────────────────────────────────


class Nea:
    system = "nea"

    def __init__(self, store: Store, clock: ClockLike, calls: CallLog, seed: int) -> None:
        self.store, self.clock, self.calls, self.seed = store, clock, calls, seed

    def upload(self, claim_id: str, image_id: str, kind: str, *, key: str, run_id: str | None = None) -> dict[str, Any]:
        """Upload an image to NEA FastAttach and attach the NEA# to the claim. Idempotent by key."""

        def mutate() -> dict[str, Any]:
            nea = f"26-44{keyed_int(self.seed, 10_000, 99_999, 'nea', key):05d}"
            claim = self.store.require(Claim, claim_id)
            claim.attachments.append(
                Attachment(
                    id=f"att_{claim.number}_{len(claim.attachments) + 1}",
                    kind=AttachmentKind(kind),
                    nea_number=nea,
                    source=AttachmentSource.PMS_IMAGING,
                    image_id=image_id,
                    created_at=self.clock.now(),
                )
            )
            self.store.update(claim)
            return {"nea_number": nea, "image_id": image_id, "kind": kind}

        return self.calls.record(
            self.system,
            "nea.upload",
            mutate,
            key=key,
            run_id=run_id,
            claim_id=claim_id,
            mutation=True,
            request={"image_id": image_id, "kind": kind},
        )


# ── Vyne ──────────────────────────────────────────────────────────────────────────────────────────────────


class Vyne:
    system = "vyne"

    def __init__(self, store: Store, clock: ClockLike, calls: CallLog, seed: int) -> None:
        self.store, self.clock, self.calls, self.seed = store, clock, calls, seed

    def next_file_time(self, after: datetime | None = None) -> datetime:
        return next_file_time(after or self.clock.now(), FILE_TIMES)

    def queue(
        self,
        claim_id: str,
        kind: FileEntryKind,
        *,
        by: str,
        key: str,
        remarks: str | None = None,
        run_id: str | None = None,
    ) -> dict[str, Any]:
        """Queue a claim for its payer's next file. The hold window: until that file leaves (minus the edit lock)."""

        def mutate() -> dict[str, Any]:
            claim = self.store.require(Claim, claim_id)
            now = self.clock.now()
            file_time = self.next_file_time(now + EDIT_LOCK)
            entry = FileEntry(
                id=f"fe_{claim.number}_{file_time:%m%d%H%M}",
                claim_id=claim.id,
                payer_key=claim.payer_key,
                file_time=file_time,
                kind=kind,
                state=FileEntryState.QUEUED,
                queued_at=now,
                queued_by=by,
                remarks=remarks,
            )
            claim.file_time = file_time
            if kind is not FileEntryKind.ORIGINAL and claim.status is S.DENIED:
                claim.in_flight = (
                    f"{'resubmit' if kind is FileEntryKind.RESUBMIT else 'corrected'} queued · leaves {file_time:%H:%M}"
                )
            with self.store.tx():
                self.store.upsert(entry)
                self.store.update(claim)
            return {"file_entry_id": entry.id, "file_time": file_time.isoformat()}

        return self.calls.record(
            self.system,
            "vyne.queue",
            mutate,
            key=key,
            run_id=run_id,
            claim_id=claim_id,
            mutation=True,
            request={"kind": kind.value},
        )

    def editable_until(self, claim_id: str) -> datetime | None:
        queued = self.store.find(
            FileEntry, {"claim_id": claim_id, "state": FileEntryState.QUEUED}, order_by="file_time"
        )
        return queued[0].file_time - EDIT_LOCK if queued else None

    def assert_editable(self, claim_id: str) -> None:
        """Raise HoldWindowClosedError if the claim's latest file entry already departed."""
        entries = self.store.find(FileEntry, {"claim_id": claim_id}, order_by="-file_time", limit=1)
        if entries and entries[0].state is FileEntryState.DEPARTED:
            raise HoldWindowClosedError(claim_id, entries[0].departed_at)
        until = self.editable_until(claim_id)
        if until is not None and self.clock.now() >= until:
            raise HoldWindowClosedError(claim_id, until + EDIT_LOCK)

    def depart(self, file_time: datetime) -> list[WorldEvent]:
        """The file leaves: queued claims become Sent (resubmits of denied claims stay Denied, in flight);
        999 accepted. Returns events; the handler enqueues the clearinghouse acks."""
        entries = self.store.find(
            FileEntry,
            {"state": FileEntryState.QUEUED},
            sql="file_time <= ?",
            params=[file_time],
            order_by=["file_time"],
        )
        events: list[WorldEvent] = []
        for entry in entries:
            claim = self.store.require(Claim, entry.claim_id)
            with self.store.tx():
                entry.state, entry.departed_at = FileEntryState.DEPARTED, file_time
                self.store.update(entry)
                if claim.status in (S.READY, S.REJECTED):
                    claim.status = apply_transition(claim.status, S.SENT, Cause.FILE_DEPARTED, actor_tier=Tier.ONE)
                    claim.sent_at = file_time
                elif claim.status is S.DENIED:
                    claim.in_flight = f"{entry.kind.value} sent {file_time:%m/%d %H:%M} · awaiting reprocessing"
                claim.file_time = file_time
                self.store.update(claim)
                self.store.insert(
                    AckEvent(
                        id=f"ack_{claim.number}_999_{file_time:%m%d%H%M}",
                        claim_id=claim.id,
                        stage=AckStage.FILE_999_OK,
                        message=f"999 accepted (file level) · {entry.kind.value}",
                        at=file_time + timedelta(minutes=2),
                    )
                )
            events.append(
                WorldEvent(
                    "file_departed",
                    f"#{claim.number} left in the {file_time:%H:%M} {PROFILES[claim.payer_key].short_name} file",
                    {"claim_id": claim.id, "entry_kind": entry.kind.value},
                )
            )
        return events

    def clearinghouse_ack(self, claim_id: str, forced_code: str | None = None) -> WorldEvent:
        """Vyne 277CA: A1 forwards to the payer; A7 rejects (A7:164 subscriber id, A7:145 provider id)."""
        claim = self.store.require(Claim, claim_id)
        cov = self.store.require(Coverage, claim.coverage_id)
        code = forced_code or self._reject_code(claim, cov)
        at = self.clock.now()
        with self.store.tx():
            if code:
                self.store.insert(
                    AckEvent(
                        id=f"ack_{claim.number}_ch_{at:%m%d%H%M}",
                        claim_id=claim.id,
                        stage=AckStage.CH_277CA_A7,
                        code=code,
                        message=f"Vyne 277CA {code}",
                        at=at,
                    )
                )
                if claim.status is S.SENT:
                    claim.status = apply_transition(claim.status, S.REJECTED, Cause.CLEARINGHOUSE_REJECT)
                    claim.reason_text = {
                        "A7:164": "subscriber ID",
                        "A7:145": "rendering NPI",
                        "A7:85": "invalid tooth",
                    }.get(code, code)
                claim.ack_stage = AckStage.CH_277CA_A7
            else:
                self.store.insert(
                    AckEvent(
                        id=f"ack_{claim.number}_ch_{at:%m%d%H%M}",
                        claim_id=claim.id,
                        stage=AckStage.CH_277CA_A1,
                        message="Vyne 277CA A1: forwarded to payer",
                        at=at,
                    )
                )
                claim.ack_stage = AckStage.CH_277CA_A1
            self.store.update(claim)
        return WorldEvent(
            "clearinghouse_ack",
            f"#{claim.number} Vyne 277CA {code or 'A1'}",
            {"claim_id": claim.id, "code": code or "A1"},
        )

    def _reject_code(self, claim: Claim, cov: Coverage) -> str | None:
        prof = profile(claim.payer_key)
        if prof.subscriber_id_digits and not (
            cov.subscriber_id.isdigit() and len(cov.subscriber_id) == prof.subscriber_id_digits
        ):
            return "A7:164"
        return None


# ── payers ────────────────────────────────────────────────────────────────────────────────────────────────


class PayerSim:
    def __init__(
        self,
        key: PayerKey,
        store: Store,
        clock: ClockLike,
        calls: CallLog,
        outages: Outages,
        schedules: ScheduleBook,
        seed: int,
    ) -> None:
        self.key = key
        self.profile: PayerProfile = PROFILES[key]
        self.store, self.clock, self.calls, self.outages, self.schedules, self.seed = (
            store,
            clock,
            calls,
            outages,
            schedules,
            seed,
        )
        self.system = f"payer:{key.value}"

    # world events ─────────────────────────────────────────────────────────────────────────────────────────

    def ack(self, claim_id: str) -> WorldEvent:
        """Payer 277CA the next business morning: A1 assigns an ICN; a resubmission re-enters adjudication."""
        claim = self.store.require(Claim, claim_id)
        now = self.clock.now()
        existing = self.store.get(PayerClaim, claim.id)
        resubmit = claim.status is S.DENIED and existing is not None
        icn = claim.icn or self._icn(claim, now.date())
        latency = 7 if resubmit else keyed_int(self.seed, *self.profile.latency_bd, "latency", claim.id)
        pc = PayerClaim(
            id=claim.id,
            payer_key=claim.payer_key,
            icn=icn,
            received_on=now.date(),
            state="reprocessing" if resubmit else "received",
            adjudicate_on=add_business_days(now.date(), latency),
            outcome=None if resubmit else (existing.outcome if existing else None),
        )
        with self.store.tx():
            self.store.upsert(pc)
            self.store.insert(
                AckEvent(
                    id=f"ack_{claim.number}_payer_{now:%m%d%H%M}",
                    claim_id=claim.id,
                    stage=AckStage.PAYER_277CA_A1,
                    code="A1",
                    message=f"{self.profile.short_name} 277CA A1 · ICN {icn}"
                    + (" · resubmission received" if resubmit else ""),
                    at=now,
                    source="payer",
                )
            )
            if claim.status is S.SENT:
                claim.status = apply_transition(claim.status, S.ACCEPTED, Cause.PAYER_ACCEPT)
                claim.icn = icn
            claim.ack_stage = AckStage.PAYER_277CA_A1
            self.store.update(claim)
        return WorldEvent(
            "payer_ack",
            f"#{claim.number} {self.profile.short_name} 277CA A1 · ICN {icn}",
            {"claim_id": claim.id, "icn": icn, "resubmit": resubmit},
        )

    def in_process(self, claim_id: str) -> WorldEvent | None:
        claim = self.store.require(Claim, claim_id)
        if claim.status is not S.ACCEPTED:
            return None
        claim.status = apply_transition(claim.status, S.PENDING, Cause.PAYER_IN_PROCESS)
        self.store.update(claim)
        return WorldEvent(
            "payer_in_process",
            f"#{claim.number} in process at {self.profile.short_name}",
            {"claim_id": claim.id},
        )

    def due_for_era(self, day: date) -> list[PayerClaim]:
        rows = self.store.find(
            PayerClaim,
            {"payer_key": self.key, "state": ["received", "in_process", "in_review", "reprocessing"]},
        )
        return [pc for pc in rows if pc.adjudicate_on is not None and pc.adjudicate_on <= day]

    def era(self, day: date) -> Remittance | None:
        """Generate this payer's 835 for `day`: adjudicate every claim due, write a balanced remittance, and move
        each claim to paid / partial / denied (the payer's decision; posting is the practice's, D1)."""
        due = self.due_for_era(day)
        if not due:
            return None
        now = self.clock.now()
        rid = f"rem_{self.key.value.split('_')[0]}_{day:%m%d}"
        if self.store.get(Remittance, rid) is not None:
            return None
        lines: list[RemitLine] = []
        for pc in sorted(due, key=lambda p: p.id):
            lines.extend(self._adjudicate(pc, now, rid, len(lines)))
        remit = Remittance(
            id=rid,
            payer_key=self.key,
            kind=RemitKind.X835,
            trace=f"{self.profile.icn_prefix}{day:%y%m%d}{len(lines):03d}",
            amount_cents=sum(line.paid for line in lines),
            received_at=now,
            deposit_status=DepositStatus.EXPECTED,
            lines=lines,
            status=RemitStatus.NEEDS_REVIEW,
        )
        self.store.insert(remit)
        return remit

    def _adjudicate(self, pc: PayerClaim, now: datetime, rid: str, offset: int) -> list[RemitLine]:
        claim = self.store.require(Claim, pc.id)
        cov = self.store.require(Coverage, claim.coverage_id)
        result = adjudicate(
            [LineIn(line.id, line.cdt, line.fee_cents, line.tooth) for line in claim.lines],
            payer=self.profile,
            plan=cov.plan,
            schedule=self.schedules.get(cov.plan.fee_schedule),
            attachments=frozenset(a.kind.value for a in claim.attachments),
            outcome=Outcome.parse(pc.outcome) if pc.outcome else None,
        )
        by_id = {o.line_id: o for o in result.lines}
        new_lines: list[ClaimLine] = []
        for line in claim.lines:
            out = by_id[line.id]
            new_lines.append(
                line.model_copy(
                    update={
                        "paid_cents": out.paid,
                        "adj": list(out.adj),
                        "patient_adj": list(out.patient_adj),
                        "patient_cents": out.patient_cents,
                    }
                )
            )
        cause = Cause.APPEAL_DECIDED if claim.status is S.APPEALED else Cause.ADJUDICATED
        claim.status = apply_transition(claim.status, result.status, cause)
        claim.lines = new_lines
        claim.paid_cents, claim.patient_resp_cents, claim.paid_at = result.paid, result.patient, now
        claim.in_flight = None
        if result.denial_carc:
            claim.denial = Denial(
                carc=result.denial_carc,
                rarc=result.denial_rarc,
                decoded=decode(result.denial_carc, result.denial_rarc),
                root_cause=RootCause.PAYER,
            )
            claim.reason_text = (
                f"{result.denial_carc} · {result.denial_rarc}" if result.denial_rarc else result.denial_carc
            )
            claim.deadline = denial_deadline(
                result.denial_carc,
                result.denial_rarc,
                payer_short=self.profile.short_name,
                eob_on=now.date(),
                appeal_window_days=self.profile.appeal_window_days,
                self_funded=cov.self_funded,
                dos=claim.dos,
                refile=self._other_plan(claim),
            )
        else:
            claim.denial = None
            claim.reason_text = None
        pc.state = "adjudicated"
        with self.store.tx():
            self.store.update(claim)
            self.store.update(pc)
        return [
            RemitLine(
                id=f"rl_{rid.removeprefix('rem_')}_{offset + i}",
                claim_id=claim.id,
                claim_line_id=o.line_id,
                cdt=o.cdt,
                billed=o.billed,
                allowed=o.allowed,
                paid=o.paid,
                adj=list(o.adj),
                patient_adj=list(o.patient_adj),
                patient_cents=o.patient_cents,
                match=LineMatch.AUTO,
                rarc=o.rarc,
            )
            for i, o in enumerate(result.lines, 1)
        ]

    def _other_plan(self, claim: Claim) -> tuple[str, int] | None:
        """The patient's other coverage (a COB denial says it is primary): its payer and timely-filing days."""
        others = [c for c in self.store.find(Coverage, {"patient_id": claim.patient_id}) if c.id != claim.coverage_id]
        if not others:
            return None
        prof = PROFILES[others[0].payer_key]
        return prof.short_name, prof.timely_filing_days

    def _icn(self, claim: Claim, received: date) -> str:
        if self.key is PayerKey.DELTA_NY:
            return f"{received:%y}{received.timetuple().tm_yday:03d}-{(claim.number * 7919) % 1_000_000:06d}"
        return f"{self.profile.icn_prefix}{received:%y%m%d}{claim.number % 10_000:04d}"

    # agent-facing contact ─────────────────────────────────────────────────────────────────────────────────

    def _check_up(self, channel: str) -> None:
        now = self.clock.now()
        window = self.outages.window(f"{self.system}:{channel}", now)
        if window:
            raise WorldUnavailableError(f"{self.profile.short_name} {channel}", window[0], window[1])

    def check_status(self, claim_id: str, channel: str = "portal", *, run_id: str | None = None) -> dict[str, Any]:
        def read() -> dict[str, Any]:
            self._check_up(channel)
            claim = self.store.require(Claim, claim_id)
            pc = self.store.get(PayerClaim, claim_id)
            ref = self._reference("ref", claim_id, self.clock.now().isoformat())
            text = _status_text(claim, pc)
            return {
                "channel": channel,
                "status_text": text,
                "reference": ref,
                "icn": claim.icn,
                "captured_at": self.clock.now().isoformat(),
            }

        return self.calls.record(
            self.system,
            f"{channel}.check_status",
            read,
            run_id=run_id,
            claim_id=claim_id,
            request={"channel": channel},
        )

    def call_rep(
        self, claim_id: str, topic: str, asks: list[str], *, key: str, run_id: str | None = None
    ) -> dict[str, Any]:
        """A bounded rep call. The rep may offer things outside `may_agree_to`; the adapter never agrees to them
        and returns `requires_human` with the transcript (07-agents §5.2)."""
        may_agree = {
            "confirm_status",
            "confirm_records_received",
            "ask_attachment_requirements",
            "request_reprocessing",
            "request_835",
        }

        def contact() -> dict[str, Any]:
            self._check_up("ivr")
            claim = self.store.require(Claim, claim_id)
            ref = self._reference("rep", key)
            offered = "write it off and rebill" if keyed_chance(self.seed, 0.1, "offer", key) else None
            lines = [
                f"{self.clock.now():%H:%M} Rep: Thank you for calling {self.profile.name}. "
                f"Claim {claim.icn or claim.number}."
            ]
            lines += [f"Rep: {_rep_answer(a, claim)}" for a in asks if a in may_agree]
            if offered:
                lines.append(f"Rep: If you want, we can {offered}.")
                lines.append("Torch: I'll need to confirm with the practice.")
            return {
                "reference": ref,
                "transcript": "\n".join(lines),
                "agreed": [a for a in asks if a in may_agree],
                "requires_human": offered is not None,
                "offer": offered,
            }

        return self.calls.record(
            self.system,
            "call_rep",
            contact,
            key=key,
            run_id=run_id,
            claim_id=claim_id,
            mutation=False,
            request={"topic": topic, "asks": asks},
        )

    def receive_records(self, claim_id: str, *, key: str, run_id: str | None = None) -> dict[str, Any]:
        """Records / reconsideration received: the claim re-enters adjudication (denied → pending, in flight)."""

        def mutate() -> dict[str, Any]:
            claim = self.store.require(Claim, claim_id)
            pc = self.store.get(PayerClaim, claim_id)
            today = self.clock.now().date()
            if pc is not None:
                pc.state, pc.outcome, pc.adjudicate_on = "reprocessing", None, add_business_days(today, 7)
                self.store.update(pc)
            if claim.status is S.DENIED:
                claim.status = apply_transition(
                    claim.status, S.PENDING, Cause.RECONSIDERATION_SENT, actor_tier=Tier.ONE
                )
                claim.in_flight = f"records sent {today:%m/%d} · awaiting reprocessing"
                self.store.update(claim)
            return {
                "received": True,
                "expected_by": pc.adjudicate_on.isoformat() if pc and pc.adjudicate_on else None,
            }

        return self.calls.record(
            self.system, "receive_records", mutate, key=key, run_id=run_id, claim_id=claim_id, mutation=True
        )

    def _reference(self, *keys: str) -> str:
        """A call reference in the payer's style, e.g. DD-1027-88412 (deterministic per call)."""
        return (
            f"{self.profile.rep_call_prefix}-{self.clock.now():%m%d}-{keyed_int(self.seed, 10_000, 99_999, *keys):05d}"
        )

    def next_era_day(self, after: date) -> date:
        return next_weekday_on(after, self.profile.era_weekdays)

    def ack_time(self, sent: datetime) -> datetime:
        day = next_business_day(sent.date())
        return business_morning(day, keyed_int(self.seed, 5, 115, "ack", sent.isoformat()))


def _status_text(claim: Claim, pc: PayerClaim | None) -> str:
    if pc is not None and pc.portal_note:
        return pc.portal_note
    if claim.status is S.DENIED and claim.denial:
        return f"Denied · {claim.denial.carc}{' ' + claim.denial.rarc if claim.denial.rarc else ''} · paid $0.00"
    if claim.status in (S.PAID, S.PARTIAL):
        return f"Finalized · paid ${(claim.paid_cents or 0) / 100:,.2f}"
    if pc is None:
        return "No record of this claim."
    return f"In process · received {pc.received_on:%m/%d/%Y} · no additional information requested"


def _rep_answer(ask: str, claim: Claim) -> str:
    return {
        "confirm_status": f"The claim is {claim.status.value}.",
        "confirm_records_received": (
            "We have not received records yet; send them through FastAttach with the claim number."
        ),
        "ask_attachment_requirements": "For that code we need a periapical radiograph of the tooth.",
        "request_reprocessing": "I've sent it back for reprocessing; allow 7 to 10 business days.",
        "request_835": "I've requested the 835; it will come with the next ERA.",
    }[ask]


# ── the world ─────────────────────────────────────────────────────────────────────────────────────────────


class World:
    def __init__(self, store: Store, clock: ClockLike, schedules: ScheduleBook, seed: int) -> None:
        self.store, self.clock, self.seed = store, clock, seed
        self.calls = CallLog(store, clock)
        self.outages = Outages(store, seed)
        self.pms = Pms(store, clock, self.calls)
        self.nea = Nea(store, clock, self.calls, seed)
        self.vyne = Vyne(store, clock, self.calls, seed)
        self.payers = {key: PayerSim(key, store, clock, self.calls, self.outages, schedules, seed) for key in PayerKey}

    def payer(self, key: PayerKey | str) -> PayerSim:
        return self.payers[PayerKey(key)]
