"""The generated part of the practice: patients, open A/R claims, three months of paid history and self-pay
production, sized so the reconciled numbers in torch_rcm/seed/targets.py come out exactly.

Two stages: *plan* (decide every claim's patient, dates, lines and adjudication) and *materialize* (assign claim
numbers in build order from the free number pool and create the entities, acks, payer state and remittances).
"""

from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from torch_rcm.domain.entities import Claim, ClaimLine, Coverage, Patient, PayerClaim, ProcedureLine, Remittance, Visit
from torch_rcm.domain.enums import AR_STATUSES, ClaimStatus, PayerKey
from torch_rcm.seed import targets as T
from torch_rcm.seed.builder import Builder, dt
from torch_rcm.seed.canonical.people import DENTISTS, HYGIENISTS, LOC_DOWNTOWN, LOC_RIVERSIDE
from torch_rcm.seed.canonical.pinned import Pinned
from torch_rcm.seed.fit import INSURED_KINDS, Composer, Slot, fit_amounts
from torch_rcm.world.calendar import FILE_TIMES, add_business_days, is_business_day, next_business_day
from torch_rcm.world.fees import CODES, Category, PlanSchedule, category
from torch_rcm.world.payers.adjudicate import ClaimResult
from torch_rcm.world.payers.profiles import PROFILES, profile

S = ClaimStatus
D, ML, CG, AE, GD, MD = (
    PayerKey.DELTA_NY,
    PayerKey.METLIFE,
    PayerKey.CIGNA,
    PayerKey.AETNA,
    PayerKey.GUARDIAN,
    PayerKey.NY_MEDICAID,
)
AR_PAYERS = (D, ML, CG, AE, GD)
PAYER_WEIGHTS = {D: 0.34, ML: 0.2, CG: 0.17, AE: 0.14, GD: 0.11, MD: 0.04}
SCHEDULE_OF = {
    D: "delta_ppo",
    ML: "metlife_pdp",
    CG: "cigna_dppo",
    AE: "aetna_dmo",
    GD: "guardian_ppo",
    MD: "medicaid_ny",
}
PLAN_NAME = {
    D: "Delta Dental PPO",
    ML: "MetLife PDP Plus",
    CG: "Cigna DPPO",
    AE: "Aetna Dental PPO (ASO)",
    GD: "Guardian DentalGuard Preferred",
    MD: "NY Medicaid (eMedNY)",
}

