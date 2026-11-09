"""Helpers for tests/agents and tests/adversarial (imported, not a conftest, so basenames never collide).

- `thursday_world(tmp_path_factory, template_db)`: the canonical DB advanced to Thu 07:10 (the pinned denials
  have arrived), opened once per module. Planner reads only read; the world is shared by a module's tests.
- `reader_for(...)`: the same scope-checked ToolRegistry a live model uses, turning candidates into Evidence
  with deterministic ids and the injection detector's `suspicious` flag (the executor's job in slice A).
- `rule(...)`, `ctx(...)`, `ev(...)`: pure builders for policy tests.
"""

from __future__ import annotations

import asyncio
import shutil
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from torch_rcm.agents.case import build_case
from torch_rcm.agents.guardrails import looks_like_injection
from torch_rcm.agents.planner.base import EvidenceSet, Reader, ReadResult
from torch_rcm.agents.planner.scripted import RecordedPlanPlanner, ScriptedPlanner
from torch_rcm.agents.policy import PolicyCtx
from torch_rcm.agents.tools.adapters import SimWorld, StoreDomain
from torch_rcm.agents.tools.registry import ToolRegistry
from torch_rcm.agents.types import (
    UNKNOWN,
    AgentKind,
    BaseRate,
    CaseFile,
    Evidence,
    EvidenceCandidate,
    JsonValue,
    Plan,
    RuleScope,
    RuleView,
    Subject,
    SubjectKind,
)
from torch_rcm.config import Settings
from torch_rcm.runtime import Runtime
from torch_rcm.scheduler.registry import Registry

THURSDAY_0710 = datetime.fromisoformat("2026-10-29T07:10:00-04:00")
T0 = datetime.fromisoformat("2026-10-29T07:10:00-04:00")


@dataclass
class World:
    rt: Runtime
    sim: SimWorld
    dom: StoreDomain
    tools: ToolRegistry


def open_thursday_world(tmp: Path, template_db: Path) -> Runtime:
    db = tmp / "torch.db"
    shutil.copy(template_db, db)
    rt = Runtime.open(Settings(db_url=f"sqlite:///{db}"), reg=Registry())
    asyncio.run(rt.scheduler.run_due(THURSDAY_0710))
    return rt


@pytest.fixture(scope="module")
def world(tmp_path_factory: pytest.TempPathFactory, template_db: Path) -> Iterator[World]:
    rt = open_thursday_world(tmp_path_factory.mktemp("thu"), template_db)
    sim = SimWorld(rt.world)
    yield World(rt=rt, sim=sim, dom=StoreDomain(rt.store, sim), tools=ToolRegistry(sim))
    rt.store.close()


def to_evidence(c: EvidenceCandidate, evidence_id: str, run_id: str) -> Evidence:
    return Evidence(
        id=evidence_id,
        **c.model_dump(),
        suspicious=c.untrusted and looks_like_injection(c.excerpt),
        gathered_by="agent",
        run_id=run_id,
    )


def reader_for(
    w: World, case: CaseFile, mutate: Callable[[EvidenceCandidate], EvidenceCandidate] | None = None
) -> Reader:
    """`mutate` lets adversarial tests rewrite world content (e.g. inject text into a portal page)."""
    counter = [0]

    async def read(tool: str, args: dict[str, JsonValue]) -> ReadResult:
        out = w.tools.call(case, tool, args, run_id=case.run_id)
        evidence = []
        for raw in out.evidence:
            counter[0] += 1
            cand = mutate(raw) if mutate else raw
            evidence.append(to_evidence(cand, f"ev_{case.run_id}_{counter[0]}", case.run_id))
        return ReadResult(ok=out.ok, tool=tool, args=args, data=out.data, evidence=evidence, error=out.error)

    return read


def case_for(
    w: World, subject_id: str, agent: AgentKind, kind: SubjectKind = "claim", run_id: str = "run_t"
) -> CaseFile:
    return build_case(
        w.dom, run_id=run_id, agent=agent, subject=Subject(kind=kind, id=subject_id), now=w.rt.clock.now()
    )


def plan_case(
    w: World, case: CaseFile, mutate: Callable[[EvidenceCandidate], EvidenceCandidate] | None = None
) -> tuple[Plan, EvidenceSet]:
    evidence = EvidenceSet(case.evidence)
    planner = RecordedPlanPlanner() if case.classifier_situation == UNKNOWN else ScriptedPlanner()
    plan = asyncio.run(planner.plan(case, reader_for(w, case, mutate), evidence))
    return plan, evidence


def policy_ctx_for(case: CaseFile, evidence: EvidenceSet, **kw: Any) -> PolicyCtx:
    """The PolicyCtx the executor would build from a case (code facts only)."""
    base: dict[str, Any] = {
        "agent": case.agent,
        "run_kind": "triage",
        "classifier_situation": case.classifier_situation,
        "root_cause": case.root_cause,
        "payer_key": case.claim.payer_key if case.claim else (case.payer.key if case.payer else None),
        "item_type": case.item_type,
        "cents": case.cents,
        "scope_ids": case.subject_ids,
        "evidence": evidence.by_id(),
        "expected_values": case.expected_values,
        "paper_eob": case.paper_eob,
        "rules": case.rules_snapshot,
    }
    base.update(kw)
    return PolicyCtx(**base)


# ---------------------------------------------------------------- pure builders


def rule(action: str, tier: int, mode: str = "auto", **kw: Any) -> RuleView:
    scope = kw.pop("scope", None) or RuleScope(
        payer_key=kw.pop("payer_key", None), item_type=kw.pop("item_type", "all"), max_cents=kw.pop("max_cents", None)
    )
    base_rate = kw.pop("base_rate", BaseRate(n=25, k=23))
    return RuleView(
        id=kw.pop("id", f"rule_{action}_{mode}"),
        version=kw.pop("version", 1),
        tier=tier,  # type: ignore[arg-type]
        action=action,
        label=kw.pop("label", action),
        mode=mode,  # type: ignore[arg-type]
        scope=scope,
        base_rate=base_rate,
        situation_rates=kw.pop("situation_rates", {SITUATION: base_rate}),  # the default case's own past cases
        outcome_metric=kw.pop("outcome_metric", "paid_30d"),
        **kw,
    )


def ev(evidence_id: str, kind: str = "era_line", *, suspicious: bool = False, excerpt: str = "x") -> Evidence:
    return Evidence(
        id=evidence_id,
        kind=kind,  # type: ignore[arg-type]
        title=evidence_id,
        excerpt=excerpt,
        captured_at=T0,
        untrusted=suspicious,
        suspicious=suspicious,
    )


CLAIM = "clm_t"
PATIENT = "pat_t"
SITUATION = "denied:CO-16:N29:pa_missing"


def ctx(*rules: RuleView, **kw: Any) -> PolicyCtx:
    evidence = kw.pop("evidence", {"ev_1": ev("ev_1")})
    base: dict[str, Any] = {
        "agent": "followup",
        "run_kind": "triage",
        "classifier_situation": SITUATION,
        "root_cause": "payer",
        "payer_key": "delta_ny",
        "item_type": SITUATION,
        "cents": 124_000,
        "scope_ids": frozenset({CLAIM, PATIENT, "img_t", "cov_a", "cov_b", "rem_t", "apt_t"}),
        "evidence": evidence,
        "rules": rules,
    }
    base.update(kw)
    return PolicyCtx(**base)
