"""World job handlers: files leave, acks arrive, 835s arrive, the PMS checks patients out, holds age.

Each handler is idempotent (it checks world state first) and enqueues the follow-ups with deterministic keys.
Agent reactions are *enqueued* as agent job kinds (torch/scheduler/kinds.py) for torch.agents to handle.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from torch.domain.entities import Claim, FileEntry, Hold, InboxItem
from torch.domain.enums import ClaimStatus, FileEntryState, InboxItemState, PayerKey
from torch.scheduler import kinds as K
from torch.scheduler.cadence import next_status_check
from torch.scheduler.registry import JobContext, JobOutcome, Registry, registry
from torch.world.calendar import at, next_business_day
from torch.world.sim import World

ERA_TIME: dict[PayerKey, str] = {
    PayerKey.DELTA_NY: "05:40",
    PayerKey.METLIFE: "05:45",
    PayerKey.AETNA: "05:50",
    PayerKey.GUARDIAN: "06:05",
    PayerKey.CIGNA: "06:20",
    PayerKey.NY_MEDICAID: "06:30",
}
HOLD_THRESHOLDS = (30, 14)


def _world(ctx: JobContext) -> World:
    world: World = ctx.world
    return world


def file_depart(ctx: JobContext) -> JobOutcome:
    out = JobOutcome()
    file_time = datetime.fromisoformat(ctx.job.payload["file_time"])
    world = _world(ctx)
    for ev in world.vyne.depart(file_time):
        out.add(ev.kind, ev.summary, **ev.data)
        claim_id = ev.data["claim_id"]
        ctx.enqueue(
            K.ACK_CLEARINGHOUSE,
            file_time + timedelta(minutes=4),
            {"claim_id": claim_id},
            f"ackch:{claim_id}:{file_time.isoformat()}",
        )
    nxt = world.vyne.next_file_time(file_time)
    ctx.enqueue(K.FILE_DEPART, nxt, {"file_time": nxt.isoformat()}, f"file:{nxt.isoformat()}")
    return out


def ack_clearinghouse(ctx: JobContext) -> JobOutcome:
    out = JobOutcome()
    world = _world(ctx)
    claim_id = ctx.job.payload["claim_id"]
    ev = world.vyne.clearinghouse_ack(claim_id, ctx.job.payload.get("code"))
    out.add(ev.kind, ev.summary, **ev.data)
    claim = ctx.store.require(Claim, claim_id)
    if ev.data["code"] != "A1":
        ctx.enqueue(
            K.CLAIM_REJECTED,
            ctx.now,
            {"claim_id": claim_id, "code": ev.data["code"]},
            f"rejected:{claim_id}:{ctx.now.isoformat()}",
        )
    else:
        when = world.payer(claim.payer_key).ack_time(ctx.now)
        ctx.enqueue(K.ACK_PAYER, when, {"claim_id": claim_id}, f"ackpayer:{claim_id}:{when.date().isoformat()}")
    return out


def ack_payer(ctx: JobContext) -> JobOutcome:
    out = JobOutcome()
    world = _world(ctx)
    claim_id = ctx.job.payload["claim_id"]
    claim = ctx.store.require(Claim, claim_id)
    if claim.status not in (ClaimStatus.SENT, ClaimStatus.DENIED):
        return out
    ev = world.payer(claim.payer_key).ack(claim_id)
    out.add(ev.kind, ev.summary, **ev.data)
    if not ev.data["resubmit"]:
        morning = at(next_business_day(ctx.now.date()), "05:00")
        ctx.enqueue(K.PAYER_IN_PROCESS, morning, {"claim_id": claim_id}, f"inprocess:{claim_id}")
    sent = claim.sent_at or ctx.now
    n, when = next_status_check(sent.date(), ctx.now)
    ctx.enqueue(
        K.STATUS_CHECK_DUE,
        when,
        {"claim_id": claim_id, "n": n},
        f"status_check:{claim_id}:{when.date().isoformat()}",
    )
    return out


def payer_in_process(ctx: JobContext) -> JobOutcome:
    out = JobOutcome()
    claim = ctx.store.require(Claim, ctx.job.payload["claim_id"])
    ev = _world(ctx).payer(claim.payer_key).in_process(claim.id)
    if ev is not None:
        out.add(ev.kind, ev.summary, **ev.data)
    return out


def era_arrive(ctx: JobContext) -> JobOutcome:
    out = JobOutcome()
    payer = PayerKey(ctx.job.payload["payer"])
    day = date.fromisoformat(ctx.job.payload["day"])
    sim = _world(ctx).payer(payer)
    remit = sim.era(day)
    if remit is not None:
        denied = [line for line in remit.lines if line.paid == 0 and line.adj and line.adj[0].code != "45"]
        claims = {line.claim_id for line in remit.lines}
        out.add(
            "era_arrived",
            f"{sim.profile.short_name} 835 · {len(claims)} claims · ${remit.amount_cents / 100:,.2f}",
            remittance_id=remit.id,
            payer=payer.value,
        )
        for claim_id in sorted({line.claim_id for line in denied if line.claim_id}):
            claim = ctx.store.require(Claim, claim_id)
            if claim.denial:
                code = f"{claim.denial.carc}{' · ' + claim.denial.rarc if claim.denial.rarc else ''}"
                out.add(
                    "claim_denied",
                    f"#{claim.number} denied {code}",
                    claim_id=claim_id,
                    carc=claim.denial.carc,
                    rarc=claim.denial.rarc,
                )
        ctx.enqueue(K.ERA_ARRIVED, ctx.now, {"remittance_id": remit.id}, f"era_arrived:{remit.id}")
    nxt = sim.next_era_day(day)
    when = at(nxt, ERA_TIME[payer])
    ctx.enqueue(
        K.ERA_ARRIVE,
        when,
        {"payer": payer.value, "day": nxt.isoformat()},
        f"era:{payer.value}:{nxt.isoformat()}",
    )
    return out


def visit_checkout(ctx: JobContext) -> JobOutcome:
    out = JobOutcome()
    appt_id = ctx.job.payload["appointment_id"]
    visit = _world(ctx).pms.checkout(appt_id)
    out.add(
        "visit_checked_out",
        f"{visit.patient_id.removeprefix('pat_')} checked out",
        visit_id=visit.id,
        appointment_id=appt_id,
    )
    ctx.enqueue(
        K.VISIT_CHECKED_OUT,
        ctx.now,
        {"visit_id": visit.id, "appointment_id": appt_id},
        f"checked_out:{visit.id}",
    )
    return out


def hold_age(ctx: JobContext) -> JobOutcome:
    out = JobOutcome()
    today = ctx.now.date()
    for hold in ctx.store.find(Hold, {"cleared_at": None}):
        if hold.timely_due is None:
            continue
        left = (hold.timely_due - today).days
        for threshold in HOLD_THRESHOLDS:
            if left <= threshold:
                job = ctx.enqueue(
                    K.HOLD_ESCALATE,
                    ctx.now,
                    {"hold_id": hold.id, "threshold_days": threshold},
                    f"hold_escalate:{hold.id}:{threshold}",
                )
                if job.created_at == ctx.now:
                    out.add(
                        "hold_escalated",
                        f"{hold.subject_id} hold at T-{threshold} d timely filing",
                        hold_id=hold.id,
                    )
    nxt = ctx.now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    ctx.enqueue(K.HOLD_AGE, nxt, {}, f"hold_age:{nxt.isoformat()}")
    return out


def snooze_wake(ctx: JobContext) -> JobOutcome:
    out = JobOutcome()
    item = ctx.store.get(InboxItem, ctx.job.payload["item_id"])
    if item and item.state is InboxItemState.SNOOZED and item.snoozed_until and item.snoozed_until <= ctx.now:
        item.state = InboxItemState.OPEN
        item.snoozed_until = None
        ctx.store.update(item)
        out.add("item_reopened", f"{item.title} is back", item_id=item.id)
    return out


WORLD_HANDLERS = {
    K.FILE_DEPART: file_depart,
    K.ACK_CLEARINGHOUSE: ack_clearinghouse,
    K.ACK_PAYER: ack_payer,
    K.PAYER_IN_PROCESS: payer_in_process,
    K.ERA_ARRIVE: era_arrive,
    K.VISIT_CHECKOUT: visit_checkout,
    K.HOLD_AGE: hold_age,
    K.SNOOZE_WAKE: snooze_wake,
}


def register_world_handlers(target: Registry = registry) -> None:
    for kind, fn in WORLD_HANDLERS.items():
        if target.get(kind) is None:
            target.register(kind, fn)


def queued_file_entries(ctx: JobContext) -> list[FileEntry]:
    return ctx.store.find(FileEntry, {"state": FileEntryState.QUEUED})
