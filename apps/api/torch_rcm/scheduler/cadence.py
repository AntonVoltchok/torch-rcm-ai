"""Status-check cadence: day 30 from send, then every 15 days (01-domain-model), on business days."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from torch_rcm.world.calendar import at, on_or_after_business_day

FIRST_CHECK_DAYS = 30
EVERY_DAYS = 15
CHECK_TIME = "07:00"


def status_check_dates(sent_on: date) -> list[date]:
    """Nominal check days (not moved off weekends): day 30, 45, 60, …"""
    return [sent_on + timedelta(days=FIRST_CHECK_DAYS + EVERY_DAYS * n) for n in range(24)]


def next_status_check(sent_on: date, after: datetime) -> tuple[int, datetime]:
    """(check number, when) of the first check strictly after `after`, moved to the next business day."""
    for n, nominal in enumerate(status_check_dates(sent_on)):
        when = at(on_or_after_business_day(nominal), CHECK_TIME)
        if when > after:
            return n, when
    raise ValueError("no status check within a year")  # pragma: no cover
