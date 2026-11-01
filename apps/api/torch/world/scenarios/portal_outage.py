"""portal_outage: the Delta portal and IVR go down at 10:52 (seeded); agent status checks fail over, and a run
whose deadline is close produces exactly one `run_failed` item (06-demo-script acceptance)."""

from __future__ import annotations

from datetime import timedelta

from torch.domain.entities import Meta
from torch.seed.builder import SeedWorld
from torch.seed.canonical import build as build_canonical
from torch.world.outages import OUTAGE_KEY


def build() -> SeedWorld:
    w = build_canonical(scenario="portal_outage")
    since = (w.now + timedelta(minutes=12)).isoformat()
    w.add(
        Meta(
            id=OUTAGE_KEY,
            value={
                "payer:delta_ny:portal": {"since": since, "until": ""},
                "payer:delta_ny:ivr": {"since": since, "until": ""},
            },
        )
    )
    return w
