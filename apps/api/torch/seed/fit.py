"""Exact-fit helpers for the seed generator (docs/plans/api-core.md D8).

1. `Composer` turns a whole-dollar amount into a plausible set of CDT lines from the one practice fee schedule:
   a realistic visit *core* plus at most three add-on lines.
2. `fit_amounts` gives generated claim *slots* labelled (status, payer, aging bucket) whole-dollar amounts whose
   sums hit every marginal exactly, using only amounts the composer can build: iterative proportional fitting,
   snap to the nearest composable amount, then integer repair moves that keep every amount composable.
"""

from __future__ import annotations

import random
from collections import defaultdict
from collections.abc import Callable, Hashable, Sequence
from dataclasses import dataclass

from torch.world.fees import CODES

#: Visit "cores" by kind; each is a realistic visit. Add-ons fill the remainder.
CORES: dict[str, tuple[tuple[str, ...], ...]] = {
    "hygiene": (
        ("D0120", "D1110"),
        ("D0120", "D1110", "D0274"),
        ("D0120", "D1110", "D0272"),
        ("D0150", "D0210", "D1110"),
        ("D0120", "D4910"),
        ("D0120", "D4910", "D0274"),
        ("D0150", "D0330", "D1110"),
        ("D0140", "D0220"),
        ("D0140", "D0220", "D0230"),
        ("D0120",),
        ("D1110",),
        ("D0140",),
    ),
    "perio": (
        ("D4341", "D4341"),
        ("D4341", "D4342"),
        ("D4341", "D4341", "D4341", "D4341"),
        ("D4342",),
        ("D4341",),
    ),
    "restorative": (
        ("D2391",),
        ("D2392",),
        ("D2393",),
        ("D2394",),
        ("D2392", "D2391"),
        ("D2150",),
        ("D2140",),
        ("D2393", "D2392"),
    ),
    "crown": (
        ("D2740", "D2950"),
        ("D2750", "D2950"),
        ("D2740",),
        ("D2750",),
        ("D2740", "D2950", "D0220"),
        ("D2740", "D2740"),
        ("D2740", "D2950", "D2740", "D2950"),
        ("D2954", "D2740"),
    ),
    "endo": (
        ("D3310",),
        ("D3320",),
        ("D3330",),
        ("D3330", "D2950"),
        ("D3320", "D2950"),
        ("D3330", "D2950", "D2740"),
        ("D3320", "D2950", "D2740"),
    ),
    "surgery": (("D7140",), ("D7210",), ("D7140", "D7140"), ("D7210", "D7140")),
    "bridge": (
        ("D6240", "D6750", "D6750"),
        ("D6240", "D6240", "D6750", "D6750"),
        ("D2740", "D2950", "D2740", "D2950", "D2740", "D2950"),
    ),
    "selfpay": (
        ("D6010",),
        ("D6065",),
        ("D6057", "D6065"),
        ("D9972",),
        ("D9944",),
        ("D9972", "D9972"),
        ("D1110",),
    ),
}
INSURED_KINDS: tuple[str, ...] = ("hygiene", "perio", "restorative", "crown", "endo", "surgery", "bridge")

#: Add-on codes with how many times they may appear on one claim.
ADD_ONS: dict[str, tuple[tuple[str, int], ...]] = {
    "clinical": (
        ("D0220", 1),
        ("D0230", 3),
        ("D0140", 1),
        ("D0120", 1),
        ("D0274", 1),
        ("D0272", 1),
        ("D1206", 1),
        ("D1208", 1),
        ("D1110", 1),
        ("D1351", 4),
        ("D2391", 2),
        ("D2392", 2),
        ("D2393", 1),
        ("D2140", 1),
        ("D2150", 1),
        ("D7140", 1),
        ("D4342", 2),
        ("D0330", 1),
        ("D2950", 1),
        ("D9110", 1),
    ),
    "selfpay": (
        ("D1110", 1),
        ("D0120", 1),
        ("D0274", 1),
        ("D0150", 1),
        ("D0220", 1),
        ("D0230", 2),
        ("D1206", 1),
        ("D9972", 1),
        ("D6057", 1),
        ("D0330", 1),
        ("D2391", 1),
        ("D2392", 1),
    ),
}

EXCLUSIVE: tuple[frozenset[str], ...] = (
    frozenset({"D0120", "D0150", "D0140"}),
    frozenset({"D0272", "D0274", "D0210"}),
    frozenset({"D1110", "D4910"}),
    frozenset({"D1206", "D1208"}),
)
MAX_ADD_ONS = 4


def _dollars(cdt: str) -> int:
    return CODES[cdt].fee_cents // 100


def _conflicts(codes: Sequence[str], candidate: str) -> bool:
    """Exams, prophies and image series appear once per claim; per-tooth/per-quadrant codes may repeat."""
    present = set(codes)
    code = CODES[candidate]
    if candidate in present and not (code.per_tooth or code.per_quadrant):
        return True
    return any(candidate in group and present & (group - {candidate}) for group in EXCLUSIVE)


class CompositionError(ValueError):
    pass