FIRST = [
    "Aaron",
    "Abby",
    "Adele",
    "Ahmed",
    "Aiko",
    "Alana",
    "Alba",
    "Alden",
    "Alix",
    "Amara",
    "Amir",
    "Anders",
    "Anika",
    "Ansel",
    "Arlo",
    "Asha",
    "Aspen",
    "Astrid",
    "Aurelio",
    "Avery",
    "Basil",
    "Beatrix",
    "Bennett",
    "Bianca",
    "Bodhi",
    "Bram",
    "Brielle",
    "Caius",
    "Calla",
    "Camden",
    "Carina",
    "Cassius",
    "Celeste",
    "Cillian",
    "Clio",
    "Colm",
    "Cosima",
    "Dalia",
    "Damon",
    "Darian",
    "Delphine",
    "Desmond",
    "Dion",
    "Doran",
    "Edda",
    "Eamon",
    "Elio",
    "Elodie",
    "Emrys",
    "Enzo",
    "Esme",
    "Ezra",
    "Fable",
    "Faye",
    "Fenn",
    "Fiona",
    "Flint",
    "Freya",
    "Gael",
    "Gemma",
    "Gideon",
    "Greer",
    "Gus",
    "Hadley",
    "Halle",
    "Harlan",
    "Hazel",
    "Henrik",
    "Hollis",
    "Idris",
    "Ilse",
    "Imani",
    "Ines",
    "Ira",
    "Isla",
    "Ivo",
    "Jada",
    "Jalen",
    "Jasper",
    "Joelle",
    "Jonah",
    "Juno",
    "Kai",
    "Kaia",
    "Kenzo",
    "Kian",
    "Kira",
    "Lachlan",
    "Lark",
    "Lazlo",
    "Leif",
    "Lena",
    "Linus",
    "Lior",
    "Lux",
    "Mabel",
    "Malik",
    "Mara",
    "Marlo",
    "Matteo",
    "Mila",
    "Milo",
    "Mira",
    "Nadia",
    "Nell",
    "Nico",
    "Noor",
    "Oakes",
    "Odile",
    "Omar",
    "Opal",
    "Orin",
    "Otto",
    "Paloma",
    "Pax",
    "Petra",
    "Pia",
    "Quill",
    "Rafe",
    "Remy",
    "Rhea",
    "Rocco",
    "Romy",
    "Rory",
    "Rosalie",
    "Rumi",
    "Sabine",
    "Saul",
    "Selah",
    "Silas",
    "Sloane",
    "Soren",
    "Stellan",
    "Suki",
    "Talia",
    "Tate",
    "Teo",
    "Thea",
    "Tobin",
    "Uma",
    "Vale",
    "Vida",
    "Wren",
    "Xander",
    "Yara",
    "Yusra",
    "Zadie",
    "Zane",
    "Zora",
]
LAST = [
    "Abernathy",
    "Achebe",
    "Adair",
    "Ainsley",
    "Albrecht",
    "Alcott",
    "Amberg",
    "Arden",
    "Ashby",
    "Auclair",
    "Bastian",
    "Beaumont",
    "Belcourt",
    "Birch",
    "Blackwood",
    "Bramhall",
    "Brightwater",
    "Calloway",
    "Carver",
    "Castellan",
    "Chadwick",
    "Cobb",
    "Corwin",
    "Crane",
    "Dalgleish",
    "Davenport",
    "Delacroix",
    "Draper",
    "Dunmore",
    "Eastwick",
    "Ellery",
    "Esposito",
    "Everhart",
    "Fairbanks",
    "Falk",
    "Fenwick",
    "Finch",
    "Fitzroy",
    "Galloway",
    "Garnier",
    "Gilroy",
    "Granger",
    "Greaves",
    "Halloran",
    "Hargrove",
    "Hartwell",
    "Hawthorne",
    "Holloway",
    "Huxley",
    "Ivers",
    "Jessup",
    "Kavanagh",
    "Keane",
    "Kendrick",
    "Kessler",
    "Kingsley",
    "Lachance",
    "Lancaster",
    "Larkin",
    "Lockhart",
    "Lowell",
    "Lyndon",
    "Mackey",
    "Mallory",
    "Marchetti",
    "Merriweather",
    "Montague",
    "Nakashima",
    "Navarro",
    "Nightingale",
    "Northcott",
    "Oakley",
    "Okonkwo",
    "Ollivander",
    "Pembroke",
    "Penhallow",
    "Prescott",
    "Quimby",
    "Radcliffe",
    "Ravensworth",
    "Redmond",
    "Rothschild",
    "Saltonstall",
    "Sandoval",
    "Sedgwick",
    "Sinclair",
    "Stanhope",
    "Sterling",
    "Strand",
    "Talbot",
    "Thackeray",
    "Thorne",
    "Townsend",
    "Underhill",
    "Vance",
    "Varnum",
    "Vreeland",
    "Wadsworth",
    "Wakefield",
    "Whitlock",
    "Winslow",
    "Wolcott",
    "Yardley",
    "Yeager",
    "Zeller",
]


@dataclass
class ClaimPlan:
    key: str
    patient: Patient
    coverage: Coverage
    visit: Visit
    procs: list[ProcedureLine]
    status: ClaimStatus
    sent_at: datetime | None
    payer_ack: datetime | None
    paid_at: datetime | None = None
    outcome: str | None = None
    result: ClaimResult | None = None
    adjudicate_on: date | None = None
    payer_state: str = "in_process"
    tags: set[str] = field(default_factory=set)

    @property
    def billed(self) -> int:
        return sum(p.fee_cents for p in self.procs)


