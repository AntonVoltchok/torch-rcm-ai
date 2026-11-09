"""The Inbox says only what is true for the viewer (red team, final D1, findings 4 and 5).

- "N items need you" counts what the viewer can act on; the rest of their queue waits on someone named, who has it
  in their own count. The badge, the header, the "Yours" tab and Activity's "awaiting you" are the same number.
- A situation the classifier couldn't name has no track record: no percent, no k of n, and it can't be learned.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from datetime import datetime

import pytest

from torch_rcm.agents.eval.harness import DANA, DELTA_GROUP, UNKNOWN_CLAIMS, seeded_runtime
from torch_rcm.agents.policy import UNNAMED_BASIS
from torch_rcm.agents.types import UNKNOWN
from torch_rcm.api.services.claims import triage
from torch_rcm.api.services.context import Ctx
from torch_rcm.api.services.inbox import approve_group
from torch_rcm.domain.entities import User
from torch_rcm.readmodels.activity import activity
from torch_rcm.readmodels.claims import strip, visible_inbox
from torch_rcm.readmodels.headline import situation
from torch_rcm.readmodels.inbox import item_out, list_inbox
from torch_rcm.readmodels.snapshot import Snapshot

THURSDAY_0710 = datetime.fromisoformat("2026-10-29T07:10:00-04:00")


@pytest.fixture(scope="module")
def moments(tmp_path_factory: pytest.TempPathFactory) -> Iterator[dict[str, Snapshot]]:
    """The demo's Inbox, deterministic: at seed, after steps 3 and 3b (the group approve, the unknowns' triage), after the night."""
    db = tmp_path_factory.mktemp("truth") / "truth.db"
    with seeded_runtime("deterministic", db) as (rt, _):

        def now() -> Snapshot:
            return Snapshot.from_store(rt.store, rt.clock.now())

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


def users(s: Snapshot) -> list[str]:
    return [u.id for u in s.of(User)]


@pytest.mark.parametrize("moment", ["seed", "triaged", "overnight"])
def test_need_you_plus_waiting_is_the_queue_for_every_user(moments: dict[str, Snapshot], moment: str) -> None:
    s = moments[moment]
    for uid in users(s):
        st, queue, inbox = strip(s, uid), visible_inbox(s, uid), list_inbox(s, uid, group=True)
        waiting = sum(w.count for w in st.inbox_waiting)
        assert st.inbox_open + waiting == len(queue) == inbox.total, uid
        assert inbox.actionable == st.inbox_open == activity(s, viewer_id=uid).summary.awaiting_you, uid
        assert inbox.actionable + sum(w.count for w in inbox.waiting) == inbox.total, uid
        assert [(w.label, w.count, w.cents) for w in inbox.waiting] == [
            (w.label, w.count, w.cents) for w in st.inbox_waiting
        ], uid
        assert st.inbox_open_cents + sum(w.cents for w in st.inbox_waiting) == sum(i.cents for i in queue), uid


@pytest.mark.parametrize("moment", ["seed", "triaged", "overnight"])
def test_waiting_names_people_who_have_it_in_their_own_count(moments: dict[str, Snapshot], moment: str) -> None:
    """ "1 waiting on Dr. Morgan" is true from Dr. Morgan's side; and the row the web draws under it says why."""
    s = moments[moment]
    items = {i.id: i for i in s.open_items}
    for uid in users(s):
        for row in list_inbox(s, uid).waiting:
            assert row.signer_ids, (uid, row.label)
            for signer in row.signer_ids:
                theirs = list_inbox(s, signer)
                yours = {i.id for i in theirs.items} - {i for w in theirs.waiting for i in w.item_ids}
                assert set(row.item_ids) <= yours, (uid, signer)
            for item_id in row.item_ids:
                out = item_out(s, items[item_id], uid)
                # rt-signer: the owner sees Dr. Lee's appeals waiting on Dr. Lee and may sign in his place (no note)
                assert out.signer_note or out.signer_user_id in row.signer_ids, (uid, item_id)


def test_dana_waits_on_dr_morgan(moments: dict[str, Snapshot]) -> None:
    seed, night = strip(moments["seed"], DANA), strip(moments["overnight"], DANA)
    assert (seed.inbox_open, [(w.label, w.count) for w in seed.inbox_waiting]) == (11, [("Dr. Morgan", 1)])
    # rt-signer: Dr. Lee treated Ito and Morris, so their appeals wait on him; Diaz still waits on Dr. Morgan
    assert [(w.label, w.count) for w in night.inbox_waiting] == [("Dr. Morgan", 1), ("Dr. Lee", 2)]


@pytest.mark.parametrize("moment", ["seed", "triaged", "overnight"])
def test_an_unnamed_situation_never_carries_a_track_record(moments: dict[str, Snapshot], moment: str) -> None:
    s = moments[moment]
    unnamed = [i for i in s.open_items if situation(s, i) == UNKNOWN]
    if moment != "seed":
        assert {i.claim_id for i in unnamed} >= set(UNKNOWN_CLAIMS)
    for item in unnamed:
        out = item_out(s, item, DANA)
        c = out.confidence
        assert c is None or (c.pct, c.k, c.n, c.basis) == (None, 0, 0, UNNAMED_BASIS), item.id
        assert not out.learnable.ok, item.id
