"""Business-hours helpers for the simulated world: payer files, morning acks, ERA weekdays, business days.

Payers and the clearinghouse work business days; the six processing holidays below are the ones every dental
payer observes. Everything is in practice time (America/New_York); DST is handled by zoneinfo.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from torch_rcm.clock import PRACTICE_TZ

PROCESSING_HOLIDAYS: frozenset[date] = frozenset(
    {
        date(2026, 1, 1),
        date(2026, 5, 25),
        date(2026, 7, 3),
        date(2026, 9, 7),
        date(2026, 11, 26),
        date(2026, 12, 25),
        date(2027, 1, 1),
    }
)

#: Vyne file cut-offs: every 30 minutes, 07:45–18:15, business days (the same grid for every payer).
FILE_TIMES: tuple[str, ...] = tuple(
    f"{h:02d}:{m:02d}" for h in range(7, 19) for m in (15, 45) if (7, 45) <= (h, m) <= (18, 15)
)


def at(d: date, hhmm: str) -> datetime:
    hours, minutes = (int(x) for x in hhmm.split(":"))
    return datetime.combine(d, time(hours, minutes), tzinfo=PRACTICE_TZ)


def is_business_day(d: date) -> bool:
    return d.weekday() < 5 and d not in PROCESSING_HOLIDAYS


def next_business_day(d: date) -> date:
    nxt = d + timedelta(days=1)
    while not is_business_day(nxt):
        nxt += timedelta(days=1)
    return nxt


def on_or_after_business_day(d: date) -> date:
    return d if is_business_day(d) else next_business_day(d)


def add_business_days(d: date, n: int) -> date:
    out = d
    for _ in range(n):
        out = next_business_day(out)
    return out


def business_days_between(start: date, end: date) -> int:
    """Business days in (start, end]."""
    count, cur = 0, start
    while cur < end:
        cur += timedelta(days=1)
        if is_business_day(cur):
            count += 1
    return count


def next_file_time(after: datetime, file_times: tuple[str, ...] | list[str] = FILE_TIMES) -> datetime:
    """The first payer file strictly after `after` (claims queued at 10:45:00 miss the 10:45 file)."""
    local = after.astimezone(PRACTICE_TZ)
    day = local.date()
    for _ in range(14):
        if is_business_day(day):
            for hhmm in file_times:
                candidate = at(day, hhmm)
                if candidate > local:
                    return candidate
        day += timedelta(days=1)
    raise RuntimeError("no file time within two weeks")  # pragma: no cover - holidays never span 14 days


def business_morning(d: date, minute_offset: int) -> datetime:
    """06:00 + offset (0–119 min) on the given day: when overnight payer acks arrive."""
    return at(d, "06:00") + timedelta(minutes=max(0, min(minute_offset, 119)))


def next_weekday_on(after: date, weekdays: list[int] | tuple[int, ...]) -> date:
    """The first business day strictly after `after` whose weekday is in `weekdays` (0 = Monday)."""
    day = after + timedelta(days=1)
    for _ in range(21):
        if day.weekday() in weekdays and is_business_day(day):
            return day
        day += timedelta(days=1)
    raise RuntimeError("no matching weekday within three weeks")  # pragma: no cover


def days_between(start: date, end: date) -> int:
    return (end - start).days
