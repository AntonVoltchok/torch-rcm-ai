"""The mock API's D1 values must equal the server's on the canonical seed (plan d1-build decision 7).

This test writes nothing unless `UPDATE_PARITY=1`; it fails when `apps/web/src/mocks/fixtures/parity.json` no longer
matches what the API computes. `src/mocks/parity.test.ts` holds `db.ts` to the same file, so the two can't drift
apart silently: change a rule here, regenerate, and the vitest says where the mock disagrees.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from torch_rcm.agents.config import AgentConfig
from torch_rcm.agents.handlers import register
from torch_rcm.api.services import inbox as inbox_svc
from torch_rcm.api.services import screens
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import Claim, Run
from torch_rcm.readmodels.claims import is_open, strip, summarize
from torch_rcm.readmodels.inbox import list_inbox
from torch_rcm.readmodels.moves import filed_since_remit
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.runtime import Runtime
from torch_rcm.scheduler.registry import Registry

FIXTURE = Path(__file__).resolve().parents[2] / "web" / "src" / "mocks" / "fixtures" / "parity.json"
GROUP = "delta_ny:denied:CO-16:N29:pa_missing"
DANA = "usr_dana"
# Every canonical approval after the group and #4733, with who approves it; each on its own claim.
LATER_APPROVALS = [
    ("itm_4705", DANA),
    ("itm_4851", DANA),
    ("itm_4772", DANA),
    ("itm_4748", DANA),
    ("itm_4611", "usr_morgan"),
]


def _moves(s: Snapshot) -> list[dict[str, Any]]:
    return [m.model_dump(mode="json") for m in strip(s, DANA).moves]


def _claims(s: Snapshot, numbers: set[int] | None = None) -> dict[str, dict[str, Any]]:
    rows = [c for c in s.of(Claim) if (is_open(c) or s.needs_action(c.id)) and (numbers is None or c.number in numbers)]
    return {
        str(c.number): summarize(s, c, DANA).move.model_dump(mode="json") for c in sorted(rows, key=lambda c: c.number)
    }


def build(rt: Runtime, registry: Registry) -> dict[str, Any]:
    seed = Snapshot.from_store(rt.store, rt.clock.now())
    ctx = Ctx.for_user(rt, DANA)
    inbox = list_inbox(seed, DANA, group=True)
    morgan = {i.id: i for i in list_inbox(seed, "usr_morgan").items}
    words = ("action_label", "touches", "lands", "signer_note", "headline", "learnable", "confidence")
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
                g.group_key: g.model_dump(mode="json", include={"action_label", "touches", "headline"})
                for g in inbox.groups or []
            },
            "denials_matrix": screens.denials(ctx).matrix.model_dump(mode="json"),
        }
    }
    group = inbox_svc.approve_group(ctx, GROUP)
    after = Snapshot.from_store(rt.store, rt.clock.now())
    numbers = {int(i.claim.number) for i in group.items if i.claim}
    out["group_approve"] = {
        "changes": [c.model_dump(mode="json") for c in group.changes],
        "moves": _moves(after),
        "claims": _claims(after, numbers),
    }
    first = inbox_svc.approve(ctx, "itm_4733", None)
    out["approve_4733"] = {"changes": [c.model_dump(mode="json") for c in first.changes]}
    # Now let every approval run to its end: where each run left its claim, and the claim's move after all of them.
    register(registry, AgentConfig(step_delay=False, world_retry_backoff_s=(0.0, 0.0, 0.0)))
    runs = {i.id: i.run_id for i in group.items} | {"itm_4733": first.item.run_id}
    for item_id, user in LATER_APPROVALS:
        runs[item_id] = inbox_svc.approve(Ctx.for_user(rt, user), item_id, None).item.run_id
    asyncio.run(rt.scheduler.run_due(rt.clock.now()))
    done = Snapshot.from_store(rt.store, rt.clock.now())
    out["approve_runs"] = {}
    for item_id, run_id in sorted(runs.items()):
        run = rt.store.require(Run, run_id or "")
        claim = done.claims[run.claim_id or ""]
        out["approve_runs"][item_id] = {
            "status": run.status.value,
            "move_to": run.claim_outcome.move_to.value if run.claim_outcome else None,
            "claim_move": summarize(done, claim, DANA).move.model_dump(mode="json"),
        }
    return out


def test_parity_fixture_is_what_the_api_computes(rt: Runtime, world_only_registry: Registry) -> None:
    got = build(rt, world_only_registry)
    text = json.dumps(got, indent=1, sort_keys=True) + "\n"
    if os.environ.get("UPDATE_PARITY") == "1":
        FIXTURE.write_text(text)
    assert FIXTURE.exists(), "run UPDATE_PARITY=1 uv run pytest tests/test_mock_parity.py"
    assert json.loads(FIXTURE.read_text()) == json.loads(text), (
        "the API's D1 values changed: UPDATE_PARITY=1 uv run pytest tests/test_mock_parity.py, then fix db.ts until "
        "src/mocks/parity.test.ts passes"
    )
