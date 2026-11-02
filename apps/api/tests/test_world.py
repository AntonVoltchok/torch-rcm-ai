"""The simulated world: outages, call-log idempotency, clearinghouse rejects, bounded rep calls, checkout."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta

import pytest

from torch_rcm.domain.entities import Claim, Coverage, PayerClaim, Visit, WorldCallLog
from torch_rcm.domain.enums import ClaimStatus, PayerKey, RootCause
from torch_rcm.runtime import Runtime
from torch_rcm.world.calendar import FILE_TIMES, is_business_day, next_file_time
from torch_rcm.world.calllog import CallLog, WorldUnavailableError
from torch_rcm.world.rng import keyed_int


def test_injected_portal_outage_raises_and_is_recorded(rt: Runtime) -> None:
    payer = rt.world.payer(PayerKey.DELTA_NY)
    ok = payer.check_status("clm_4821")
    assert "Denied" in ok["status_text"] and ok["reference"].startswith("DD-")
    rt.world.outages.inject("payer:delta_ny:portal", rt.clock.now())
    with pytest.raises(WorldUnavailableError) as err:
        payer.check_status("clm_4821")
    assert err.value.retry_after > rt.clock.now()
    failed = [c for c in rt.store.all(WorldCallLog) if not c.ok]
    assert failed and "unavailable" in (failed[-1].error or "")
    rt.world.outages.restore("payer:delta_ny:portal")
    assert payer.check_status("clm_4821")["status_text"]


def test_portal_outage_scenario_starts_at_1052() -> None:
    from torch_rcm.world.scenarios import build_scenario

    w = build_scenario("portal_outage")
    meta = next(m for m in w.entities[next(k for k in w.entities if k.__name__ == "Meta")] if m.id == "outages")
    assert meta.value["payer:delta_ny:portal"]["since"].startswith("2026-10-28T10:52")


def test_seeded_outages_are_rare_and_deterministic(rt: Runtime) -> None:
    hours = [datetime.fromisoformat("2026-10-01T07:00:00-04:00") + timedelta(hours=h) for h in range(24 * 60)]
    down = [h for h in hours if rt.world.outages.window("payer:cigna:portal", h)]
    business = [h for h in hours if is_business_day(h.date()) and 7 <= h.hour < 19]
    assert 0 < len(down) < 0.05 * len(business)
    assert down == [h for h in hours if rt.world.outages.window("payer:cigna:portal", h)]


def test_nea_upload_is_idempotent_by_key(rt: Runtime) -> None:
    first = rt.world.nea.upload("clm_4821", "img_owens_k_1012_pa_19", "pa", key="appr:itm_4821:nea_upload")
    again = rt.world.nea.upload("clm_4821", "img_owens_k_1012_pa_19", "pa", key="appr:itm_4821:nea_upload")
    assert first["nea_number"] == again["nea_number"]
    claim = rt.store.require(Claim, "clm_4821")
    assert sum(1 for a in claim.attachments if a.nea_number == first["nea_number"]) == 1


def test_metlife_rejects_a_non_nine_digit_subscriber_id(rt: Runtime) -> None:
    claim = rt.store.require(Claim, "clm_4856")  # Tran, MetLife, leaving in the 10:45 file
    cov = rt.store.require(Coverage, claim.coverage_id)
    cov.subscriber_id = "60488542"
    rt.store.update(cov)
    asyncio.run(rt.scheduler.run_due(datetime.fromisoformat("2026-10-28T10:50:00-04:00")))
    claim = rt.store.require(Claim, "clm_4856")
    assert claim.status is ClaimStatus.REJECTED and claim.reason_text == "subscriber ID"


def test_rep_call_never_agrees_outside_bounds(rt: Runtime) -> None:
    payer = rt.world.payer(PayerKey.DELTA_NY)
    offers = [
        payer.call_rep("clm_4821", "denial_reason", ["confirm_status", "write_off"], key=f"rep:{i}") for i in range(40)
    ]
    assert all("write_off" not in o["agreed"] for o in offers)
    flagged = [o for o in offers if o["offer"]]
    assert flagged and all(o["requires_human"] and "confirm with the practice" in o["transcript"] for o in flagged)


def test_checkout_creates_visit_from_the_appointment(rt: Runtime) -> None:
    asyncio.run(rt.scheduler.run_due(datetime.fromisoformat("2026-10-28T10:53:00-04:00")))
    visits = [v for v in rt.store.all(Visit) if v.appointment_id == "apt_1028_reyes_a"]
    assert len(visits) == 1 and visits[0].completed_at.strftime("%H:%M") == "10:52"


def test_file_times_and_business_days() -> None:
    wed = datetime.fromisoformat("2026-10-28T10:40:00-04:00")
    assert next_file_time(wed, FILE_TIMES).strftime("%H:%M") == "10:45"
    assert next_file_time(wed.replace(hour=10, minute=45), FILE_TIMES).strftime("%H:%M") == "11:15"
    fri_evening = datetime.fromisoformat("2026-10-30T18:30:00-04:00")
    assert next_file_time(fri_evening, FILE_TIMES).isoformat() == "2026-11-02T07:45:00-05:00", "DST ends 11/01"
    assert not is_business_day(date(2026, 11, 26)), "Thanksgiving"


def test_keyed_rng_is_stable() -> None:
    assert keyed_int(1, 0, 10**6, "clm_4821") == keyed_int(1, 0, 10**6, "clm_4821")
    assert keyed_int(1, 0, 10**6, "clm_4821") != keyed_int(1, 0, 10**6, "clm_4822")


@pytest.mark.parametrize(("stored", "kept"), [(RootCause.OURS, RootCause.OURS), (RootCause.PAYER, RootCause.PAYER)])
def test_a_second_denial_keeps_a_recorded_ours(rt: Runtime, stored: RootCause, kept: RootCause) -> None:
    """Re-adjudication replaces the denial, and that must never loosen the `ours` guard."""
    claim = rt.store.require(Claim, "clm_4821")
    assert claim.denial is not None
    claim.denial = claim.denial.model_copy(update={"root_cause": stored})
    claim.status = ClaimStatus.PENDING
    rt.store.update(claim)
    pc = rt.store.require(PayerClaim, claim.id)
    pc.outcome = "CO-16:N29"
    rt.store.update(pc)

    rt.world.payer(PayerKey.DELTA_NY)._adjudicate(pc, rt.clock.now(), "rem_again", 0)

    denial = rt.store.require(Claim, claim.id).denial
    assert denial is not None and denial.carc == "CO-16" and denial.root_cause is kept


def test_call_ids_stay_unique_across_a_restart_on_the_frozen_clock(rt: Runtime) -> None:
    def read() -> dict[str, str]:
        return {"ok": "yes"}

    def calls(log: CallLog, n: int) -> None:
        for _ in range(n):
            log.record("payer:delta_ny", "portal.read", read, mutation=False)

    calls(CallLog(rt.store, rt.clock), 4)
    calls(CallLog(rt.store, rt.clock), 4)  # a new process: the clock has not moved, and the rows are still there