def _reachable(core: tuple[str, ...], items: tuple[tuple[str, int], ...]) -> dict[int, tuple[str, ...]]:
    """Every add-on total reachable on top of `core` with at most MAX_ADD_ONS lines (fewest lines kept)."""
    best: dict[int, tuple[str, ...]] = {0: ()}
    for code, times in items:
        if _conflicts(core, code):
            continue
        for _ in range(times):
            for amount, combo in list(best.items()):
                if len(combo) >= MAX_ADD_ONS or _conflicts([*core, *combo], code):
                    continue
                new_amount = amount + _dollars(code)
                candidate = (*combo, code)
                if new_amount not in best or len(candidate) < len(best[new_amount]):
                    best[new_amount] = candidate
    return best


class Composer:
    """Precomputed compositions for every core; `compose` is a dictionary lookup."""

    def __init__(self) -> None:
        self._table: dict[str, list[tuple[tuple[str, ...], int, dict[int, tuple[str, ...]]]]] = {}
        for kind, cores in CORES.items():
            add_set = ADD_ONS["selfpay" if kind == "selfpay" else "clinical"]
            self._table[kind] = [(core, sum(_dollars(c) for c in core), _reachable(core, add_set)) for core in cores]
        self._possible: dict[str, set[int]] = {
            kind: {core_sum + extra for _, core_sum, reach in rows for extra in reach}
            for kind, rows in self._table.items()
        }

    def possible(self, dollars: int, kinds: Sequence[str]) -> bool:
        return any(dollars in self._possible[k] for k in kinds)

    def compose(self, dollars: int, kinds: Sequence[str], rng: random.Random) -> list[str]:
        options: list[list[str]] = []
        for kind in kinds:
            for core, core_sum, reach in self._table[kind]:
                extra = reach.get(dollars - core_sum)
                if extra is not None:
                    options.append([*core, *extra])
        if not options:
            raise CompositionError(f"cannot compose ${dollars} from {list(kinds)}")
        fewest = min(len(o) for o in options)
        plausible = [o for o in options if len(o) <= fewest + 1]
        return rng.choice(plausible)


# ── amount fitting ─────────────────────────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class Slot:
    key: str
    labels: tuple[Hashable, ...]  # one label per dimension, e.g. (status, payer, bucket)
    weight: float  # starting amount (dollars)
    kinds: tuple[str, ...] = INSURED_KINDS
    minimum: int = 142


class FitError(ValueError):
    pass


Allowed = Callable[[Slot, int], bool]


def fit_amounts(
    slots: list[Slot],
    targets: Sequence[dict[Hashable, int]],
    allowed: Allowed,
    rng: random.Random,
    iterations: int = 300,
) -> dict[str, int]:
    """Whole-dollar, composable amounts per slot whose label sums equal `targets[d][label]` in every dimension."""
    totals = {sum(t.values()) for t in targets}
    if len(totals) != 1:
        raise FitError(f"marginals disagree: {totals}")
    weights = _ipf(slots, targets, iterations)
    amounts = {s.key: _nearest_allowed(s, round(weights[s.key]), allowed) for s in slots}
    _repair(slots, targets, amounts, allowed, rng)
    return amounts


def _ipf(slots: list[Slot], targets: Sequence[dict[Hashable, int]], iterations: int) -> dict[str, float]:
    weights = {s.key: max(s.weight, float(s.minimum)) for s in slots}
    for _ in range(iterations):
        for dim, target in enumerate(targets):
            sums: dict[Hashable, float] = defaultdict(float)
            for s in slots:
                sums[s.labels[dim]] += weights[s.key]
            for s in slots:
                total = sums[s.labels[dim]]
                if total > 0:
                    weights[s.key] = max(float(s.minimum), weights[s.key] * target[s.labels[dim]] / total)
    return weights


def _nearest_allowed(slot: Slot, value: int, allowed: Allowed) -> int:
    for delta in range(400):
        for candidate in (value + delta, value - delta):
            if candidate >= slot.minimum and allowed(slot, candidate):
                return candidate
    raise FitError(f"no composable amount near ${value} for {slot.key}")


def _residuals(
    slots: list[Slot], targets: Sequence[dict[Hashable, int]], amounts: dict[str, int]
) -> list[dict[Hashable, int]]:
    out: list[dict[Hashable, int]] = []
    for dim, target in enumerate(targets):
        res = dict(target)
        for s in slots:
            res[s.labels[dim]] -= amounts[s.key]
        out.append(res)
    return out


def _repair(
    slots: list[Slot],
    targets: Sequence[dict[Hashable, int]],
    amounts: dict[str, int],
    allowed: Allowed,
    rng: random.Random,
) -> None:
    order = list(slots)
    for _ in range(20_000):
        res = _residuals(slots, targets, amounts)
        if all(v == 0 for r in res for v in r.values()):
            return
        rng.shuffle(order)
        if (
            _single_move(order, res, amounts, allowed)
            or _pair_move(order, res, amounts, allowed)
            or _cell_move(order, res, amounts, allowed)
            or _random_walk(slots, targets, amounts, allowed, rng)
        ):
            continue
        raise FitError(f"cannot repair residuals {res}")
    raise FitError("repair did not converge")


