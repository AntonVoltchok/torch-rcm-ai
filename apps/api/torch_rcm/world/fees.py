"""CDT catalog, the practice fee schedule (the PMS's UCR fees) and payer contract (allowed) schedules.

Allowed amounts are per *plan schedule*, not per payer: a Delta PPO plan and a Delta Premier plan pay different
contract amounts for the same code, and self-funded employer groups often carry their own schedule. Plan schedules
derive from category factors plus explicit per-code amounts.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class Category(StrEnum):
    PREVENTIVE = "preventive"  # diagnostic + preventive (D0xxx, D1xxx)
    BASIC = "basic"  # fillings, endo, perio, extractions
    MAJOR = "major"  # crowns, buildups, prosthetics
    NON_COVERED = "non_covered"  # whitening, athletic guards


@dataclass(frozen=True, slots=True)
class Code:
    cdt: str
    description: str
    fee_cents: int
    category: Category
    per_tooth: bool = False
    per_quadrant: bool = False


def _c(cdt: str, desc: str, dollars: int, cat: Category, *, tooth: bool = False, quad: bool = False) -> Code:
    return Code(cdt, desc, dollars * 100, cat, per_tooth=tooth, per_quadrant=quad)


P, B, M, N = Category.PREVENTIVE, Category.BASIC, Category.MAJOR, Category.NON_COVERED

CODES: dict[str, Code] = {
    c.cdt: c
    for c in (
        _c("D0120", "Periodic oral evaluation", 57, P),
        _c("D0140", "Limited oral evaluation, problem focused", 100, P),
        _c("D0150", "Comprehensive oral evaluation", 130, P),
        _c("D0210", "Intraoral complete series (FMX)", 180, P),
        _c("D0220", "Intraoral periapical, first film", 30, P, tooth=True),
        _c("D0230", "Intraoral periapical, each additional film", 25, P, tooth=True),
        _c("D0272", "Bitewings, two films", 46, P),
        _c("D0274", "Bitewings, four films", 58, P),
        _c("D0330", "Panoramic film", 120, P),
        _c("D1110", "Prophylaxis, adult", 85, P),
        _c("D1120", "Prophylaxis, child", 62, P),
        _c("D1206", "Topical fluoride varnish", 59, P),
        _c("D1208", "Topical fluoride", 41, P),
        _c("D1351", "Sealant, per tooth", 52, P, tooth=True),
        _c("D2140", "Amalgam, one surface", 140, B, tooth=True),
        _c("D2150", "Amalgam, two surfaces", 180, B, tooth=True),
        _c("D2391", "Resin composite, one surface, posterior", 195, B, tooth=True),
        _c("D2392", "Resin composite, two surfaces, posterior", 255, B, tooth=True),
        _c("D2393", "Resin composite, three surfaces, posterior", 310, B, tooth=True),
        _c("D2394", "Resin composite, four or more surfaces, posterior", 365, B, tooth=True),
        _c("D2740", "Crown, porcelain/ceramic", 1090, M, tooth=True),
        _c("D2750", "Crown, porcelain fused to high noble metal", 1060, M, tooth=True),
        _c("D2950", "Core buildup, including any pins", 120, M, tooth=True),
        _c("D2954", "Prefabricated post and core", 330, M, tooth=True),
        _c("D3310", "Endodontic therapy, anterior", 780, B, tooth=True),
        _c("D3320", "Endodontic therapy, premolar", 915, B, tooth=True),
        _c("D3330", "Endodontic therapy, molar", 1150, B, tooth=True),
        _c("D4341", "Scaling and root planing, 4+ teeth per quadrant", 240, B, quad=True),
        _c("D4342", "Scaling and root planing, 1-3 teeth per quadrant", 150, B, quad=True),
        _c("D4910", "Periodontal maintenance", 140, B),
        _c("D6010", "Implant body, endosteal", 2100, N, tooth=True),
        _c("D6057", "Custom abutment", 650, N, tooth=True),
        _c("D6065", "Implant-supported porcelain crown", 1650, N, tooth=True),
        _c("D6240", "Pontic, porcelain fused to high noble metal", 1150, M, tooth=True),
        _c("D6750", "Retainer crown, porcelain fused to high noble metal", 1150, M, tooth=True),
        _c("D7140", "Extraction, erupted tooth", 195, B, tooth=True),
        _c("D7210", "Extraction, surgical", 310, B, tooth=True),
        _c("D9110", "Palliative treatment of dental pain", 95, B),
        _c("D9941", "Fabrication of athletic mouthguard", 195, N),
        _c("D9944", "Occlusal guard, hard appliance", 450, N),
        _c("D9972", "External bleaching, per arch", 450, N),
    )
}


# What a billing coordinator calls each code, beside the code itself ("D2740 Crown, tooth 30").
PLAIN: dict[str, str] = {
    "D0120": "Periodic exam",
    "D0140": "Limited exam",
    "D0150": "Comprehensive exam",
    "D0210": "Full-mouth x-rays",
    "D0220": "PA x-ray",
    "D0230": "PA x-ray, additional",
    "D0272": "Bitewings, two",
    "D0274": "Bitewings, four",
    "D0330": "Panoramic x-ray",
    "D1110": "Adult cleaning",
    "D1120": "Child cleaning",
    "D1206": "Fluoride varnish",
    "D1208": "Fluoride",
    "D1351": "Sealant",
    "D2140": "Amalgam, one surface",
    "D2150": "Amalgam, two surfaces",
    "D2391": "Composite, one surface",
    "D2392": "Composite, two surfaces",
    "D2393": "Composite, three surfaces",
    "D2394": "Composite, four+ surfaces",
    "D2740": "Crown",
    "D2750": "Crown, PFM",
    "D2950": "Core buildup",
    "D2954": "Post and core",
    "D3310": "Root canal, anterior",
    "D3320": "Root canal, premolar",
    "D3330": "Root canal, molar",
    "D4341": "Scaling and root planing, 4+ teeth",
    "D4342": "Scaling and root planing, 1-3 teeth",
    "D4910": "Perio maintenance",
    "D6010": "Implant",
    "D6057": "Custom abutment",
    "D6065": "Implant crown",
    "D6240": "Bridge pontic",
    "D6750": "Bridge retainer crown",
    "D7140": "Extraction",
    "D7210": "Surgical extraction",
    "D9110": "Palliative treatment",
    "D9941": "Athletic mouthguard",
    "D9944": "Night guard",
    "D9972": "Whitening, per arch",
}
assert set(PLAIN) == set(CODES), sorted(set(CODES) ^ set(PLAIN))


def plain_procedures(lines: list[tuple[str, str | None]]) -> str:
    """'D2740 Crown, tooth 30 + 1 more' from (cdt, tooth) pairs, first line first."""
    if not lines:
        return ""
    cdt, tooth = lines[0]
    head = f"{cdt} {PLAIN.get(cdt, CODES[cdt].description if cdt in CODES else '')}".strip()
    head += f", tooth {tooth}" if tooth else ""
    return f"{head} + {len(lines) - 1} more" if len(lines) > 1 else head


def fee(cdt: str) -> int:
    return CODES[cdt].fee_cents


def category(cdt: str) -> Category:
    return CODES[cdt].category


@dataclass(frozen=True, slots=True)
class PlanSchedule:
    """A contract fee schedule: allowed = explicit amount, else round(fee x category factor)."""

    key: str
    payer: str
    factors: dict[Category, float]
    explicit: dict[str, int] = field(default_factory=dict)

    def allowed(self, cdt: str, fee_cents: int | None = None) -> int:
        if cdt in self.explicit:
            return self.explicit[cdt]
        base = CODES[cdt].fee_cents if fee_cents is None else fee_cents
        factor = self.factors.get(CODES[cdt].category, 1.0)
        return round(base * factor)

    def with_explicit(self, key: str, explicit: dict[str, int]) -> PlanSchedule:
        return PlanSchedule(key, self.payer, dict(self.factors), {**self.explicit, **explicit})


def _f(prev: float, basic: float, major: float) -> dict[Category, float]:
    return {P: prev, B: basic, M: major, N: 1.0}


#: Base contract schedules per network. Pinned claims add explicit amounts on plan-specific schedules.
SCHEDULES: dict[str, PlanSchedule] = {
    s.key: s
    for s in (
        PlanSchedule("delta_ppo", "delta_ny", _f(0.68, 0.68, 0.72), {"D2740": 86_800, "D2950": 9_600, "D0220": 2_200}),
        PlanSchedule(
            "delta_premier",
            "delta_ny",
            _f(0.82, 0.84, 0.82),
            {"D2740": 89_200, "D2950": 9_600, "D0220": 2_400},
        ),
        PlanSchedule("metlife_pdp", "metlife", _f(0.64, 0.64, 0.68), {"D4341": 21_560}),
        PlanSchedule("cigna_dppo", "cigna", _f(0.60, 0.62, 0.64), {"D2392": 16_800, "D2140": 12_000, "D4341": 21_400}),
        PlanSchedule("aetna_dmo", "aetna", _f(0.62, 0.64, 0.66), {"D2392": 18_500, "D2150": 14_700}),
        PlanSchedule("guardian_ppo", "guardian", _f(0.62, 0.62, 0.66)),
        PlanSchedule("medicaid_ny", "ny_medicaid", _f(0.45, 0.42, 0.40)),
    )
}

DEFAULT_SCHEDULE: dict[str, str] = {
    "delta_ny": "delta_ppo",
    "metlife": "metlife_pdp",
    "cigna": "cigna_dppo",
    "aetna": "aetna_dmo",
    "guardian": "guardian_ppo",
    "ny_medicaid": "medicaid_ny",
}

#: Alternate-benefit downgrades (posterior composites paid at the amalgam rate).
ALTERNATE_BENEFIT: dict[str, str] = {"D2391": "D2140", "D2392": "D2150", "D2393": "D2150", "D2394": "D2150"}


class ScheduleBook:
    """All schedules in a world: the base ones plus plan-specific variants the seed registers."""

    def __init__(self) -> None:
        self._schedules: dict[str, PlanSchedule] = dict(SCHEDULES)

    def register(self, schedule: PlanSchedule) -> None:
        self._schedules[schedule.key] = schedule

    def get(self, key: str) -> PlanSchedule:
        return self._schedules[key]

    def keys(self) -> list[str]:
        return sorted(self._schedules)
