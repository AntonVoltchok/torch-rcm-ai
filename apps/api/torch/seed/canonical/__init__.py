"""The canonical scenario: the reconciled practice the mocks were drawn from (docs/spec/04-seed.md)."""

from __future__ import annotations

from torch.seed.builder import Builder, SeedWorld
from torch.seed.canonical.agents import build_agent_state
from torch.seed.canonical.generated import Generator
from torch.seed.canonical.ledger import build_ledger
from torch.seed.canonical.people import add_named_patients, add_practice, default_verified
from torch.seed.canonical.pinned import build_pinned
from torch.seed.targets import NOW

CANONICAL_SEED = 20261028


def build_claims_world(seed: int = CANONICAL_SEED, scenario: str = "canonical") -> tuple[Builder, Generator]:
    """Practice, patients and every claim, remittance and production line (no agent state yet)."""
    b = Builder(seed, scenario, NOW)
    add_practice(b)
    people = add_named_patients(b, default_verified(NOW))
    pinned = build_pinned(b, people)  # type: ignore[arg-type]
    gen = Generator(b, pinned)
    gen.add_patients()
    gen.ar_claims()
    gen.paid_claims()
    gen.tune_contractual()
    gen.tune_paid()
    gen.self_pay_fill()
    gen.materialize()
    return b, gen


def build(seed: int = CANONICAL_SEED, scenario: str = "canonical") -> SeedWorld:
    b, gen = build_claims_world(seed, scenario)
    build_ledger(b)
    build_agent_state(b, gen.pinned)
    return b.w