def _single_move(order: list[Slot], res: list[dict[Hashable, int]], amounts: dict[str, int], allowed: Allowed) -> bool:
    """Move one slot by δ when every one of its labels wants the same direction."""
    dims = len(res)
    for s in order:
        wants = [res[d][s.labels[d]] for d in range(dims)]
        if all(w > 0 for w in wants):
            sign, room = 1, min(wants)
        elif all(w < 0 for w in wants):
            sign, room = -1, min(-w for w in wants)
        else:
            continue
        for delta in range(room, 0, -1):
            candidate = amounts[s.key] + sign * delta
            if candidate >= s.minimum and allowed(s, candidate):
                amounts[s.key] = candidate
                return True
    return False


def _pair_move(order: list[Slot], res: list[dict[Hashable, int]], amounts: dict[str, int], allowed: Allowed) -> bool:
    """Fix one dimension without disturbing the others: move δ between two slots that share every other label."""
    dims = len(res)
    for d in range(dims):
        for deficit_label, deficit in res[d].items():
            if deficit <= 0:
                continue
            for surplus_label, surplus in res[d].items():
                if surplus >= 0:
                    continue
                room = min(deficit, -surplus)
                takers = [s for s in order if s.labels[d] == deficit_label]
                givers = [s for s in order if s.labels[d] == surplus_label]
                for taker in takers:
                    for giver in givers:
                        if any(taker.labels[o] != giver.labels[o] for o in range(dims) if o != d):
                            continue
                        if _try_pair(taker, giver, room, amounts, allowed):
                            return True
    return False


def _try_pair(taker: Slot, giver: Slot, room: int, amounts: dict[str, int], allowed: Allowed) -> bool:
    for delta in range(room, 0, -1):
        up, down = amounts[taker.key] + delta, amounts[giver.key] - delta
        if down >= giver.minimum and allowed(taker, up) and allowed(giver, down):
            amounts[taker.key], amounts[giver.key] = up, down
            return True
    return False


def _cell_move(order: list[Slot], res: list[dict[Hashable, int]], amounts: dict[str, int], allowed: Allowed) -> bool:
    """When a slot's labels all want δ but slot ± δ is not composable, split the change with a peer in the same
    cell (same labels in every dimension): s + x and peer + (δ − x), both composable."""
    dims = len(res)
    for s in order:
        wants = [res[d][s.labels[d]] for d in range(dims)]
        if not (all(w > 0 for w in wants) or all(w < 0 for w in wants)):
            continue
        change = min(wants, key=abs)
        peers = [p for p in order if p.key != s.key and p.labels == s.labels]
        for peer in peers:
            for x in sorted(range(-400, 401), key=abs):
                up, other = amounts[s.key] + x, amounts[peer.key] + change - x
                if up < s.minimum or other < peer.minimum:
                    continue
                if allowed(s, up) and allowed(peer, other):
                    amounts[s.key], amounts[peer.key] = up, other
                    return True
    return False


def _l1(res: list[dict[Hashable, int]]) -> int:
    return sum(abs(v) for r in res for v in r.values())


def _random_walk(
    slots: list[Slot],
    targets: Sequence[dict[Hashable, int]],
    amounts: dict[str, int],
    allowed: Allowed,
    rng: random.Random,
    steps: int = 40_000,
) -> bool:
    """Seeded local search for the last few dollars: one-, two- or three-slot moves (the three-slot move
    `a − d, b − d, c + d` reaches residual patterns no single label intersection can) that never increase the
    total absolute residual (sideways moves allowed), until it strictly decreases."""
    start = _l1(_residuals(slots, targets, amounts))
    current = start
    for _ in range(steps):
        moves = _propose(slots, targets, amounts, rng)
        if any(amounts[s.key] + d < s.minimum or not allowed(s, amounts[s.key] + d) for s, d in moves):
            continue
        for s, d in moves:
            amounts[s.key] += d
        score = _l1(_residuals(slots, targets, amounts))
        if score < current or (score == current and rng.random() < 0.5):
            current = score
            if score < start:
                return True
            continue
        for s, d in moves:
            amounts[s.key] -= d
    return False


def _propose(
    slots: list[Slot], targets: Sequence[dict[Hashable, int]], amounts: dict[str, int], rng: random.Random
) -> list[tuple[Slot, int]]:
    roll = rng.random()
    if roll < 0.35:
        res = _residuals(slots, targets, amounts)
        sizes = [abs(v) for r in res for v in r.values() if v]
        d = rng.choice(sizes) * rng.choice((-1, 1)) if sizes else 1
        a, b, c = rng.sample(slots, 3)
        return [(a, d), (b, d), (c, -d)]
    a = rng.choice(slots)
    delta = rng.choice((-3, -2, -1, 1, 2, 3))
    moves = [(a, delta)]
    if roll < 0.8:
        b = rng.choice(slots)
        if b.key != a.key:
            moves.append((b, -delta + rng.choice((-1, 0, 0, 1))))
    return moves
