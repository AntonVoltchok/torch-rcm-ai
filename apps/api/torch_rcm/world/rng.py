"""Seeded randomness keyed by entity id, so one claim's draws never depend on how many others exist."""

from __future__ import annotations

import hashlib
import random


def keyed_rng(seed: int | str, *keys: object) -> random.Random:
    digest = hashlib.sha256(":".join([str(seed), *map(str, keys)]).encode()).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))


def keyed_int(seed: int | str, low: int, high: int, *keys: object) -> int:
    """Inclusive integer draw in [low, high]."""
    return keyed_rng(seed, *keys).randint(low, high)


def keyed_chance(seed: int | str, p: float, *keys: object) -> bool:
    return keyed_rng(seed, *keys).random() < p
