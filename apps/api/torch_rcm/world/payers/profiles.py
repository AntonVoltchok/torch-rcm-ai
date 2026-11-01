"""Payer profiles: identifiers, deadlines, cadence and the signature behaviours in docs/spec/03-mock-world.md."""

from __future__ import annotations

from dataclasses import dataclass, field

from torch_rcm.domain.enums import PayerKey, PayerType
from torch_rcm.world.calendar import FILE_TIMES


@dataclass(frozen=True, slots=True)
class PayerProfile:
    key: PayerKey
    name: str
    short_name: str
    payer_id: str
    type: PayerType
    timely_filing_days: int
    appeal_window_days: int
    appeal_levels: int
    era_weekdays: tuple[int, ...]  # 0 = Monday
    latency_bd: tuple[int, int]  # adjudication latency range in business days
    icn_prefix: str
    #: Codes for which this payer requires a periapical radiograph (CO-16·N29 without one).
    requires_pa: tuple[str, ...] = ()
    #: Crown frequency per tooth in months, using the *payer's* tooth history (CO-119 when inside it).
    crown_frequency_months: int | None = None
    #: Subscriber-id format the clearinghouse/payer enforces (A7:164 otherwise).
    subscriber_id_digits: int | None = None
    alternate_benefit: bool = False
    #: Occasionally applies PR-1 deductible though met (the Foster case).
    deductible_posting_errors: bool = False
    #: Sends an 835 only on request for small EFTs (Guardian).
    era_on_request_below_cents: int | None = None
    paper_check_rate: float = 0.0
    no_balance_billing: bool = False
    perio_chart_required: tuple[str, ...] = ()
    pre_auth_required: tuple[str, ...] = ()
    reprocessing_on_prompt_pay: bool = False
    rep_call_prefix: str = ""
    rules: tuple[str, ...] = field(default_factory=tuple)
    file_times: tuple[str, ...] = FILE_TIMES


PROFILES: dict[PayerKey, PayerProfile] = {
    PayerKey.DELTA_NY: PayerProfile(
        key=PayerKey.DELTA_NY,
        name="Delta Dental of New York",
        short_name="Delta",
        payer_id="11198",
        type=PayerType.PPO,
        timely_filing_days=365,
        appeal_window_days=180,
        appeal_levels=2,
        era_weekdays=(0, 3),  # Mon/Thu: 04-seed pins Delta ERAs on Mondays (10/26, 11/09)
        latency_bd=(12, 20),
        icn_prefix="26",
        requires_pa=("D2740", "D2750", "D2790"),
        crown_frequency_months=60,
        perio_chart_required=("D4341", "D4342"),
        rep_call_prefix="DD",
        rules=(
            "D27xx crowns require a pre-operative periapical radiograph (PA); a bitewing does not satisfy it.",
            "Crowns: 1 per tooth per 60 months, using Delta's tooth history.",
            "D4341/D4342 require a perio chart with pocket depths and a narrative.",
            "Preventive 100%, basic 80%, major 50% after a $50 deductible; annual maximum typically $1,500.",
            "835s on Monday and Thursday.",
        ),
    ),
    PayerKey.METLIFE: PayerProfile(
        key=PayerKey.METLIFE,
        name="MetLife Dental",
        short_name="MetLife",
        payer_id="65978",
        type=PayerType.PPO,
        timely_filing_days=365,
        appeal_window_days=180,
        appeal_levels=2,
        era_weekdays=(1, 3),
        latency_bd=(15, 30),
        icn_prefix="ML",
        subscriber_id_digits=9,
        reprocessing_on_prompt_pay=True,
        rep_call_prefix="ML",
        rules=(
            "Subscriber id is 9 digits; anything else rejects at the clearinghouse as A7:164.",
            "NY prompt-pay (Ins. Law §3224-a) reprocessing requests are honored for insured plans.",
            "As secondary: pays 50% after deductible on the primary's allowed amount (COB).",
        ),
    ),
    PayerKey.CIGNA: PayerProfile(
        key=PayerKey.CIGNA,
        name="Cigna Dental",
        short_name="Cigna",
        payer_id="62308",
        type=PayerType.PPO,
        timely_filing_days=90,
        appeal_window_days=180,
        appeal_levels=2,
        era_weekdays=(0, 2, 4),
        latency_bd=(10, 18),
        icn_prefix="CG",
        alternate_benefit=True,
        deductible_posting_errors=True,
        perio_chart_required=("D4341",),
        rep_call_prefix="CG",
        rules=(
            "Alternate benefit: posterior composites are paid at the amalgam rate (D2392 → D2150).",
            "Known posting quirk: PR-1 deductible occasionally applied though met; request reprocessing.",
            "D4341 needs a chart with pocket depths for each billed quadrant.",
        ),
    ),
    PayerKey.AETNA: PayerProfile(
        key=PayerKey.AETNA,
        name="Aetna Dental",
        short_name="Aetna",
        payer_id="60054",
        type=PayerType.SELF_FUNDED_ERISA,
        timely_filing_days=180,
        appeal_window_days=180,
        appeal_levels=2,
        era_weekdays=(0, 3),
        latency_bd=(14, 25),
        icn_prefix="AE",
        alternate_benefit=True,
        rep_call_prefix="AE",
        rules=(
            "Alternate benefit downgrades on posterior composites; the difference may be billed to the patient "
            "if it was on the estimate.",
            "ERISA plans: 180-day appeal window, 2 levels; provider appeals need the patient's authorization.",
        ),
    ),
    PayerKey.GUARDIAN: PayerProfile(
        key=PayerKey.GUARDIAN,
        name="Guardian Dental",
        short_name="Guardian",
        payer_id="64246",
        type=PayerType.SELF_FUNDED_ERISA,
        timely_filing_days=180,
        appeal_window_days=180,
        appeal_levels=2,
        era_weekdays=(3,),
        latency_bd=(20, 35),
        icn_prefix="GD",
        era_on_request_below_cents=25_000,
        paper_check_rate=0.15,
        perio_chart_required=("D4341",),
        rep_call_prefix="GD",
        rules=(
            "SRP (D4341): at least 4 teeth per quadrant with pockets of 4 mm or more on the chart (CO-50·N10 "
            "otherwise, after consultant review).",
            "Some groups pay by paper check; small EFTs send an 835 only on request.",
        ),
    ),
    PayerKey.NY_MEDICAID: PayerProfile(
        key=PayerKey.NY_MEDICAID,
        name="NY Medicaid (eMedNY)",
        short_name="NY Medicaid",
        payer_id="NYMCD",
        type=PayerType.MEDICAID,
        timely_filing_days=90,
        appeal_window_days=60,
        appeal_levels=1,
        era_weekdays=(2,),
        latency_bd=(15, 30),
        icn_prefix="MD",
        no_balance_billing=True,
        rep_call_prefix="MD",
        rules=(
            "Medicaid members cannot be balance-billed.",
            "Non-covered services may be billed only with dated written consent signed before treatment.",
            "60-day appeal window.",
        ),
    ),
}


def profile(key: PayerKey | str) -> PayerProfile:
    return PROFILES[PayerKey(key)]
