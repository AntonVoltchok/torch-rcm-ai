"""The initial job schedule for a seeded world: the next file, pending acks, ERA days, status checks, checkouts,
hold aging and eligibility sweeps. Every later job is enqueued by a handler (self-continuing chains)."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from torch.domain.entities import Appointment, Claim, FileEntry, Hold, Job
from torch.domain.enums import AckStage, ClaimStatus, FileEntryState, PayerKey
from torch.scheduler import kinds as K
from torch.scheduler.cadence import next_status_check
from torch.scheduler.handlers import ERA_TIME
from torch.scheduler.queue import job_id
from torch.seed.builder import SeedWorld
from torch.world.calendar import FILE_TIMES, at, next_business_day, next_file_time, next_weekday_on
from torch.world.payers.profiles import PROFILES
from torch.world.rng import keyed_int

S = ClaimStatus


def _job(kind: str, due: datetime, payload: dict[str, Any], key: str, priority: int | None, now: datetime) -> Job:
    return Job(
        id=job_id(key),
        kind=kind,
        due_at=due,
        priority=K.PRIORITY.get(kind, 50) if priority is None else priority,
        payload=payload,
        idempotency_key=key,
        created_at=now,
    )


def initial_jobs(w: SeedWorld) -> list[Job]:
    now = w.now
    today = now.date()
    jobs: dict[str, Job] = {}

    def add(kind: str, due: datetime, payload: dict[str, Any], key: str, priority: int | None = None) -> None:
        jobs.setdefault(key, _job(kind, due, payload, key, priority, now))

    first_file = next_file_time(now, FILE_TIMES)
    add(K.FILE_DEPART, first_file, {"file_time": first_file.isoformat()}, f"file:{first_file.isoformat()}")
    queued = {e.claim_id for e in w.of(FileEntry) if e.state is FileEntryState.QUEUED}
    for claim in w.of(Claim):
        if claim.closed_reason is not None:
            continue
        _claim_jobs(claim, now, queued, add, w.seed)
    for payer in PayerKey:
        day = (
            today
            if today.weekday() in PROFILES[payer].era_weekdays and at(today, ERA_TIME[payer]) > now
            else next_weekday_on(today, PROFILES[payer].era_weekdays)
        )
        add(
            K.ERA_ARRIVE,
            at(day, ERA_TIME[payer]),
            {"payer": payer.value, "day": day.isoformat()},
            f"era:{payer.value}:{day.isoformat()}",
        )
    for appt in w.of(Appointment):
        if appt.checkout_at and appt.checkout_at > now:
            add(K.VISIT_CHECKOUT, appt.checkout_at, {"appointment_id": appt.id}, f"checkout:{appt.id}")
    if any(h.cleared_at is None for h in w.of(Hold)):
        nxt = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        add(K.HOLD_AGE, nxt, {}, f"hold_age:{nxt.isoformat()}")
    day = today
    for _ in range(7):
        add(
            K.ELIGIBILITY_SWEEP,
            at(day, "17:00"),
            {"for_date": next_business_day(day).isoformat()},
            f"eligibility_sweep:{day.isoformat()}",
        )
        day = next_business_day(day)
    return list(jobs.values())


def _claim_jobs(claim: Claim, now: datetime, queued: set[str], add, seed: int) -> None:  # type: ignore[no-untyped-def]
    if claim.status is S.SENT and claim.ack_stage is AckStage.CH_277CA_A1 and claim.sent_at:
        day = next_business_day(claim.sent_at.date())
        when = at(day, "06:00") + timedelta(minutes=keyed_int(seed, 5, 115, "ack", claim.id))
        add(K.ACK_PAYER, when, {"claim_id": claim.id}, f"ackpayer:{claim.id}:{when.date().isoformat()}")
    if claim.status is S.ACCEPTED:
        morning = at(next_business_day(now.date()), "05:00")
        add(K.PAYER_IN_PROCESS, morning, {"claim_id": claim.id}, f"inprocess:{claim.id}")
    if claim.status in (S.ACCEPTED, S.PENDING, S.DENIED) and claim.sent_at and not claim.secondary:
        n, when = next_status_check(claim.sent_at.date(), now)
        add(
            K.STATUS_CHECK_DUE,
            when,
            {"claim_id": claim.id, "n": n},
            f"status_check:{claim.id}:{when.date().isoformat()}",
        )


def first_era_day(today: date, payer: PayerKey) -> date:
    return next_weekday_on(today - timedelta(days=1), PROFILES[payer].era_weekdays)
