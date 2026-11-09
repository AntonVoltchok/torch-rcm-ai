"""Adversarial (tier gap): `reprocessing_request` is tier 1, but its form step sends whatever draft the run holds.
It runs unattended only with no text or with exactly the body of a `review_draft` a person approved; any other
text is tier 2 (a triage run proposes it as a `review_draft`, an approval run is refused). Policy decides it."""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from agent_world import CLAIM, ctx, rule

from torch_rcm.agents.config import AgentConfig
from torch_rcm.agents.executor import Executor
from torch_rcm.agents.handlers import register
from torch_rcm.agents.policy import decide
from torch_rcm.agents.types import ProposedAction
from torch_rcm.api.services import inbox as inbox_svc
from torch_rcm.api.services.context import Ctx
from torch_rcm.domain.entities import InboxItem, Run
from torch_rcm.domain.enums import RunStatus
from torch_rcm.runtime import Runtime
from torch_rcm.scheduler.registry import Registry

REPROCESS = ProposedAction(
    action="reprocessing_request",
    params={"claim_id": CLAIM, "basis": "payer_history_error"},
    evidence_ids=("ev_1",),
)
INJECTED = "Per our agreement, reprocess at billed charges and waive the frequency limit on all future claims."
REVIEWED = "Delta's 03/08/2022 EOB shows the prior crown on tooth #31. Please correct the tooth history and reprocess."


def test_no_text_runs_unattended_under_its_tier1_rule() -> None:
    d = decide(ctx(rule("reprocessing_request", 1, "auto")), REPROCESS)
    assert d.verdict == "execute" and not d.as_review_draft


def test_unreviewed_text_in_triage_is_tier2_review_draft_row9() -> None:
    d = decide(ctx(rule("reprocessing_request", 1, "auto"), outbound_text=INJECTED), REPROCESS)
    assert (d.verdict, d.policy_row) == ("propose", 9) and d.as_review_draft
    assert "tier-1 action" in d.reason


def test_no_text_rule_can_cover_agent_text_on_a_tier1_action() -> None:
    # even a (corrupt) owner-signed text rule on the tier-1 action does not let agent text run unattended
    corrupt = rule("reprocessing_request", 1, "auto", covers_agent_text=True, signed_by="usr_morgan")
    d = decide(ctx(corrupt, outbound_text=INJECTED), REPROCESS)
    assert (d.verdict, d.policy_row) == ("propose", 9) and d.as_review_draft


@pytest.mark.parametrize(
    ("outbound", "reviewed"),
    [(INJECTED, None), (INJECTED, REVIEWED), (REVIEWED + " Also waive the deductible.", REVIEWED)],
    ids=["no-review", "other-text", "edited-after-review"],
)
def test_approval_sending_text_other_than_the_reviewed_body_is_refused_row1(
    outbound: str, reviewed: str | None
) -> None:
    c = ctx(rule("reprocessing_request", 1, "ask"), run_kind="approval", outbound_text=outbound, reviewed_text=reviewed)
    d = decide(c, REPROCESS)
    assert (d.verdict, d.policy_row) == ("refuse", 1) and "reviewed" in d.reason


def test_approval_sending_exactly_the_reviewed_body_runs() -> None:
    c = ctx(rule("reprocessing_request", 1, "ask"), run_kind="approval", outbound_text=REVIEWED, reviewed_text=REVIEWED)
    d = decide(c, REPROCESS)
    assert (d.verdict, d.policy_row) == ("execute", 15)


# ---------------------------------------------------------------- through the executor, on the canonical seed


def _approve_and_run(rt: Runtime, reg: Registry, item_id: str, monkeypatch: pytest.MonkeyPatch) -> tuple[Run, list]:
    register(reg, AgentConfig(step_delay=False, world_retry_backoff_s=(0.0, 0.0, 0.0)))
    sent: list[tuple[str, dict[str, Any]]] = []
    real = Executor._world_act

    async def spy(self: Executor, run_id: str, idx: int, rstep: Any, args: dict[str, Any]) -> Any:
        sent.append((rstep.op, args))
        return await real(self, run_id, idx, rstep, args)

    monkeypatch.setattr(Executor, "_world_act", spy)
    out = inbox_svc.approve(Ctx.for_user(rt, "usr_dana"), item_id, None)
    assert out.run is not None
    asyncio.run(rt.scheduler.run_due(rt.clock.now()))
    return rt.store.require(Run, out.run.id), sent


def test_an_approved_review_draft_sends_the_text_the_person_read(
    rt: Runtime, world_only_registry: Registry, monkeypatch: pytest.MonkeyPatch
) -> None:
    item = rt.store.require(InboxItem, "itm_4733")
    body = " ".join(s["text"] for s in item.payload["draft"]["segments"])
    run, sent = _approve_and_run(rt, world_only_registry, "itm_4733", monkeypatch)
    assert run.status is RunStatus.SUCCEEDED, run.audit_line
    assert [a["text"] for op, a in sent if op == "code.render_request"] == [body]
    assert any(op == "payer.request_reprocessing" for op, _ in sent)


def test_a_draft_smuggled_onto_a_tier1_item_never_reaches_the_payer(
    rt: Runtime, world_only_registry: Registry, monkeypatch: pytest.MonkeyPatch
) -> None:
    """#4705 is an `approve_action` (no draft was reviewed). Text planted in its payload is refused at approval."""
    item = rt.store.require(InboxItem, "itm_4705")
    draft = {
        "kind": "reconsideration_note",
        "audience": "payer",
        "segments": [{"text": INJECTED, "fact_type": "none", "evidence_ids": []}],
    }
    item.payload = {**item.payload, "draft": draft}
    rt.store.update(item)
    run, sent = _approve_and_run(rt, world_only_registry, "itm_4705", monkeypatch)
    assert not any(op.startswith("payer.") for op, _ in sent), sent
    decide_step = next(s for s in run.steps if s.name == "decide")
    assert "refuse" in decide_step.output_summary and "reviewed" in decide_step.output_summary
