"""Lease time. Leases protect a process from another process (07-agents §8: "wall clock"), not a business fact,
so this is the one place in torch/ that reads wall-clock time. A test asserts no other module does."""

from __future__ import annotations

import time

LEASE_SECONDS = 30.0


def wall_now() -> float:
    return time.time()


def lease_until(seconds: float = LEASE_SECONDS) -> float:
    return wall_now() + seconds


def expired(until: float | None) -> bool:
    return until is None or until < wall_now()
