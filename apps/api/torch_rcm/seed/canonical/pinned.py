"""The pinned claims of docs/spec/04-seed.md, built exactly as designed (ids, amounts, dates, acks, remits).

Everything here is hand-placed; torch_rcm/seed/canonical/generated.py fills the rest of the practice so the
reconciled totals hold. Tooth #19 on #4821 is deliberate (docs/plans/api-core.md D11).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from torch_rcm.domain.entities import (
    AppealRecord,
    Claim,
    Coverage,
    FileEntry,
    Hold,
    Patient,
    PayerClaim,
    ProcedureLine,
    Remittance,
    Visit,
)
from torch_rcm.domain.enums import (
    AckStage,
    AppealKind,
    AttachmentKind,
    AttachmentSource,
    ClaimStatus,
    ClosedReason,
    DeadlineKind,
    DepositStatus,
    FileEntryKind,
    FileEntryState,
    HoldReason,
    HoldSubject,
    PayerKey,
    RemitKind,
    RemitStatus,
)
from torch_rcm.domain.values import Deadline
from torch_rcm.seed.builder import Builder, LineSpec, dt
from torch_rcm.seed.canonical.people import PRV_BAPTISTE, PRV_COLE, PRV_LEE, PRV_MORGAN, USR_DANA, USR_LEE
from torch_rcm.world.fees import SCHEDULES
from torch_rcm.world.payers.adjudicate import ClaimResult

S = ClaimStatus
D, ML, CG, AE, GD = PayerKey.DELTA_NY, PayerKey.METLIFE, PayerKey.CIGNA, PayerKey.AETNA, PayerKey.GUARDIAN
TODAY = date(2026, 10, 28)

People = dict[str, tuple[Patient, Coverage]]


@dataclass
class Pinned:
    """Handles the later stages need (inbox items, runs, evidence, jobs)."""

    claims: dict[int, Claim] = field(default_factory=dict)
    remits: dict[str, Remittance] = field(default_factory=dict)
    results: dict[int, ClaimResult] = field(default_factory=dict)
    images: dict[str, str] = field(default_factory=dict)
    #: Claims queued for the next file at 10:40: claim id → file time.
    queued: dict[str, datetime] = field(default_factory=dict)


class PinnedBuilder:
    def __init__(self, b: Builder, people: People) -> None:
        self.b = b
        self.people = people
        self.out = Pinned()

    # ── helpers ────────────────────────────────────────────────────────────────────────────────────────────

    def pc(self, key: str) -> tuple[Patient, Coverage]:
        patient, cov = self.people[key]
        return patient, cov

    def make(
        self,
        number: int,
        key: str,
        dos: date,
        lines: list[LineSpec],
        status: ClaimStatus,
        *,
        provider: str = PRV_MORGAN,
        at: str = "10:00",
        visit_minutes: int = 50,
        coverage: Coverage | None = None,
        note: str = "",
        **fields: Any,
    ) -> Claim:
        patient, cov = self.pc(key)
        visit, procs = self.b.visit(patient, dos, provider, lines, at=at, minutes=visit_minutes, note=note)
        claim = self.b.claim(number, visit, procs, coverage or cov, status, **fields)
        self.out.claims[number] = claim
        return claim

    def sent(self, claim: Claim, file_time: datetime, payer_ack: datetime | None, icn: str | None) -> None:
        self.b.send(claim, file_time, payer_ack=payer_ack, icn=icn)

    def payer_claim(
        self,
        claim: Claim,
        received: date,
        adjudicate_on: date | None,
        *,
        state: str = "in_process",
        outcome: str | None = None,
        note: str | None = None,
        tooth_history: dict[str, str] | None = None,
    ) -> None:
        self.b.w.add(
            PayerClaim(
                id=claim.id,
                payer_key=claim.payer_key,
                icn=claim.icn or "",
                received_on=received,
                state=state,
                adjudicate_on=adjudicate_on,
                outcome=outcome,
                portal_note=note,
                tooth_history=tooth_history or {},
            )
        )

    def adjudicated(self, claim: Claim, result: ClaimResult, paid_at: datetime, root_cause: str = "payer") -> None:
        self.b.apply(claim, result, paid_at, root_cause)
        self.out.results[claim.number] = result
        self.b.w.add(
            PayerClaim(
                id=claim.id,
                payer_key=claim.payer_key,
                icn=claim.icn or "",
                received_on=(claim.sent_at or paid_at).date(),
                state="adjudicated",
                adjudicate_on=paid_at.date(),
            )
        )

    # ── the build ──────────────────────────────────────────────────────────────────────────────────────────

    def build(self) -> Pinned:
        self.delta_group()
        self.other_delta_denials()
        self.rejected()
        self.sent_today()
        self.ready_today()
        self.appealed()
        self.pending()
        self.partial_and_paid()
        self.cigna_era()
        self.appeal_history()
        return self.out

    def delta_group(self) -> None:
        """#4821 Owens + Grant + Diaz: CO-16·N29 because our Claims agent attached the BWX (root cause: ours)."""
        b = self.b
        owens, _ = self.pc("owens_k")
        pa = b.image(owens, "pa", "19", dt(date(2026, 10, 12), "10:41"), "D0220")
        bwx = b.image(owens, "bwx", None, dt(date(2026, 4, 14), "09:20"), "D0274")
        self.out.images.update(owens_pa=pa.id, owens_bwx=bwx.id)
        group: list[tuple[int, str, date, list[LineSpec], str, str, str, str, str]] = [
            (
                4821,
                "owens_k",
                date(2026, 10, 12),
                [("D2740", "19"), ("D2950", "19"), ("D0220", "19")],
                PRV_MORGAN,
                "09:50",
                "10:45",
                "26299-041833",
                "47720913",
            ),
            (
                4836,
                "grant_l",
                date(2026, 10, 14),
                [("D2750", "3"), ("D2950", "3")],
                PRV_LEE,
                "10:50",
                "11:45",
                "26288-052207",
                "47731154",
            ),
            (
                4840,
                "diaz_f",
                date(2026, 10, 19),
                [("D2740", "14"), ("D2950", "14"), ("D0140", None)],
                PRV_MORGAN,
                "13:20",
                "14:15",
                "26293-061947",
                "47748802",
            ),
        ]
        delta = b.w.schedules.get("delta_ppo")
        assert delta is SCHEDULES["delta_ppo"]
        items: list[tuple[Claim, ClaimResult]] = []
        for number, key, dos, lines, provider, at, file_hhmm, icn, nea in group:
            claim = self.make(
                number,
                key,
                dos,
                lines,
                S.DENIED,
                provider=provider,
                at=at,
                built_at=dt(dos, at) + timedelta(minutes=53),  # three minutes after the visit, as everywhere
            )
            patient, cov = self.pc(key)
            tooth = lines[0][1]
            if number != 4821:
                img = b.image(patient, "pa", tooth, dt(dos, at) + timedelta(minutes=40), "D0220")
                self.out.images[f"{key}_pa"] = img.id
            b.attach(
                claim,
                AttachmentKind.BWX,
                claim.built_at,
                nea=nea,
                source=AttachmentSource.AGENT,
                note="wrong image for a crown",
            )
            self.sent(claim, dt(dos, file_hhmm), dt(dos + timedelta(days=1), "06:52"), icn)
            result = b.adjudicate(claim, cov, outcome="CO-16:N29")
            self.adjudicated(claim, result, dt(date(2026, 10, 26), "05:40"), root_cause="ours")
            claim.deadline = Deadline(
                kind=DeadlineKind.APPEAL, due_on=date(2027, 4, 24), basis="Delta: 180 days from the 10/26 ERA"
            )
            items.append((claim, result))
        self.out.remits["delta_1026_denials"] = b.remittance(
            "rem_delta_1026", D, dt(date(2026, 10, 26), "05:40"), items, status=RemitStatus.AUTO_POSTED
        )

    def other_delta_denials(self) -> None:
        b = self.b
        webb = self.make(
            4733,
            "webb_j",
            date(2026, 9, 21),
            [("D2740", "30"), ("D2950", "30"), ("D0220", "30")],
            S.DENIED,
            at="09:00",
        )
        self.sent(webb, dt(date(2026, 9, 21), "10:15"), dt(date(2026, 9, 22), "06:40"), "26265-030412")
        _, webb_cov = self.pc("webb_j")
        r = b.adjudicate(webb, webb_cov, outcome="CO-119")
        self.adjudicated(webb, r, dt(date(2026, 10, 22), "05:35"))
        webb.deadline = Deadline(
            kind=DeadlineKind.APPEAL, due_on=date(2027, 4, 20), basis="Delta: 180 days from the 10/22 ERA"
        )
        webb.reason_text = "CO-119 · frequency"
        diaz = self.make(
            4611,
            "diaz_r",
            date(2026, 8, 7),
            [("D2740", "30"), ("D2950", "30"), ("D0220", "30")],
            S.DENIED,
            at="14:00",
        )
        self.sent(diaz, dt(date(2026, 8, 7), "14:45"), dt(date(2026, 8, 10), "06:31"), "26222-018840")
        _, diaz_cov = self.pc("diaz_r")
        r2 = b.adjudicate(diaz, diaz_cov)
        self.adjudicated(diaz, r2, dt(date(2026, 10, 22), "05:35"))
        diaz.reason_text = "PR-119 · max met"
        assert r2.status is S.DENIED and r2.patient == 101_200 and r2.contractual == 22_800
        self.out.remits["delta_1022"] = b.remittance(
            "rem_delta_1022", D, dt(date(2026, 10, 22), "05:35"), [(webb, r), (diaz, r2)]
        )

    def rejected(self) -> None:
        moreau = self.make(
            4851,
            "moreau_i",
            date(2026, 10, 27),
            [("D0150", None), ("D0210", None), ("D1110", None)],
            S.REJECTED,
            provider=PRV_LEE,
            at="15:00",
        )
        moreau.sent_at = moreau.file_time = dt(date(2026, 10, 27), "16:15")
        b = self.b
        b.ack(moreau, AckStage.FILE_999_OK, dt(date(2026, 10, 27), "16:17"), "999 accepted (file level)")
        b.ack(moreau, AckStage.CH_277CA_A1, dt(date(2026, 10, 27), "16:19"), "Vyne 277CA A1: forwarded to payer")
        b.ack(
            moreau,
            AckStage.PAYER_277CA_A7,
            dt(TODAY, "07:02"),
            "Cigna 277CA A7:164 — subscriber/insured not found",
            "A7:164",
        )
        moreau.reason_text = "subscriber ID"
        haddad = self.make(
            4854,
            "haddad_y",
            date(2026, 10, 27),
            [("D2392", "4", "MO"), ("D2150", "5", "DO")],
            S.REJECTED,
            provider=PRV_LEE,
            at="13:30",
        )
        haddad.sent_at = haddad.file_time = dt(date(2026, 10, 27), "14:45")
        b.ack(haddad, AckStage.FILE_999_OK, dt(date(2026, 10, 27), "14:47"), "999 accepted (file level)")
        b.ack(
            haddad,
            AckStage.CH_277CA_A7,
            dt(date(2026, 10, 27), "14:49"),
            "Vyne 277CA A7:145 — rendering provider NPI missing",
            "A7:145",
        )
        haddad.reason_text = "rendering NPI"
        # The Claims agent fixed the NPI from the PMS provider record at 07:02 (tier 1, ran without review);
        # the corrected claim waits for the 10:45 MetLife file.
        self.queue(haddad, dt(TODAY, "10:45"), FileEntryKind.RESUBMIT, dt(TODAY, "07:02"), "run_claims_haddad_npi")

    def queue(
        self,
        claim: Claim,
        file_time: datetime,
        kind: FileEntryKind,
        at: datetime,
        by: str,
        remarks: str | None = None,
    ) -> FileEntry:
        entry = FileEntry(
            id=f"fe_{claim.number}_{file_time:%m%d%H%M}",
            claim_id=claim.id,
            payer_key=claim.payer_key,
            file_time=file_time,
            kind=kind,
            state=FileEntryState.QUEUED,
            queued_at=at,
            queued_by=by,
            remarks=remarks,
        )
        self.b.w.add(entry)
        claim.file_time = file_time
        self.out.queued[claim.id] = file_time
        return entry

    def sent_today(self) -> None:
        b = self.b
        rows: list[tuple[int, str, list[LineSpec], str, str, str]] = [
            (
                4857,
                "okafor_p",
                [("D0120", None), ("D0274", None), ("D1110", None), ("D0220", "30")],
                PRV_COLE,
                "08:30",
                "09:45",
            ),
            (
                4864,
                "russo_a",
                [("D0120", None), ("D0274", None), ("D1110", None)],
                PRV_BAPTISTE,
                "08:30",
                "09:45",
            ),
            (4860, "iqbal_h", [("D0150", None), ("D0210", None), ("D1110", None)], PRV_LEE, "08:30", "10:15"),
            (4866, "brennan_s", [("D2392", "3", "MO")], PRV_MORGAN, "09:00", "10:15"),
            (4863, "ortega_j", [("D4341", None)], PRV_COLE, "09:00", "10:15"),
        ]
        for number, key, lines, provider, at, file_hhmm in rows:
            claim = self.make(number, key, TODAY, lines, S.SENT, provider=provider, at=at)
            claim.sent_at = claim.file_time = dt(TODAY, file_hhmm)
            if number == 4860:
                b.ack(claim, AckStage.FILE_999_OK, dt(TODAY, "09:47"), "999 accepted (file level)")
                b.ack(
                    claim,
                    AckStage.CH_277CA_A7,
                    dt(TODAY, "09:49"),
                    "Vyne 277CA A7:164 — subscriber id must be 9 digits",
                    "A7:164",
                )
                b.ack(
                    claim,
                    AckStage.FILE_999_OK,
                    dt(TODAY, "10:17"),
                    "999 accepted (file level) · resent with the PMS subscriber id",
                )
                b.ack(claim, AckStage.CH_277CA_A1, dt(TODAY, "10:19"), "Vyne 277CA A1: forwarded to payer")
                continue
            ft = claim.sent_at
            b.ack(claim, AckStage.FILE_999_OK, ft + timedelta(minutes=2), "999 accepted (file level)")
            b.ack(claim, AckStage.CH_277CA_A1, ft + timedelta(minutes=4), "Vyne 277CA A1: forwarded to payer")
        ortega = self.out.claims[4863]
        ortega.lines[0].surface = "LR"
        ortega.reason_text = "LR only · UR not billable (no pocket depths charted)"
        # Ortega's UR quadrant was performed but is not billable: a procedure line with no claim line.
        visit_id = ortega.visit_id or ""
        b.w.add(
            ProcedureLine(
                id=f"pl_{visit_id.removeprefix('vis_')}_ur",
                visit_id=visit_id,
                dos=TODAY,
                cdt="D4341",
                quadrant="UR",
                fee_cents=24_000,
                provider_id=PRV_COLE,
            )
        )
        self.out.claims[4864].reason_text = "D0274 will deny PR-frequency · acknowledgment on file 03/11"
        self.out.claims[4866].reason_text = "alternate benefit expected · pt est $71.60"

    def ready_today(self) -> None:
        b = self.b
        owens, _ = self.pc("owens_k")
        pa30 = b.image(owens, "pa", "30", dt(TODAY, "10:31"), "D0220")
        self.out.images["owens_pa30"] = pa30.id
        o = self.make(
            4859,
            "owens_k",
            TODAY,
            [("D2740", "30"), ("D2950", "30"), ("D0220", "30")],
            S.READY,
            at="10:00",
            visit_minutes=35,
            built_at=dt(TODAY, "10:38"),
        )
        b.attach(o, AttachmentKind.PA, dt(TODAY, "10:38"), nea="26-4471982", image_id=pa30.id)
        b.attach(
            o,
            AttachmentKind.NARRATIVE,
            dt(TODAY, "10:38"),
            source=AttachmentSource.AGENT,
            note="buildup narrative · agent-written · tier 2 rule (Delta × crowns, signed 09/14)",
        )
        self.queue(o, dt(TODAY, "10:45"), FileEntryKind.ORIGINAL, dt(TODAY, "10:38"), "run_claims_owens_4859")
        novak = self.make(
            4855,
            "novak_e",
            TODAY,
            [("D3320", "13")],
            S.READY,
            provider=PRV_LEE,
            at="09:15",
            built_at=dt(TODAY, "10:21"),
        )
        self.queue(novak, dt(TODAY, "10:45"), FileEntryKind.ORIGINAL, dt(TODAY, "10:21"), "run_claims_novak_4855")
        tran = self.make(
            4856,
            "tran_b",
            TODAY,
            [("D0150", None), ("D0210", None), ("D1110", None)],
            S.READY,
            provider=PRV_BAPTISTE,
            at="09:30",
            built_at=dt(TODAY, "10:31"),
        )
        self.queue(tran, dt(TODAY, "10:45"), FileEntryKind.ORIGINAL, dt(TODAY, "10:31"), "run_claims_tran_4856")

        # Akers: primary Delta #4841 is pending; the Guardian secondary #4842 waits for Delta's EOB.
        akers, akers_primary = self.pc("akers_d")
        secondary_cov = next(c for c in b.w.of(Coverage) if c.patient_id == akers.id and c.order.value == "secondary")
        visit, procs = b.visit(
            akers,
            date(2026, 10, 22),
            PRV_COLE,
            [("D0120", None), ("D1110", None), ("D0274", None)],
            at="11:00",
        )
        primary = b.claim(4841, visit, procs, akers_primary, S.PENDING)
        self.out.claims[4841] = primary
        self.sent(primary, dt(date(2026, 10, 22), "12:15"), dt(date(2026, 10, 23), "06:44"), "26296-077120")
        self.payer_claim(primary, date(2026, 10, 23), date(2026, 11, 12))
        secondary = b.claim(4842, visit, procs, secondary_cov, S.READY, secondary=True, parent_claim_id=primary.id)
        self.out.claims[4842] = secondary
        self.hold(
            secondary,
            HoldReason.AWAITING_PRIMARY_EOB,
            "Secondary waits for Delta's 835 on #4841 (accepted 10/23)",
            dt(date(2026, 10, 22), "11:53"),
            "Delta 835 for #4841 posted",
            USR_DANA,
            date(2027, 4, 20),
        )

        nwosu = self.make(
            4847,
            "nwosu_f",
            date(2026, 10, 27),
            [("D0120", None), ("D1110", None), ("D0274", None)],
            S.READY,
            provider=PRV_COLE,
            at="10:30",
        )
        self.hold(
            nwosu,
            HoldReason.OTHER_DOCUMENTED,
            "No payer ID on file for the plan administrator (TPA)",
            dt(date(2026, 10, 27), "11:24"),
            "TPA payer ID confirmed · paper claim 11/04 if none",
            USR_DANA,
            date(2027, 1, 25),
        )
        marsh = self.make(
            4849,
            "marsh_l",
            date(2026, 10, 27),
            [("D4910", None), ("D0330", None)],
            S.READY,
            provider=PRV_BAPTISTE,
            at="15:00",
        )
        marsh_visit = b.w.index(Visit)[marsh.visit_id or ""]
        marsh_visit.note_signed_by = None
        marsh_visit.note_signed_at = None
        self.hold(
            marsh,
            HoldReason.NOTE_UNSIGNED,
            "Perio maintenance note not signed by the supervising dentist",
            dt(date(2026, 10, 27), "16:10"),
            "Note signed in the PMS",
            USR_LEE,
            date(2027, 4, 25),
        )
        for claim in (secondary, nwosu, marsh):
            claim.reason_text = "held"

    def hold(
        self,
        claim: Claim,
        reason: HoldReason,
        detail: str,
        since: datetime,
        clears: str,
        owner: str,
        timely: date,
    ) -> None:
        self.b.w.add(
            Hold(
                id=f"hld_{claim.number}",
                subject=HoldSubject.CLAIM,
                subject_id=claim.id,
                reason=reason,
                detail=detail,
                held_since=since,
                clears_when=clears,
                owner_user_id=owner,
                timely_due=timely,
            )
        )

    def appealed(self) -> None:
        rows: list[tuple[int, str, date, list[LineSpec], str, date]] = [
            (
                4562,
                "ruiz_e",
                date(2026, 7, 22),
                [("D2393", "30", "MOD"), ("D2394", "31", "MODL"), ("D2392", "29", "DO"), ("D0220", "30")],
                "CO-50",
                date(2026, 9, 30),
            ),
            (
                4651,
                "lund_k",
                date(2026, 8, 18),
                [("D2140", "19", "O"), ("D2150", "20", "MO")],
                "CO-16",
                date(2026, 10, 6),
            ),
            (
                4716,
                "varga_m",
                date(2026, 9, 8),
                [("D2392", "3", "MO"), ("D2392", "14", "DO"), ("D0140", None), ("D0220", "14")],
                "CO-119",
                date(2026, 10, 15),
            ),
        ]
        for number, key, dos, lines, carc, filed in rows:
            claim = self.make(number, key, dos, lines, S.APPEALED, provider=PRV_LEE if number == 4651 else PRV_MORGAN)
            prefix = {AE: "AE", GD: "GD", CG: "CG"}[claim.payer_key]
            self.sent(
                claim,
                dt(dos, "15:45"),
                dt(dos + timedelta(days=1 if dos.weekday() < 4 else 3), "06:50"),
                f"{prefix}{dos:%y%m%d}{number}",
            )
            claim.reason_text = f"{carc} · formal appeal filed {filed:%m/%d}"
            claim.in_flight = f"appeal level 1 filed {filed:%m/%d}"
            claim.deadline = Deadline(
                kind=DeadlineKind.APPEAL,
                due_on=filed + timedelta(days=30),
                basis="payer decision due 30 days from filing",
            )
            self.payer_claim(claim, dos, None, state="appeal_review")

    def pending(self) -> None:
        b = self.b
        brooks = self.make(4705, "brooks_t", date(2026, 8, 24), [("D3330", "3")], S.PENDING, at="15:30")
        self.sent(brooks, dt(date(2026, 8, 25), "07:45"), dt(date(2026, 8, 26), "06:38"), "ML2608260417")
        brooks.reason_text = "clean · no RFI"
        self.payer_claim(
            brooks,
            date(2026, 8, 26),
            None,
            state="stuck",
            note="In process. No additional information requested.",
        )

        ito = self.make(
            4796,
            "ito_l",
            date(2026, 10, 9),
            [("D4341", None), ("D4341", None)],
            S.PENDING,
            provider=PRV_LEE,
            at="09:00",
        )
        ito.lines[0].surface, ito.lines[1].surface = "UR", "UL"
        self.sent(ito, dt(date(2026, 10, 9), "10:15"), dt(date(2026, 10, 12), "06:47"), "GD2610120931")
        self.payer_claim(
            ito,
            date(2026, 10, 12),
            date(2026, 10, 29),
            outcome="CO-50:N10",
            note="Consultant review: chart shows fewer than 4 teeth with ≥ 4 mm pockets in UL.",
        )
        castillo = self.make(
            4797,
            "castillo_a",
            date(2026, 10, 9),
            [("D4341", None), ("D4342", None)],
            S.PENDING,
            provider=PRV_LEE,
            at="11:00",
        )
        castillo.lines[0].surface, castillo.lines[1].surface = "LR", "LL"
        self.sent(castillo, dt(date(2026, 10, 9), "11:45"), dt(date(2026, 10, 12), "06:49"), "GD2610120944")
        self.payer_claim(castillo, date(2026, 10, 12), date(2026, 10, 29), outcome="CO-16:M127")
        fmx = b.image(self.pc("castillo_a")[0], "fmx", None, dt(date(2026, 10, 9), "11:10"), "D0210")
        b.image(self.pc("castillo_a")[0], "perio_chart", None, dt(date(2026, 10, 9), "11:20"), None)
        # Root cause ours: the Claims agent sent the FMX where Guardian's rule names the perio chart, so the
        # overnight CO-16·M127 records request is held for Dana (decisions log: `ours` never auto-runs).
        b.attach(
            castillo,
            AttachmentKind.FMX,
            dt(date(2026, 10, 9), "11:40"),
            nea="26-4469307",
            source=AttachmentSource.AGENT,
            image_id=fmx.id,
            note="wrong chart: Guardian requires the perio chart for D4341/D4342",
        )

        morris = self.make(
            3561, "morris_g", date(2025, 10, 30), [("D2740", "3"), ("D2950", "3")], S.PENDING, at="10:00"
        )
        self.sent(morris, dt(date(2025, 11, 3), "08:15"), dt(date(2025, 11, 4), "06:41"), "ML2511040118")
        morris.reason_text = "payer reprocessing after lost claim"
        self.payer_claim(
            morris,
            date(2025, 11, 4),
            date(2026, 10, 29),
            outcome="CO-29",
            note="Payer has no record of the 11/2025 submission.",
        )
        moreno = self.make(
            4800,
            "moreno_s",
            date(2026, 10, 13),
            [("D2393", "30", "MOD"), ("D0220", "30")],
            S.PENDING,
            at="14:00",
        )
        self.sent(moreno, dt(date(2026, 10, 13), "14:45"), dt(date(2026, 10, 14), "06:55"), "AE2610140552")
        self.payer_claim(moreno, date(2026, 10, 14), date(2026, 10, 29), outcome="CO-22")

        hale = self.make(
            4744,
            "hale_p",
            date(2026, 9, 16),
            [("D6240", "14"), ("D6750", "13"), ("D6750", "15")],
            S.PENDING,
            at="09:00",
        )
        self.sent(hale, dt(date(2026, 9, 16), "10:15"), dt(date(2026, 9, 17), "06:36"), "ML2609170266")
        hale.reason_text = "pended for information"
        self.payer_claim(
            hale,
            date(2026, 9, 17),
            None,
            state="pended",
            note=(
                "Correspondence 10/22: Please provide the date of extraction of tooth #14 and indicate whether this is an "
                "initial placement or a replacement prosthesis."
            ),
        )
        hale_p, _ = self.pc("hale_p")
        b.visit(
            hale_p,
            date(2019, 3, 2),
            PRV_MORGAN,
            [("D7140", "14")],
            at="09:30",
            note="Extraction #14, non-restorable fracture. Patient informed of replacement options.",
        )
        # PMS history behind tomorrow's frequency rows (Eligibility › benefits: last done / OK from).
        chen_j, _ = self.pc("chen_j")
        b.visit(chen_j, date(2024, 3, 12), PRV_LEE, [("D4341", None)], at="09:00", note="SRP UR.")
        b.visit(chen_j, date(2025, 11, 3), PRV_MORGAN, [("D0274", None)], at="09:00", note="4BWX.")
        b.visit(chen_j, date(2026, 4, 14), PRV_MORGAN, [("D1110", None)], at="09:00", note="Prophy.")
        kim_s, _ = self.pc("kim_s")
        b.visit(kim_s, date(2025, 11, 3), PRV_MORGAN, [("D0274", None)], at="10:00", note="4BWX.")
        b.visit(kim_s, date(2026, 5, 2), PRV_MORGAN, [("D1110", None)], at="10:00", note="Prophy.")
        nak = self.make(4709, "nakamura_r", date(2026, 9, 4), [("D2950", "3"), ("D2740", "3")], S.PENDING, at="13:00")
        self.sent(nak, dt(date(2026, 9, 4), "13:45"), dt(date(2026, 9, 8), "06:44"), "CG2609080381")
        nak.reason_text = "in review with consultant"
        self.payer_claim(
            nak,
            date(2026, 9, 8),
            None,
            state="consultant_review",
            note="In review with the dental consultant; x-rays received; narrative illegible, please resend.",
        )
        obrien = self.make(
            4731, "obrien_t", date(2026, 9, 11), [("D7210", "17")], S.PENDING, provider=PRV_LEE, at="10:00"
        )
        self.sent(obrien, dt(date(2026, 9, 11), "10:45"), dt(date(2026, 9, 14), "06:52"), "GD2609140717")
        obrien.reason_text = "adjusted per portal · no 835"
        self.payer_claim(
            obrien,
            date(2026, 9, 14),
            None,
            state="adjudicated_no_835",
            note="Claim adjusted — see EOB 10/20.",
        )

    def partial_and_paid(self) -> None:  # noqa: PLR0915 - pinned records, written out in full
        b = self.b
        # Kaur: original #4768 superseded by a corrected claim (frequency 7), now partial.
        kaur_p, kaur_cov = self.pc("kaur_p")
        visit, procs = b.visit(
            kaur_p, date(2026, 10, 5), PRV_MORGAN, [("D2393", "3", "MOD"), ("D0220", "3")], at="10:00"
        )
        original = b.claim(4768, visit, procs, kaur_cov, S.REJECTED, closed_reason=ClosedReason.SUPERSEDED)
        original.lines[0].tooth = "2"
        self.sent(original, dt(date(2026, 10, 5), "10:45"), None, None)
        original.closed_at = dt(date(2026, 10, 20), "09:10")
        corrected = b.claim(4795, visit, procs, kaur_cov, S.PARTIAL, parent_claim_id=original.id, frequency_code=7)
        self.out.claims[4768], self.out.claims[4795] = original, corrected
        self.sent(corrected, dt(date(2026, 10, 20), "09:45"), dt(date(2026, 10, 21), "06:39"), "AE2610210133")
        r = b.adjudicate(corrected, kaur_cov, outcome="CO-119@D0220")
        assert r.status is S.PARTIAL
        self.adjudicated(corrected, r, dt(date(2026, 10, 26), "05:50"))
        corrected.reason_text = "D0220 CO-119 · frequency"

        osei = self.make(4748, "osei_l", date(2026, 10, 20), [("D2392", "14", "DO")], S.PAID)
        self.sent(osei, dt(date(2026, 10, 20), "10:45"), dt(date(2026, 10, 21), "06:41"), "AE2610210140")
        _, osei_cov = self.pc("osei_l")
        ro = b.adjudicate(osei, osei_cov)
        assert ro.lines[0].patient_adj[0].code == "186" and ro.lines[0].patient_adj[0].cents == 3_800
        self.adjudicated(osei, ro, dt(date(2026, 10, 26), "05:50"))
        osei.reason_text = "alt. benefit D2150"
        self.out.remits["aetna_1026"] = b.remittance(
            "rem_aetna_1026", AE, dt(date(2026, 10, 26), "05:50"), [(corrected, r), (osei, ro)]
        )

        duarte = self.make(4790, "duarte_m", date(2026, 10, 7), [("D2392", "19", "MO")], S.PAID, at="11:00")
        self.sent(duarte, dt(date(2026, 10, 7), "11:45"), dt(date(2026, 10, 8), "06:40"), "CG2610080219")
        _, duarte_cov = self.pc("duarte_m")
        rd = b.adjudicate(duarte, duarte_cov)
        self.adjudicated(duarte, rd, dt(date(2026, 10, 21), "06:05"))
        duarte.reason_text = "alt. benefit D2150 · not appealable"
        self.out.remits["cigna_1021"] = b.remittance(
            "rem_cigna_1021", CG, dt(date(2026, 10, 21), "06:05"), [(duarte, rd)]
        )

        # Abara: MetLife primary pays 50% after the $50 deductible; Cigna secondary pays the rest (OA-23).
        abara, abara_ml = self.pc("abara_w")
        abara_cg = next(c for c in b.w.of(Coverage) if c.patient_id == abara.id and c.order.value == "secondary")
        visit, procs = b.visit(abara, date(2026, 10, 6), PRV_COLE, [("D4341", None)], at="13:00")
        primary = b.claim(4775, visit, procs, abara_ml, S.PAID)
        primary.lines[0].surface = "UR"
        self.out.claims[4775] = primary
        self.sent(primary, dt(date(2026, 10, 6), "14:15"), dt(date(2026, 10, 7), "06:35"), "ML2610070221")
        rp = b.adjudicate(primary, abara_ml)
        assert rp.paid == 8_280
        self.adjudicated(primary, rp, dt(date(2026, 10, 22), "05:45"))
        self.out.remits["metlife_1022"] = b.remittance(
            "rem_metlife_1022", ML, dt(date(2026, 10, 22), "05:45"), [(primary, rp)]
        )
        secondary = b.claim(4776, visit, procs, abara_cg, S.PAID, secondary=True, parent_claim_id=primary.id)
        secondary.lines[0].surface = "UR"
        self.out.claims[4776] = secondary
        self.sent(secondary, dt(date(2026, 10, 22), "09:45"), dt(date(2026, 10, 23), "06:40"), "CG2610230115")
        rs = b.adjudicate(secondary, abara_cg, other_paid={secondary.lines[0].id: rp.paid})
        assert rs.paid == 13_120 and rs.patient == 0
        self.adjudicated(secondary, rs, dt(date(2026, 10, 28), "06:20"))

        foster = self.make(4772, "foster_d", date(2026, 10, 16), [("D2392", "19", "MO")], S.PARTIAL, at="14:00")
        self.sent(foster, dt(date(2026, 10, 16), "14:45"), dt(date(2026, 10, 19), "06:44"), "CG2610190302")
        _, foster_cov = self.pc("foster_d")
        rf = b.adjudicate(foster, foster_cov, outcome="PR-1=3200")
        assert rf.status is S.PARTIAL and rf.paid == 10_880
        self.adjudicated(foster, rf, dt(date(2026, 10, 28), "06:20"))
        foster.reason_text = "underpaid $32 · PR-1 though deductible met 05/12"
        self.out.results[4776], self.out.results[4772] = rs, rf

    def cigna_era(self) -> None:
        """Cigna ERA Wed 10/28 06:20: 12 lines on 7 claims (Foster held, Abara secondary, five clean claims)."""
        b = self.b
        from torch_rcm.world.fees import PlanSchedule

        group = b.w.schedules.get("cigna_dppo").with_explicit(
            "cigna_dppo_3352207",
            {
                "D0150": 7_600,
                "D0210": 10_500,
                "D0140": 6_000,
                "D0220": 1_600,
                "D2391": 13_800,
                "D2392": 16_800,
            },
        )
        assert isinstance(group, PlanSchedule)
        b.w.schedules.register(group)
        clean: list[tuple[str, str, str, int, list[LineSpec], date]] = [
            ("pat_lowe_g", "Grace", "Lowe", 4778, [("D0150", None), ("D0210", None)], date(2026, 10, 13)),
            (
                "pat_ferreira_a",
                "Andre",
                "Ferreira",
                4781,
                [("D0150", None), ("D0210", None)],
                date(2026, 10, 14),
            ),
            ("pat_quinn_m", "Maeve", "Quinn", 4783, [("D0140", None), ("D0220", "19")], date(2026, 10, 14)),
            (
                "pat_sato_k",
                "Kenji",
                "Sato",
                4786,
                [("D2391", "29", "O"), ("D0220", "29")],
                date(2026, 10, 15),
            ),
            (
                "pat_bello_o",
                "Ola",
                "Bello",
                4788,
                [("D2392", "13", "DO"), ("D0220", "13")],
                date(2026, 10, 15),
            ),
        ]
        items: list[tuple[Claim, ClaimResult]] = []
        for pid, first, last, number, lines, dos in clean:
            patient = b.patient(
                pid, first, last, date(1980 + number % 17, 1 + number % 12, 1 + number % 27), "loc_downtown"
            )
            cov = b.coverage(
                patient,
                CG,
                schedule="cigna_dppo_3352207",
                subscriber_id=f"U5{number}0{number % 97:02d}",
                group_no="3352207",
                plan_name="Cigna DPPO",
                alternate_benefit=False,
            )
            visit, procs = b.visit(
                patient, dos, PRV_MORGAN if lines[0][0].startswith("D23") else PRV_COLE, lines, at="10:00"
            )
            claim = b.claim(number, visit, procs, cov, S.PAID)
            self.out.claims[number] = claim
            self.sent(claim, dt(dos, "10:45"), dt(dos + timedelta(days=1), "06:42"), f"CG{dos:%y%m%d}{number}")
            result = b.adjudicate(claim, cov)
            self.adjudicated(claim, result, dt(date(2026, 10, 28), "06:20"))
            items.append((claim, result))
        foster, abara = self.out.claims[4772], self.out.claims[4776]
        items.append((foster, self.out.results[4772]))
        items.append((abara, self.out.results[4776]))
        remit = b.remittance(
            "rem_cigna_1028",
            CG,
            dt(date(2026, 10, 28), "06:20"),
            items,
            status=RemitStatus.NEEDS_REVIEW,
            held={
                foster.lines[0].id: (
                    3_200,
                    "PR-1 $32 applied though the deductible was met 05/12 → hold for reprocessing, not write-off",
                )
            },
        )
        self.out.remits["cigna_1028"] = remit
        totals = {
            "lines": len(remit.lines),
            "claims": len({line.claim_id for line in remit.lines}),
            "billed": sum(line.billed for line in remit.lines),
            "allowed": sum(line.allowed for line in remit.lines),
            "co45": sum(a.cents for line in remit.lines for a in line.adj if a.code == "45"),
            "pr1": sum(a.cents for line in remit.lines for a in line.patient_adj if a.code == "1"),
            "pr2": sum(a.cents for line in remit.lines for a in line.patient_adj if a.code == "2"),
            "paid": remit.amount_cents,
        }
        expected = {
            "lines": 12,
            "claims": 7,
            "billed": 175_500,
            "allowed": 115_800,
            "co45": 59_700,
            "pr1": 3_200,
            "pr2": 8_840,
            "paid": 95_480,
        }
        assert totals == expected, totals

        # Guardian paper check #208841 ($640, not yet deposited) and the $212 EFT with no 835 (#4731).
        lund_like: list[tuple[str, str, str, int, list[LineSpec], date]] = [
            (
                "pat_haas_r",
                "Rita",
                "Haas",
                4724,
                [("D2392", "12", "MO"), ("D2392", "5", "DO")],
                date(2026, 9, 24),
            )
        ]
        paper: list[tuple[Claim, ClaimResult]] = []
        for pid, first, last, number, lines, dos in lund_like:
            patient = b.patient(pid, first, last, date(1966, 4, 9), "loc_riverside")
            cov = b.coverage(
                patient,
                GD,
                schedule="guardian_ppo",
                subscriber_id="552193809",
                group_no="00981",
                plan_name="Guardian DentalGuard Preferred",
                self_funded=True,
            )
            visit, procs = b.visit(patient, dos, PRV_MORGAN, lines, at="10:00")
            claim = b.claim(number, visit, procs, cov, S.PAID)
            self.out.claims[number] = claim
            self.sent(claim, dt(dos, "10:45"), dt(dos + timedelta(days=1), "06:51"), f"GD{dos:%y%m%d}{number}")
            result = b.adjudicate(claim, cov)
            self.adjudicated(claim, result, dt(date(2026, 10, 27), "11:30"))
            paper.append((claim, result))
        self.out.remits["guardian_check"] = b.remittance(
            "rem_guardian_208841",
            GD,
            dt(date(2026, 10, 27), "11:30"),
            paper,
            kind=RemitKind.PAPER_EOB,
            deposit=DepositStatus.NOT_DEPOSITED,
            status=RemitStatus.NEEDS_REVIEW,
            trace="CHK208841",
            check_number="208841",
        )
        self.b.w.add(
            Remittance(
                id="rem_guardian_eft_212",
                payer_key=GD,
                kind=RemitKind.X835,
                trace="GRD2610200212",
                amount_cents=21_200,
                received_at=dt(date(2026, 10, 20), "09:00"),
                deposit_status=DepositStatus.DEPOSITED,
                lines=[],
                status=RemitStatus.UNMATCHED,
            )
        )

    def appeal_history(self) -> None:
        rows = [
            (4102, D, AppealKind.RECONSIDERATION, date(2025, 12, 3), date(2026, 1, 9), True, 98_000),
            (4188, ML, AppealKind.RECONSIDERATION, date(2026, 2, 11), date(2026, 3, 20), True, 31_500),
            (4251, CG, AppealKind.RECONSIDERATION, date(2026, 3, 17), date(2026, 4, 22), True, 25_500),
            (4302, D, AppealKind.RECONSIDERATION, date(2026, 5, 5), date(2026, 6, 2), False, 109_000),
            (4377, AE, AppealKind.RECONSIDERATION, date(2026, 6, 9), date(2026, 7, 14), True, 41_000),
            (4410, D, AppealKind.RECONSIDERATION, date(2026, 7, 7), date(2026, 8, 11), True, 24_000),
            (4214, GD, AppealKind.FORMAL, date(2026, 1, 20), date(2026, 3, 30), False, 48_000),
            (4330, AE, AppealKind.FORMAL, date(2026, 4, 2), date(2026, 6, 15), True, 115_000),
            (4459, GD, AppealKind.FORMAL, date(2026, 6, 23), date(2026, 9, 8), False, 48_000),
        ]
        for number, payer, kind, filed, decided, won, cents in rows:
            self.b.w.add(
                AppealRecord(
                    id=f"apl_{number}",
                    claim_number=number,
                    payer_key=payer,
                    kind=kind,
                    filed_on=filed,
                    decided_on=decided,
                    won=won,
                    cents=cents,
                )
            )


def build_pinned(b: Builder, people: People) -> Pinned:
    return PinnedBuilder(b, people).build()
