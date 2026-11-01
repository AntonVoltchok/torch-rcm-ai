"""canonical: Harbor Dental at Wed 10/28 10:40, reconciled to docs/spec/04-seed.md."""

from __future__ import annotations

from torch.seed.builder import SeedWorld
from torch.seed.canonical import build as build_canonical


def build() -> SeedWorld:
    return build_canonical(scenario="canonical")
