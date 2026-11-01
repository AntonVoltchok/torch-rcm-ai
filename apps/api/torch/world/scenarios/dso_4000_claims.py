"""dso_4000_claims: the canonical practice plus ~4,000 additional paid and pending claims, for Claims-table
performance (virtualized rows, server-side sort/filter). Totals are not reconciled in this scenario."""

from __future__ import annotations

from datetime import timedelta

from torch.domain.entities import Claim
from torch.domain.enums import ClaimStatus
from torch.seed.builder import SeedWorld
from torch.seed.canonical import build as build_canonical

EXTRA = 4_000


def build() -> SeedWorld:
    w = build_canonical(scenario="dso_4000_claims")
    templates = [
        c
        for c in w.of(Claim)
        if c.status in (ClaimStatus.PAID, ClaimStatus.PENDING) and not c.secondary and c.closed_reason is None
    ]
    for i in range(EXTRA):
        src = templates[i % len(templates)]
        number = 20_000 + i
        shift = timedelta(days=(i % 60))
        clone = src.model_copy(
            update={
                "id": f"clm_{number}",
                "number": number,
                "visit_id": None,
                "dos": src.dos - shift,
                "built_at": src.built_at - shift,
                "sent_at": src.sent_at - shift if src.sent_at else None,
                "paid_at": src.paid_at - shift if src.paid_at else None,
                "lines": [
                    line.model_copy(update={"id": f"cl_{number}_{j}", "procedure_line_id": None})
                    for j, line in enumerate(src.lines, 1)
                ],
            },
            deep=True,
        )
        w.add(clone)
    return w
