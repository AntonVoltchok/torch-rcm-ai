"""One signer per item, on every screen (red team, final D1, finding 3), and track records per situation (the
Castillo note under finding 5).

- `moves.signer` names who signs: the treating dentist for a clinical sign-off (a formal appeal), the owner for an
  owner-only act. The Inbox move, the waiting row, the signer note and the Denials row all say that person; that
  person may approve, billing may not, and the owner may as an override without it counting as hers.
- An item's k of n counts its own situation's past cases (`Rule.situation_rates`), never the rule's whole scope.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime

import pytest

from torch_rcm.agents.eval.harness import DANA, DELTA_GROUP, UNKNOWN_CLAIMS, seeded_runtime
from torch_rcm.agents.types import UNKNOWN
from torch_rcm.api.errors import ApiError
from torch_rcm.api.schemas import DenialRow
from torch_rcm.api.services.claims import triage
from torch_rcm.api.services.context import Ctx
from torch_rcm.api.services.inbox import _check_authority, approve_group
from torch_rcm.api.services.screens import denials
from torch_rcm.domain.entities import InboxItem, Rule, User
from torch_rcm.readmodels.claims import strip
from torch_rcm.readmodels.headline import situation
from torch_rcm.readmodels.inbox import item_out, list_inbox
from torch_rcm.readmodels.moves import can_act, can_approve, claim_move, signer, treating_dentist
from torch_rcm.readmodels.snapshot import Snapshot

THURSDAY_0710 = datetime.fromisoformat("2026-10-29T07:10:00-04:00")
MORGAN, LEE = "usr_morgan", "usr_lee"


@dataclass
class Moment:
    snap: Snapshot
    denials: dict[str, DenialRow]  # claim id → Dana's Denials row
    forbidden: dict[tuple[str, str], bool]  # (user, item) → the approve endpoint's authority check refuses


@pytest.fixture(scope="module")
def moments(tmp_path_factory: pytest.TempPathFactory) -> Iterator[dict[str, Moment]]:
    """The demo, deterministic: at seed, after steps 3 and 3b, after the night."""
    db = tmp_path_factory.mktemp("signer") / "signer.db"
    with seeded_runtime("deterministic", db) as (rt, _):

        def now() -> Moment:
            s = Snapshot.from_store(rt.store, rt.clock.now())
            rows = {r.claim.id: r for g in denials(Ctx.for_user(rt, DANA)).groups for r in g.rows}
            refused = {}
            for user in s.of(User):
                for item in s.open_items:
                    try:
                        _check_authority(Ctx.for_user(rt, user.id), item)
                        refused[(user.id, item.id)] = False
                    except ApiError as exc:
                        assert exc.status == 403
                        refused[(user.id, item.id)] = True
            return Moment(s, rows, refused)

        out = {"seed": now()}
        approve_group(Ctx.for_user(rt, DANA), DELTA_GROUP)
        asyncio.run(rt.scheduler.run_due(rt.clock.now()))
        for claim_id in UNKNOWN_CLAIMS:
            triage(Ctx.for_user(rt, DANA), claim_id, "followup")
        asyncio.run(rt.scheduler.run_due(rt.clock.now()))
        out["triaged"] = now()
        asyncio.run(rt.scheduler.run_due(THURSDAY_0710))
        out["overnight"] = now()
        yield out


def signed(s: Snapshot) -> list[tuple[InboxItem, User]]:
    return [(i, u) for i in s.open_items if (u := signer(s, i)) is not None]


@pytest.mark.parametrize("moment", ["seed", "triaged", "overnight"])
def test_every_screen_names_the_same_signer(moments: dict[str, Moment], moment: str) -> None:
    m = moments[moment]
    s = m.snap
    assert signed(s), "the demo always has an item someone signs"
    for item, who in signed(s):
        claim = s.claims[item.claim_id or ""]
        move = claim_move(s, claim, DANA)
        assert (move.label, move.holder_user_id) == (f"{who.name} signs", who.id), item.id
        note = item_out(s, item, DANA).signer_note
        assert note is not None and note.endswith(f"so {who.name} signs this."), (item.id, note)
        rows = [w for w in list_inbox(s, DANA).waiting if item.id in w.item_ids]
        assert [(w.label, w.signer_ids) for w in rows] == [(who.name, [who.id])], item.id
        assert [(w.label, w.signer_ids) for w in strip(s, DANA).inbox_waiting if w.label == who.name] == [
            (who.name, [who.id])
        ]
        if claim.id in m.denials:
            assert m.denials[claim.id].signer == who.name, item.id
        assert can_approve(s, who, item) and can_act(s, who, item), item.id
        assert not m.forbidden[(who.id, item.id)] and m.forbidden[(DANA, item.id)], item.id
        assert not m.forbidden[(MORGAN, item.id)], item.id  # the owner may always sign, as an override


@pytest.mark.parametrize("moment", ["seed", "triaged", "overnight"])
def test_only_the_named_signer_or_the_owner_may_approve(moments: dict[str, Moment], moment: str) -> None:
    m = moments[moment]
    for item, who in signed(m.snap):
        for user in m.snap.of(User):
            allowed = user.id in (who.id, MORGAN)
            assert m.forbidden[(user.id, item.id)] is not allowed, (item.id, user.id)


def test_the_treating_dentist_signs_appeals_and_the_owner_signs_the_rest(moments: dict[str, Moment]) -> None:
    s = moments["overnight"].snap
    by_number = {s.claims[i.claim_id or ""].number: (i, u.id) for i, u in signed(s)}
    assert {n: uid for n, (_, uid) in by_number.items()} == {3561: LEE, 4796: LEE, 4611: MORGAN}
    for number in (3561, 4796):  # Ito and Morris: formal appeals, attested by the dentist who treated them
        item, _ = by_number[number]
        assert treating_dentist(s, s.claims[item.claim_id or ""]).id == LEE  # type: ignore[union-attr]
    # Dr. Lee's appeals are in Dr. Lee's count, and wait on Dr. Lee in the owner's Inbox, not in hers.
    assert strip(s, LEE).inbox_open == 2
    assert [(w.label, w.count) for w in strip(s, MORGAN).inbox_waiting] == [("Dr. Lee", 2)]
    assert sorted((w.label, w.count) for w in strip(s, DANA).inbox_waiting) == [("Dr. Lee", 2), ("Dr. Morgan", 1)]


# ── track records ────────────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("moment", ["seed", "triaged", "overnight"])
def test_an_items_track_record_counts_its_own_situation_only(moments: dict[str, Moment], moment: str) -> None:
    s = moments[moment].snap
    rules = list(s.of(Rule))
    for item in s.open_items:
        c = item_out(s, item, DANA).confidence
        if c is None:
            continue
        named = situation(s, item)
        rule = s.rules.get(item.rule_id or "")
        if named == UNKNOWN:
            assert (c.k, c.n) == (0, 0), item.id
        elif rule is not None:
            own = rule.situation_rates.get(named or "")
            assert (c.k, c.n) == ((own.k, own.n) if own else (0, 0)), (item.id, named)
        else:  # no rule: whatever it shows is not some rule's whole-scope record
            action = item.proposed_action.action if item.proposed_action else None
            scope_wide = {(r.base_rate.k, r.base_rate.n) for r in rules if r.action is action and r.base_rate.n}
            assert (c.k, c.n) not in scope_wide, item.id
        if c.n < 5:
            assert c.pct is None and (c.n == 0 or c.basis.endswith(", too few for a rate")), (item.id, c.basis)


def test_castillo_shows_its_own_situation_not_the_records_request_rule(moments: dict[str, Moment]) -> None:
    s = moments["overnight"].snap
    castillo = next(
        i for i in s.open_items if s.claims.get(i.claim_id or "") and s.claims[i.claim_id or ""].number == 4797
    )
    out = item_out(s, castillo, DANA)
    assert out.confidence is not None
    assert (out.confidence.pct, out.confidence.k, out.confidence.n) == (86, 6, 7)
    assert out.confidence.basis == "6 of 7 paid within 30 days"
    assert "91" not in out.confidence.basis and "97" not in out.confidence.basis
    assert out.learnable.code == "root_cause_guard"  # root cause ours: fix it where it starts, never learn it


def test_situation_records_fit_inside_their_rule(moments: dict[str, Moment]) -> None:
    for rule in moments["seed"].snap.of(Rule):
        for key, rate in rule.situation_rates.items():
            assert 0 <= rate.k <= rate.n <= rule.base_rate.n and rate.k <= rule.base_rate.k, (rule.id, key)
