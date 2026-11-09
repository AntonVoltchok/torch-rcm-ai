"""D1's server values (plan d1-build, Phase 1 (api) notes): whose move, "What changed", and the viewer's `mine`."""

from __future__ import annotations

from torch_rcm.api.services import inbox as inbox_svc
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import Claim
from torch_rcm.domain.enums import MoveWho
from torch_rcm.readmodels.claims import strip, summarize
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.runtime import Runtime

GROUP = "delta_ny:denied:CO-16:N29:pa_missing"


def ctx(rt: Runtime, user: str = "usr_dana") -> Ctx:
    return Ctx.for_user(rt, user)


def claim(s: Snapshot, number: int) -> Claim:
    return next(c for c in s.of(Claim) if c.number == number)


def test_group_approve_changes_match_the_strip_and_denied_stays(rt: Runtime) -> None:
    out = inbox_svc.approve_group(ctx(rt), GROUP)
    rows = {c.key: c for c in out.changes}
    assert (rows["inbox"].before, rows["inbox"].after) == (12, 9)
    denied = rows["tile.denied"]
    assert (denied.before, denied.after) == (5, 5)
    assert denied.note == "Stays denied until Delta processes the resubmission"
    after = strip(Snapshot.from_store(rt.store, rt.clock.now()), "usr_dana")
    assert rows["inbox"].after == after.inbox_open == out.meta.counts.inbox_open
    assert rows["inbox_claims"].after == after.inbox_claims
    assert denied.after == next(t.count for t in after.tiles if t.status.value == "denied")
    assert not any(c.key.startswith("move.") for c in out.changes)


def test_a_replayed_approve_reports_no_change(rt: Runtime) -> None:
    inbox_svc.approve(ctx(rt), "itm_4705", None)
    again = inbox_svc.approve(ctx(rt), "itm_4705", None)
    assert all(c.before == c.after for c in again.changes)


def test_whose_move_on_the_seed(canonical: Snapshot) -> None:
    write_off = summarize(canonical, claim(canonical, 4611), "usr_dana").move
    assert (write_off.who, write_off.label, write_off.mine) == (MoveWho.PRACTICE, "Dr. Morgan signs", False)
    assert summarize(canonical, claim(canonical, 4611), "usr_morgan").move.mine
    assert summarize(canonical, claim(canonical, 4733), "usr_dana").move.mine
    assert summarize(canonical, claim(canonical, 4859), "usr_dana").move.who is MoveWho.AGENTS  # in the 10:45 file
    unworked = [c for c in canonical.of(Claim) if c.status.value == "partial" and not canonical.needs_action(c.id)]
    assert {summarize(canonical, c).move.label for c in unworked} == {"Underpaid, nothing filed"}


def test_the_denied_tally_splits_by_holder(canonical: Snapshot) -> None:
    denied = next(t for t in strip(canonical, "usr_dana").tiles if t.status.value == "denied")
    assert [(h.holder_role, h.mine, h.count) for h in denied.by_holder] == [("billing", True, 4), ("owner", False, 1)]
