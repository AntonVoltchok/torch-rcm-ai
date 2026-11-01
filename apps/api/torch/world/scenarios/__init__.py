"""Scenarios: the canonical reconciled practice plus variants for tests and the demo (docs/spec/03-mock-world.md)."""

from __future__ import annotations

from collections.abc import Callable

from torch.seed.builder import SeedWorld
from torch.world.scenarios import canonical, dso_4000_claims, empty_inbox, observe_mode_day3, portal_outage

SCENARIOS: dict[str, Callable[[], SeedWorld]] = {
    "canonical": canonical.build,
    "empty_inbox": empty_inbox.build,
    "portal_outage": portal_outage.build,
    "observe_mode_day3": observe_mode_day3.build,
    "dso_4000_claims": dso_4000_claims.build,
}


def build_scenario(name: str) -> SeedWorld:
    try:
        return SCENARIOS[name]()
    except KeyError as exc:
        raise ValueError(f"unknown scenario {name!r}; one of {sorted(SCENARIOS)}") from exc