class Generator:
    def __init__(self, b: Builder, pinned: Pinned) -> None:
        self.b = b
        self.pinned = pinned
        self.rng = random.Random(b.w.seed * 7 + 1)
        self.composer = Composer()
        self.plans: list[ClaimPlan] = []
        self.patients: dict[PayerKey | None, list[tuple[Patient, Coverage | None]]] = defaultdict(list)
        self._n = 0

    # ── patients ───────────────────────────────────────────────────────────────────────────────────────────

    def add_patients(self, count: int = 540) -> None:
        names = [(f, la) for la in LAST for f in FIRST]
        self.rng.shuffle(names)
        taken = {(p.first, p.last) for p in self.b.w.of(Patient)}
        payers = list(PAYER_WEIGHTS)
        weights = list(PAYER_WEIGHTS.values())
        for first, last in names:
            if len(self.patients_all()) >= count:
                break
            if (first, last) in taken or any(la == last for _, la in taken):
                continue
            taken.add((first, last))
            pid = f"pat_{last.lower()}_{first[0].lower()}"
            loc = LOC_DOWNTOWN if self.rng.random() < 0.5 else LOC_RIVERSIDE
            dob = date(self.rng.randint(1945, 2008), self.rng.randint(1, 12), self.rng.randint(1, 28))
            patient = self.b.patient(pid, first, last, dob, loc, self.rng.choice(("text", "text", "email", "paper")))
            if self.rng.random() < 0.1:
                self.patients[None].append((patient, None))
                continue
            payer = self.rng.choices(payers, weights)[0]
            cov = self.b.coverage(
                patient,
                payer,
                schedule=SCHEDULE_OF[payer],
                subscriber_id=self._subscriber_id(payer),
                group_no=self._group(payer),
                plan_name=PLAN_NAME[payer],
                self_funded=payer in (AE, GD),
                plan={"used_cents": self.rng.randrange(0, 55_000, 100)},
            )
            self.patients[payer].append((patient, cov))

    def patients_all(self) -> list[tuple[Patient, Coverage | None]]:
        return [pc for group in self.patients.values() for pc in group]

    def _subscriber_id(self, payer: PayerKey) -> str:
        n = self.rng.randint(10_000_000, 99_999_999)
        return {
            D: f"88{n}"[:9],
            ML: f"6{n}",
            CG: f"U{n}",
            AE: f"W2{n}",
            GD: f"5{n}",
            MD: f"AB{n % 100_000:05d}C",
        }[payer]

    def _group(self, payer: PayerKey) -> str:
        return self.rng.choice(
            {
                D: ("10422", "20871", "30155"),
                ML: ("0081-22", "0117-04", "0094-11"),
                CG: ("3337851", "3341102"),
                AE: ("862114", "870233"),
                GD: ("00744", "00981"),
                MD: ("NYMCD",),
            }[payer]
        )

    def pick_patient(self, payer: PayerKey | None) -> tuple[Patient, Coverage | None]:
        return self.rng.choice(self.patients[payer])

    # ── plan helpers ───────────────────────────────────────────────────────────────────────────────────────

    def kinds_for(self, dollars: int) -> tuple[str, ...]:
        if dollars < 330:
            return ("hygiene", "restorative", "perio")
        if dollars < 900:
            return ("restorative", "perio", "surgery", "endo", "hygiene")
        if dollars < 2_600:
            return ("crown", "endo", "restorative", "perio")
        return ("bridge", "crown", "endo")

    def compose_lines(self, dollars: int, kinds: tuple[str, ...]) -> list[tuple[str, str | None, str | None]]:
        try:
            codes = self.composer.compose(dollars, kinds, self.rng)
        except ValueError:
            codes = self.composer.compose(dollars, INSURED_KINDS, self.rng)
        return self._teeth(codes)

    def _teeth(self, codes: list[str]) -> list[tuple[str, str | None, str | None]]:
        rng = self.rng
        posterior = [1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 28, 29, 30, 31, 32]
        anterior = [6, 7, 8, 9, 10, 11, 22, 23, 24, 25, 26, 27]
        premolar = [4, 5, 12, 13, 20, 21, 28, 29]
        molar = [2, 3, 14, 15, 18, 19, 30, 31]
        quads = ["UR", "UL", "LL", "LR"]
        rng.shuffle(quads)
        used: set[int] = set()
        main_tooth: int | None = None
        out: list[tuple[str, str | None, str | None]] = []
        surfaces = {
            "D2391": ["O", "B", "L"],
            "D2392": ["MO", "DO", "OL"],
            "D2393": ["MOD", "MOL"],
            "D2394": ["MODL", "MODB"],
            "D2140": ["O"],
            "D2150": ["MO", "DO"],
        }
        for code in codes:
            meta = CODES[code]
            if meta.per_quadrant:
                out.append((code, None, quads.pop() if quads else "UR"))
                continue
            if not meta.per_tooth:
                out.append((code, None, None))
                continue
            if code in ("D0220", "D0230"):
                tooth = main_tooth or rng.choice(posterior)
                out.append((code, str(tooth), None))
                continue
            pool = (
                anterior
                if code == "D3310"
                else premolar
                if code == "D3320"
                else molar
                if code == "D3330"
                else posterior
            )
            if code in ("D2950", "D2954") and main_tooth:
                out.append((code, str(main_tooth), None))
                continue
            choices = [t for t in pool if t not in used] or pool
            tooth = rng.choice(choices)
            if code.startswith(("D27", "D33", "D2950")) and main_tooth:
                tooth = main_tooth
            used.add(tooth)
            main_tooth = main_tooth or tooth
            out.append((code, str(tooth), rng.choice(surfaces[code]) if code in surfaces else None))
        return out

    def provider_for(self, lines: list[tuple[str, str | None, str | None]]) -> str:
        hygiene = all(category(c) is Category.PREVENTIVE or c in ("D4910", "D4341", "D4342") for c, _, _ in lines)
        return self.rng.choice(HYGIENISTS if hygiene else DENTISTS)

    def new_plan(
        self,
        patient: Patient,
        coverage: Coverage,
        dos: date,
        lines: list[tuple[str, str | None, str | None]],
        status: ClaimStatus,
        sent_at: datetime | None,
        payer_ack: datetime | None,
    ) -> ClaimPlan:
        self._n += 1
        at = f"{self.rng.choice(range(8, 16)):02d}:{self.rng.choice((0, 30)):02d}"
        visit, procs = self.b.visit(patient, dos, self.provider_for(lines), list(lines), at=at)
        plan = ClaimPlan(f"g{self._n}", patient, coverage, visit, procs, status, sent_at, payer_ack)
        self.plans.append(plan)
        return plan

    def sent_after(self, dos: date, visit_at: datetime | None = None) -> tuple[datetime, datetime]:
        """File time on the DOS (or next business day) and the next-business-morning payer ack."""
        base = visit_at or dt(dos, "15:00")
        file_time = None
        if is_business_day(dos):
            for hhmm in FILE_TIMES:
                candidate = dt(dos, hhmm)
                if candidate > base:
                    file_time = candidate
                    break
        if file_time is None:
            file_time = dt(next_business_day(dos), "07:45")
        ack = dt(next_business_day(file_time.date()), "06:00") + timedelta(minutes=self.rng.randint(5, 115))
        return file_time, ack

    def temp_result(self, plan: ClaimPlan) -> ClaimResult:
        claim = Claim(
            id=f"tmp_{plan.key}",
            number=0,
            visit_id=plan.visit.id,
            patient_id=plan.patient.id,
            coverage_id=plan.coverage.id,
            payer_key=plan.coverage.payer_key,
            provider_id=plan.visit.provider_id,
            location_id=plan.visit.location_id,
            status=plan.status,
            dos=plan.visit.dos,
            built_at=plan.visit.completed_at,
            billed_cents=plan.billed,
            lines=[
                ClaimLine(id=f"tmp_{plan.key}_{i}", cdt=p.cdt, tooth=p.tooth, fee_cents=p.fee_cents)
                for i, p in enumerate(plan.procs, 1)
            ],
        )
        return self.b.adjudicate(claim, plan.coverage, outcome=plan.outcome)

    # ── open A/R ───────────────────────────────────────────────────────────────────────────────────────────

    def ar_claims(self) -> None:
        open_pinned = [c for c in self.b.w.of(Claim) if c.closed_reason is None and c.status in AR_STATUSES]
        status_res = {s: T.STATUS_TARGETS[s][1] // 100 for s in (S.ACCEPTED, S.PENDING, S.PARTIAL)}
        counts = {s: T.STATUS_TARGETS[s][0] for s in status_res}
        payer_res = {p: v // 100 for p, v in T.AR_BY_PAYER.items()}
        aging_res = {k: v // 100 for k, v in T.AGING.items()}
        for c in open_pinned:
            dollars = c.billed_cents // 100
            if c.status in status_res:
                status_res[c.status] -= dollars
                counts[c.status] -= 1
            payer_res[c.payer_key] -= dollars
            aging_res[T.age_bucket(_age(c))] -= dollars
        slots = self._ar_slots(counts, payer_res, aging_res)
        amounts = fit_amounts(
            slots,
            [status_res, payer_res, aging_res],  # type: ignore[list-item]
            lambda s, v: self.composer.possible(v, s.kinds),
            self.rng,
        )
        for slot in slots:
            status, payer, bucket = slot.labels
            self._ar_plan(status, payer, bucket, amounts[slot.key])  # type: ignore[arg-type]
        self._thursday_paid()

    def _ar_slots(
        self, counts: dict[ClaimStatus, int], payer_res: dict[PayerKey, int], aging_res: dict[str, int]
    ) -> list[Slot]:
        rng = self.rng
        payers = list(payer_res)
        payer_w = [max(payer_res[p], 1) for p in payers]
        slots: list[Slot] = []

        def add(status: ClaimStatus, bucket: str, n: int, mean: float, pair: bool = True) -> None:
            while n > 0:
                payer = rng.choices(payers, payer_w)[0]
                k = 2 if pair and n >= 2 else 1
                for _ in range(k):
                    weight = min(2.5 * mean, max(150.0, rng.lognormvariate(0, 0.6) * mean))
                    slots.append(
                        Slot(
                            f"s{len(slots)}",
                            (status, payer, bucket),
                            weight,
                            minimum=100 if status is S.PARTIAL else 142,
                        )
                    )
                n -= k

        acc_n, part_n, pend_n = counts[S.ACCEPTED], counts[S.PARTIAL], counts[S.PENDING]
        add(S.ACCEPTED, "0_30", acc_n, 17_640 / 24)
        add(S.PARTIAL, "0_30", part_n, 155)
        pending_room = {
            "0_30": aging_res["0_30"] - 17_640 - 465,
            "31_60": aging_res["31_60"],
            "61_90": aging_res["61_90"],
            "90_plus": aging_res["90_plus"],
        }
        mean = sum(pending_room.values()) / pend_n
        alloc = {k: max(2, round(v / mean)) for k, v in pending_room.items()}
        alloc["0_30"] += pend_n - sum(alloc.values())
        for bucket, n in alloc.items():
            add(S.PENDING, bucket, n, pending_room[bucket] / n)
        return slots

    def _ar_plan(self, status: ClaimStatus, payer: PayerKey, bucket: str, dollars: int) -> None:
        rng = self.rng
        patient, cov = self.pick_patient(payer)
        assert cov is not None
        lines = self.compose_lines(dollars, self.kinds_for(dollars))
        dos = self._dos_in_bucket(status, bucket)
        plan = self.new_plan(patient, cov, dos, lines, status, None, None)
        plan.sent_at, plan.payer_ack = self.sent_after(dos, plan.visit.completed_at)
        prof = profile(payer)
        ack = plan.payer_ack
        assert ack is not None
        if status is S.ACCEPTED:
            plan.adjudicate_on = add_business_days(ack.date(), rng.randint(*prof.latency_bd))
            plan.payer_state = "received"
        elif status is S.PARTIAL:
            plan.paid_at = self._era_after(payer, ack.date(), latest=T.TODAY - timedelta(days=1))
            denied_code = next(
                (p.cdt for p in plan.procs if category(p.cdt) is Category.PREVENTIVE), plan.procs[-1].cdt
            )
            if len(plan.procs) == 1:
                plan.outcome = "PR-1=1500"
            else:
                plan.outcome = f"CO-119@{denied_code}"
            plan.result = self.temp_result(plan)
            if plan.result.status is not S.PARTIAL:
                plan.outcome = "PR-1=1500"
                plan.result = self.temp_result(plan)
        else:
            drawn = add_business_days(ack.date(), rng.randint(*prof.latency_bd))
            plan.adjudicate_on = drawn if drawn > date(2026, 10, 29) else T.TODAY + timedelta(days=rng.randint(3, 24))
            plan.payer_state = "in_process" if (T.TODAY - ack.date()).days < 45 else "in_review"

    def _dos_in_bucket(self, status: ClaimStatus, bucket: str) -> date:
        """A business-day DOS whose same-day send lands in the aging bucket (age = days since sent)."""
        if status is S.ACCEPTED:
            return date(2026, 10, 27)  # Tuesday's claims, acknowledged Wednesday morning
        low, high = {"0_30": (5, 30), "31_60": (31, 60), "61_90": (61, 90), "90_plus": (91, 150)}[bucket]
        if status is S.PARTIAL:
            low, high = 9, 24
        for _ in range(100):
            dos = T.TODAY - timedelta(days=self.rng.randint(low, high))
            if is_business_day(dos):
                return dos
        raise AssertionError("no business day in bucket")  # pragma: no cover

    def _thursday_paid(self) -> None:
        """Six pending claims the Thursday 835s pay (the overnight bridge in the mocks: −6 paid)."""
        candidates = [
            p
            for p in self.plans
            if p.status is S.PENDING
            and p.coverage.payer_key in (D, ML, AE, GD)
            and p.sent_at
            and (T.TODAY - p.sent_at.date()).days >= 12
        ]
        candidates.sort(key=lambda p: p.sent_at or T.NOW)
        for plan in candidates[:6]:
            plan.adjudicate_on = date(2026, 10, 29)
            plan.tags.add("thursday_paid")

    def _era_after(self, payer: PayerKey, after: date, latest: date) -> datetime:
        weekdays = PROFILES[payer].era_weekdays
        day = after + timedelta(days=1)
        last_ok = None
        while day <= latest:
            if day.weekday() in weekdays and is_business_day(day) and not (payer is CG and day == T.TODAY):
                last_ok = day
                if self.rng.random() < 0.35:
                    break
            day += timedelta(days=1)
        chosen = last_ok or latest
        return dt(chosen, f"05:{self.rng.randint(30, 59):02d}")

    # ── paid history ───────────────────────────────────────────────────────────────────────────────────────

    def paid_claims(self) -> None:
        pinned_oct = [
            c for c in self.b.w.of(Claim) if c.status is S.PAID and c.paid_at and c.paid_at.date() >= T.MONTH_START
        ]
        oct_n = T.PAID_MONTH["count"] - len(pinned_oct)
        oct_target = T.PAID_MONTH["insurance_cents"] - sum(c.paid_cents or 0 for c in pinned_oct)
        self._paid_batch(oct_n, oct_target, date(2026, 10, 1), date(2026, 10, 27), "oct")
        self._paid_batch(300, None, date(2026, 8, 1), date(2026, 9, 30), "history")

    def _paid_batch(self, n: int, paid_target: int | None, first: date, last: date, tag: str) -> None:
        rng = self.rng
        total = 0
        for i in range(n):
            payer = rng.choices(list(PAYER_WEIGHTS), list(PAYER_WEIGHTS.values()))[0]
            remaining = n - i
            if paid_target is not None:
                want_paid = (paid_target - total) / remaining
                dollars = max(142, int(rng.lognormvariate(0, 0.45) * want_paid / 0.62 / 100))
            else:
                dollars = max(142, int(rng.lognormvariate(6.3, 0.7)))
            plan = self._paid_plan(payer, dollars, first, last, tag)
            total += plan.result.paid if plan.result else 0

    def _paid_plan(self, payer: PayerKey, dollars: int, first: date, last: date, tag: str) -> ClaimPlan:
        for _ in range(12):
            plan = self._paid_plan_once(payer, dollars, first, last, tag)
            if plan.status is S.PAID:
                return plan
            self._discard(plan)
            dollars = max(142, int(dollars * 0.75))
        raise AssertionError("could not draw a cleanly paid claim")

    def _discard(self, plan: ClaimPlan) -> None:
        self.plans.remove(plan)
        self.b.w.entities[Visit].remove(plan.visit)
        for proc in plan.procs:
            self.b.w.entities[ProcedureLine].remove(proc)

    def _paid_plan_once(self, payer: PayerKey, dollars: int, first: date, last: date, tag: str) -> ClaimPlan:
        rng = self.rng
        patient, cov = self.pick_patient(payer)
        assert cov is not None
        dollars = min(dollars, 1_900)
        if not self.composer.possible(dollars, INSURED_KINDS):
            dollars = next(d for d in range(dollars, dollars + 400) if self.composer.possible(d, INSURED_KINDS))
        lines = self.compose_lines(dollars, self.kinds_for(dollars))
        dos, paid_day = self._dos_and_paid_day(payer, first, last)
        plan = self.new_plan(patient, cov, dos, lines, S.PAID, None, None)
        plan.sent_at, plan.payer_ack = self.sent_after(dos, plan.visit.completed_at)
        plan.paid_at = dt(paid_day, f"05:{rng.randint(30, 59):02d}")
        assert plan.payer_ack is not None and plan.payer_ack.date() < paid_day
        plan.result = self.temp_result(plan)
        plan.status = plan.result.status
        plan.tags.add(tag)
        return plan

    def _dos_and_paid_day(self, payer: PayerKey, first: date, last: date) -> tuple[date, date]:
        """Draw a DOS, then the ERA day the payer's latency puts it on; keep draws whose ERA lands in range."""
        prof = profile(payer)
        rng = self.rng
        for _ in range(500):
            dos = first + timedelta(days=rng.randint(-30, (last - first).days - 8))
            if not is_business_day(dos):
                continue
            received = next_business_day(dos)
            ready = add_business_days(received, rng.randint(prof.latency_bd[0] - 4, prof.latency_bd[1]))
            paid_day = ready
            while paid_day.weekday() not in prof.era_weekdays or not is_business_day(paid_day):
                paid_day += timedelta(days=1)
            if first <= paid_day <= last:
                return dos, paid_day
        raise AssertionError(f"no ERA day for {payer} in {first}..{last}")  # pragma: no cover

    # ── tuning ─────────────────────────────────────────────────────────────────────────────────────────────

    def oct_paid_gap(self) -> int:
        pinned = sum(
            c.paid_cents or 0
            for c in self.b.w.of(Claim)
            if c.status is S.PAID and c.paid_at and c.paid_at.date() >= T.MONTH_START
        )
        generated = sum(p.result.paid for p in self.plans if "oct" in p.tags and p.result is not None)
        return T.PAID_MONTH["insurance_cents"] - pinned - generated

    def tune_paid(self) -> None:
        """Close the October paid gap to the cent with plan-specific contract amounts on September-DOS claims
        paid in October (their contractual falls outside October). A coarse pass moves any covered line; the
        exact pass uses preventive lines, where 100% coverage moves paid one-for-one."""
        candidates = [
            p
            for p in self.plans
            if "oct" in p.tags
            and p.visit.dos < T.MONTH_START
            and p.result
            and p.coverage.payer_key is not MD
            # never move a coverage that also has October-DOS claims (October contractual is already exact)
            and all(o.visit.dos < T.MONTH_START for o in self.plans if o.coverage.id == p.coverage.id)
        ]
        for exact in (False, True):
            for plan in candidates:
                if self.oct_paid_gap() == 0:
                    return
                self._nudge_paid(plan, preventive_only=exact)
        assert self.oct_paid_gap() == 0, f"October paid still off by {self.oct_paid_gap()} cents"

    def _nudge_paid(self, plan: ClaimPlan, *, preventive_only: bool) -> None:
        pct = {
            Category.PREVENTIVE: plan.coverage.plan.pct_preventive,
            Category.BASIC: plan.coverage.plan.pct_basic,
            Category.MAJOR: plan.coverage.plan.pct_major,
        }
        for proc in plan.procs:
            cat = category(proc.cdt)
            if cat not in pct or (preventive_only and cat is not Category.PREVENTIVE) or not pct[cat]:
                continue
            gap = self.oct_paid_gap()
            if gap == 0:
                return
            schedule = self.b.schedule_for(plan.coverage)
            current = min(schedule.allowed(proc.cdt, proc.fee_cents), proc.fee_cents)
            low, high = int(proc.fee_cents * 0.45), int(proc.fee_cents * 0.98)
            target = max(low, min(high, current + round(gap * 100 / pct[cat])))
            if target != current:
                self._own_schedule(plan, {**schedule.explicit, proc.cdt: target})

    def _own_schedule(self, plan: ClaimPlan, explicit: dict[str, int]) -> None:
        """Give this patient's plan its own contract schedule (single-employer groups often carry one)."""
        base = self.b.schedule_for(plan.coverage)
        key = f"{base.key}__{plan.patient.id.removeprefix('pat_')}"
        sched: PlanSchedule = base.with_explicit(key, explicit)
        self.b.w.schedules.register(sched)
        plan.coverage.plan = plan.coverage.plan.model_copy(update={"fee_schedule": key})
        for other in self.plans:
            if other.coverage.id == plan.coverage.id and other.result is not None:
                other.result = self.temp_result(other)

    def tune_contractual(self) -> None:
        """October contractual write-offs to the cent: adjust contract amounts on October open (unadjudicated)
        claims, which do not touch paid amounts."""
        candidates = [
            p
            for p in self.plans
            if p.status in (S.ACCEPTED, S.PENDING) and p.visit.dos >= T.MONTH_START and "thursday_paid" not in p.tags
        ]
        candidates.sort(key=lambda p: -p.billed)
        for plan in candidates:
            gap = T.CONTRACTUAL_MONTH - self.contractual_in(T.MONTH_START, T.TODAY)
            if gap == 0:
                break
            schedule = self.b.schedule_for(plan.coverage)
            explicit: dict[str, int] = {}
            for proc in plan.procs:
                if proc.cdt in explicit or category(proc.cdt) is Category.NON_COVERED:
                    continue
                current = min(schedule.allowed(proc.cdt, proc.fee_cents), proc.fee_cents)
                low, high = int(proc.fee_cents * 0.5), int(proc.fee_cents * 0.92)
                new = max(low, min(high, current - gap))  # more contractual = lower allowed
                if new != current:
                    explicit[proc.cdt] = new
                    gap -= current - new
            if explicit:
                self._own_schedule(plan, explicit)
        gap = T.CONTRACTUAL_MONTH - self.contractual_in(T.MONTH_START, T.TODAY)
        assert gap == 0, f"October contractual still off by {gap} cents"

    def contractual_in(self, start: date, end: date) -> int:
        total = 0
        for claim in self.b.w.of(Claim):
            if claim.closed_reason or claim.secondary or not start <= claim.dos <= end:
                continue
            total += sum(line.fee_cents - (line.allowed_cents or 0) for line in claim.lines)
        for plan in self.plans:
            if not start <= plan.visit.dos <= end:
                continue
            schedule = self.b.schedule_for(plan.coverage)
            total += sum(p.fee_cents - min(schedule.allowed(p.cdt, p.fee_cents), p.fee_cents) for p in plan.procs)
        return total

    def gross_in(self, start: date, end: date) -> int:
        return sum(p.fee_cents for p in self.b.w.of(ProcedureLine) if start <= p.dos <= end)

    # ── self-pay production ────────────────────────────────────────────────────────────────────────────────

    def self_pay_fill(self) -> None:
        oct_gap = T.GROSS_PRODUCTION_MONTH - self.gross_in(T.MONTH_START, T.TODAY)
        self._fill_self_pay(oct_gap, T.MONTH_START, T.TODAY - timedelta(days=1))
        self._whole_dollar_net_90()
        net_90 = self.gross_in(T.WINDOW_START, T.TODAY) - self.contractual_in(T.WINDOW_START, T.TODAY)
        self._fill_self_pay(T.NET_PRODUCTION_90D - net_90, T.WINDOW_START, T.MONTH_START - timedelta(days=1))

    def _whole_dollar_net_90(self) -> None:
        """Contract amounts carry cents; self-pay fees do not. Absorb the cents of the 90-day net production gap
        in one August/September history claim's contract amount (no reconciled number reads it)."""
        net_90 = self.gross_in(T.WINDOW_START, T.TODAY) - self.contractual_in(T.WINDOW_START, T.TODAY)
        cents = (T.NET_PRODUCTION_90D - net_90) % 100
        if cents == 0:
            return
        plan = next(
            p
            for p in self.plans
            if "history" in p.tags
            and p.visit.dos >= T.WINDOW_START
            and all("history" in o.tags for o in self.plans if o.coverage.id == p.coverage.id)
        )
        proc = plan.procs[0]
        schedule = self.b.schedule_for(plan.coverage)
        current = min(schedule.allowed(proc.cdt, proc.fee_cents), proc.fee_cents)
        # Raising allowed by `cents` raises net production by the same amount and closes the fractional gap.
        new = current + cents if current + cents <= proc.fee_cents else current - (100 - cents)
        self._own_schedule(plan, {**schedule.explicit, proc.cdt: new})

    def _fill_self_pay(self, cents: int, first: date, last: date) -> None:
        assert cents > 0 and cents % 100 == 0, f"self-pay fill must be a positive whole-dollar amount, got {cents}"
        rng = self.rng
        remaining = cents // 100
        while remaining > 0:
            dollars = remaining if remaining < 3_000 else rng.choice((450, 650, 900, 1_650, 2_100, 2_750))
            if not self.composer.possible(dollars, ("selfpay",)):
                dollars = next(
                    (
                        d
                        for d in range(dollars, 0, -1)
                        if self.composer.possible(d, ("selfpay",)) and (remaining - d == 0 or remaining - d >= 200)
                    ),
                    0,
                )
                if dollars == 0:
                    raise AssertionError(f"cannot fill self-pay remainder ${remaining}")
            codes = self.composer.compose(dollars, ("selfpay",), rng)
            patient, _ = self.pick_patient(None) if rng.random() < 0.5 else self.pick_patient(rng.choice(AR_PAYERS))
            dos = first + timedelta(days=rng.randint(0, (last - first).days))
            while not is_business_day(dos):
                dos += timedelta(days=1) if dos < last else -timedelta(days=1)
            self.b.visit(patient, dos, rng.choice(DENTISTS), self._teeth(codes), at="14:00", self_pay=True)
            remaining -= dollars

    # ── materialize ────────────────────────────────────────────────────────────────────────────────────────

    def materialize(self) -> None:
        used = {c.number for c in self.b.w.of(Claim)}
        pool = [n for n in range(4_280, 4_867) if n not in used]
        order = sorted(self.plans, key=lambda p: (p.visit.completed_at, p.key))
        if len(pool) < len(order):
            pool = [n for n in range(4_100, 4_280) if n not in used] + pool
        pool = pool[-len(order) :]
        by_era: dict[tuple[PayerKey, date], list[tuple[Claim, ClaimResult]]] = defaultdict(list)
        for number, plan in zip(pool, order, strict=True):
            claim = self.b.claim(number, plan.visit, plan.procs, plan.coverage, plan.status)
            self.b.send(
                claim,
                plan.sent_at or plan.visit.completed_at,
                payer_ack=plan.payer_ack,
                icn=_icn(plan.coverage.payer_key, plan.payer_ack, number),
            )
            if plan.paid_at is not None:
                result = self.b.adjudicate(claim, plan.coverage, outcome=plan.outcome)
                self.b.apply(claim, result, plan.paid_at)
                by_era[(claim.payer_key, plan.paid_at.date())].append((claim, result))
                self.b.w.add(
                    PayerClaim(
                        id=claim.id,
                        payer_key=claim.payer_key,
                        icn=claim.icn or "",
                        received_on=(plan.payer_ack or plan.paid_at).date(),
                        state="adjudicated",
                        adjudicate_on=plan.paid_at.date(),
                    )
                )
            else:
                self.b.w.add(
                    PayerClaim(
                        id=claim.id,
                        payer_key=claim.payer_key,
                        icn=claim.icn or "",
                        received_on=(plan.payer_ack or T.NOW).date(),
                        state=plan.payer_state,
                        adjudicate_on=plan.adjudicate_on,
                    )
                )
        self._remittances(by_era)

    def _remittances(self, by_era: dict[tuple[PayerKey, date], list[tuple[Claim, ClaimResult]]]) -> None:
        existing = self.b.w.index(Remittance)
        for (payer, day), items in sorted(by_era.items(), key=lambda kv: (kv[0][1], kv[0][0].value)):
            rid = f"rem_{payer.value.split('_')[0]}_{day:%m%d}"
            received = min(c.paid_at for c, _ in items if c.paid_at)
            if rid in existing:
                remit = existing[rid]
                extra = self.b.remittance(f"{rid}_x", payer, received, items)
                self.b.w.entities[Remittance].remove(extra)
                offset = len(remit.lines)
                for i, line in enumerate(extra.lines, 1):
                    remit.lines.append(line.model_copy(update={"id": f"rl_{rid.removeprefix('rem_')}_{offset + i}"}))
                remit.amount_cents = sum(line.paid for line in remit.lines)
                continue
            self.b.remittance(rid, payer, received, items)


def _age(claim: Claim) -> int:
    sent = claim.sent_at.date() if claim.sent_at else T.TODAY
    return (T.TODAY - sent).days


def _icn(payer: PayerKey, ack: datetime | None, number: int) -> str | None:
    if ack is None:
        return None
    if payer is D:
        return f"{ack:%y}{ack.timetuple().tm_yday:03d}-{(number * 7919) % 1_000_000:06d}"
    return f"{profile(payer).icn_prefix}{ack:%y%m%d}{number % 10_000:04d}"
