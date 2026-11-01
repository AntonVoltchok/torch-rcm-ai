"""The reconciled numbers at Wed 10/28 10:40 (docs/spec/04-seed.md). The generator is built to make these true;
tests/test_seed_reconciled.py asserts them against the read models."""

from __future__ import annotations

from datetime import date, datetime

from torch_rcm.clock import PRACTICE_TZ
from torch_rcm.domain.enums import ClaimStatus, PayerKey

S = ClaimStatus
NOW = datetime(2026, 10, 28, 10, 40, tzinfo=PRACTICE_TZ)
TODAY = NOW.date()
WEEK_START = date(2026, 10, 26)
MONTH_START = date(2026, 10, 1)
WINDOW_START = date(2026, 7, 31)  # 90 days of visits ending today (inclusive)


def usd(dollars: float) -> int:
    return round(dollars * 100)


#: (count, billed cents) per open status.
STATUS_TARGETS: dict[ClaimStatus, tuple[int, int]] = {
    S.READY: (6, usd(3_210)),
    S.SENT: (5, usd(1_320)),
    S.REJECTED: (2, usd(830)),
    S.ACCEPTED: (24, usd(17_640)),
    S.PENDING: (57, usd(46_520)),
    S.DENIED: (5, usd(6_210)),
    S.APPEALED: (3, usd(1_920)),
    S.PARTIAL: (5, usd(1_060)),
}
AR_TOTAL = (101, usd(75_500))
OPEN_TOTAL = (107, usd(78_710))
FLAGGED = {
    "count": 9,
    "cents": usd(8_265),
    "by_status": {S.DENIED: 5, S.PENDING: 1, S.REJECTED: 1, S.PARTIAL: 1, S.PAID: 1},
}
INBOX_OPEN = {"count": 12, "cents": usd(9_697), "claim_items": 9, "eligibility_items": 3}

DECISIONS_WEEK = {
    "total": 53,
    "ran": 41,
    "to_dana": 12,
    "by_agent": {
        "eligibility": (5, 3),
        "claims": (13, 1),
        "followup": (18, 4),
        "appeals": (0, 1),
        "posting": (5, 3),
    },
    "by_tier": {"1": (29, 5), "2": (12, 3), "3": (0, 1), "none": (0, 3)},
}

PAID_MONTH = {"count": 118, "insurance_cents": usd(61_300)}
PATIENT_COLLECTIONS_MONTH = usd(25_640)
COLLECTIONS_MONTH = usd(86_940)
GROSS_PRODUCTION_MONTH = usd(112_600)
CONTRACTUAL_MONTH = usd(21_400)
NET_PRODUCTION_MONTH = usd(91_200)
NON_CONTRACTUAL_MONTH = usd(876)

AGING: dict[str, int] = {
    "0_30": usd(46_420),
    "31_60": usd(15_890),
    "61_90": usd(7_074),
    "90_plus": usd(6_116),
}
AR_BY_PAYER: dict[PayerKey, int] = {
    PayerKey.DELTA_NY: usd(28_940),
    PayerKey.METLIFE: usd(16_210),
    PayerKey.CIGNA: usd(12_480),
    PayerKey.AETNA: usd(10_370),
    PayerKey.GUARDIAN: usd(7_500),
}
PATIENT_AR = usd(33_100)
PATIENT_CREDITS = usd(2_180)
AVG_DAILY_NET_PRODUCTION = usd(4_020)
NET_PRODUCTION_90D = 90 * AVG_DAILY_NET_PRODUCTION
DAYS_IN_AR = 27
APPEALS_12MO = {"won": 6, "total": 9, "reconsideration": (5, 6), "formal": (1, 3)}

AGE_BUCKETS: tuple[tuple[str, int, int], ...] = (
    ("0_30", 0, 30),
    ("31_60", 31, 60),
    ("61_90", 61, 90),
    ("90_plus", 91, 100_000),
)


def age_bucket(age_days: int) -> str:
    for key, low, high in AGE_BUCKETS:
        if low <= age_days <= high:
            return key
    return "90_plus"
