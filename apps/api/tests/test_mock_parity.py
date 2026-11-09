"""The mock API's D1 values must equal the server's on the canonical seed (plan d1-build decision 7).

This test writes nothing unless `UPDATE_PARITY=1`; it fails when `apps/web/src/mocks/fixtures/parity.json` no longer
matches what the API computes. `src/mocks/parity.test.ts` holds `db.ts` to the same file, so the two can't drift
apart silently: change a rule here, regenerate, and the vitest says where the mock disagrees.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from torch_rcm.api.services import inbox as inbox_svc
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import Claim
from torch_rcm.readmodels.claims import is_open, strip, summarize
from torch_rcm.readmodels.inbox import list_inbox
from torch_rcm.readmodels.moves import filed_since_remit
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.runtime import Runtime

FIXTURE = Path(__file__).resolve().parents[2] / "web" / "src" / "mocks" / "fixtures" / "parity.json"
GROUP = "delta_ny:denied:CO-16:N29:pa_missing"
DANA = "usr_dana"


def _moves(s: Snapshot) -> list[dict[str, Any]]:
    return [m.model_dump(mode="json") for m in strip(s, DANA).moves]


def _claims(s: Snapshot, numbers: set[int] | None = None) -> dict[str, dict[str, Any]]:
    rows = [c for c in s.of(Claim) if (is_open(c) or s.needs_action(c.id)) and (numbers is None or c.number in numbers)]
    return {
        str(c.number): summarize(s, c, DANA).move.model_dump(mode="json") for c in sorted(rows, key=lambda c: c.number)
    }


def build(rt: Runtime) -> dict[str, Any]:
    seed = Snapshot.from_store(rt.store, rt.clock.now())
    inbox = list_inbox(seed, DANA, group=True)
    morgan = {i.id: i for i in list_inbox(seed, "usr_morgan").items}
    words = ("action_label", "touches", "lands", "signer_note")
    out: dict[str, Any] = {
        "seed": {
            "moves": _moves(seed),
            "claims": _claims(seed),
            "filed_since_remit": sorted(
                c.number
                for c in seed.of(Claim)
                if is_open(c)
                and c.status.value in ("denied", "partial")
                and not c.in_flight
                and filed_since_remit(seed, c)
            ),
            "items": {i.id: i.model_dump(mode="json", include=set(words)) for i in inbox.items},
            "signer_note_morgan": {k: v.signer_note for k, v in morgan.items()},
            "groups": {
                g.group_key: g.model_dump(mode="json", include={"action_label", "touches"}) for g in inbox.groups or []
            },
        }
    }
    ctx = Ctx.for_user(rt, DANA)
    group = inbox_svc.approve_group(ctx, GROUP)
    after = Snapshot.from_store(rt.store, rt.clock.now())
    numbers = {int(i.claim.number) for i in group.items if i.claim}
    out["group_approve"] = {
        "changes": [c.model_dump(mode="json") for c in group.changes],
        "moves": _moves(after),
        "claims": _claims(after, numbers),
    }
    out["approve_4733"] = {
        "changes": [c.model_dump(mode="json") for c in inbox_svc.approve(ctx, "itm_4733", None).changes]
    }
    return out


def test_parity_fixture_is_what_the_api_computes(rt: Runtime) -> None:
    got = build(rt)
    text = json.dumps(got, indent=1, sort_keys=True) + "\n"
    if os.environ.get("UPDATE_PARITY") == "1":
        FIXTURE.write_text(text)
    assert FIXTURE.exists(), "run UPDATE_PARITY=1 uv run pytest tests/test_mock_parity.py"
    assert json.loads(FIXTURE.read_text()) == json.loads(text), (
        "the API's D1 values changed: UPDATE_PARITY=1 uv run pytest tests/test_mock_parity.py, then fix db.ts until "
        "src/mocks/parity.test.ts passes"
    )
