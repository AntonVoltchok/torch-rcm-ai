"""Cassettes: record/replay roundtrip, strict keys, and the canonical (synthetic) cassettes (07 §4.3)."""

from __future__ import annotations

import asyncio
import json
from datetime import date, datetime
from pathlib import Path

import pytest

from torch_rcm.agents.case import build_case
from torch_rcm.agents.config import AgentConfig
from torch_rcm.agents.llm.cassette import (
    CANONICAL,
    CANONICAL_DIR,
    Cassette,
    CassetteClient,
    CassetteMiss,
    RecordingClient,
    cassette_key,
    restamp_synthetic,
)
from torch_rcm.agents.llm.client import CallMeta, LlmClient, build_request
from torch_rcm.agents.planner.base import EvidenceSet, PlannerFallback
from torch_rcm.agents.planner.live import LivePlanner, registry_reader
from torch_rcm.agents.planner.scripted import RecordedPlanPlanner
from torch_rcm.agents.testing.fakes import READ_IMAGES, FakeTransport, response, submit, thinking
from torch_rcm.agents.testing.fakes import FakeReader as Reader
from torch_rcm.agents.testing.fakes import fake_case as make_case
from torch_rcm.agents.tools.adapters import SimWorld, StoreDomain
from torch_rcm.agents.tools.registry import ToolRegistry
from torch_rcm.agents.types import ClaimLineView, ClaimView, DenialView, Evidence, Plan, ProposedAction, Subject
from torch_rcm.runtime import Runtime

NOW = datetime.fromisoformat("2026-10-28T10:40:00-04:00")
CANON = CANONICAL_DIR / "canonical"


def _record(tmp_path: Path) -> tuple[Path, Plan, list]:
    transport = FakeTransport([response(thinking("t", "sig-1"), READ_IMAGES), response(submit())])
    rows: list = []
    live = LlmClient(AgentConfig(), transport=transport, sink=rows.append, clock=lambda: NOW)
    path = tmp_path / "rec.jsonl"
    recorder = RecordingClient(live, path, recorded_at=NOW.isoformat())
    case = make_case()
    plan = asyncio.run(LivePlanner(client=recorder).plan(case, Reader(), EvidenceSet(case.evidence)))
    return path, plan, rows


def test_record_then_replay_roundtrip(tmp_path: Path) -> None:
    path, recorded_plan, live_rows = _record(tmp_path)
    cas = Cassette.load(path)
    assert cas.header["synthetic"] is False and cas.hash_mode == "full"
    assert cas.key["agent"] == "followup" and cas.key["situation_key"] == "denied:CO-16:N29:pa_missing"
    assert [c["seq"] for c in cas.calls] == [0, 1]

    replay_rows: list = []
    client = CassetteClient(path.parent, sink=replay_rows.append, clock=lambda: NOW)
    case = make_case()
    planner = LivePlanner(client=client)
    replayed = asyncio.run(planner.plan(case, Reader(), EvidenceSet(case.evidence)))
    assert replayed == recorded_plan
    assert [r.cost_usd_micros for r in replay_rows] == [r.cost_usd_micros for r in live_rows]
    assert planner.usage.model_calls == 2


def test_key_mismatch_is_a_miss(tmp_path: Path) -> None:
    path, _, _ = _record(tmp_path)
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    rows[0]["key"]["system_sha"] = "0" * 64  # as if the prompt had been edited since recording
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    client = CassetteClient(path.parent)
    meta = CallMeta(
        run_id="r",
        agent="followup",
        purpose="plan",
        situation_key="denied:CO-16:N29:pa_missing",
        subject_id="clm_9001",
        seq=0,
    )
    body = build_request("followup", [{"role": "user", "content": "x"}], model_role="exec")
    with pytest.raises(CassetteMiss, match="prompt edited"):
        asyncio.run(client.messages_create(meta, **body))
    with pytest.raises(CassetteMiss, match="no cassette"):
        asyncio.run(
            client.messages_create(CallMeta(**{**meta.__dict__, "situation_key": "pending:status_due"}), **body)
        )
    # through the planner, a miss is a labelled fallback
    case = make_case()
    with pytest.raises(PlannerFallback, match="cassette_miss"):
        asyncio.run(LivePlanner(client=client).plan(case, Reader(), EvidenceSet(case.evidence)))


def test_request_drift_is_a_miss(tmp_path: Path) -> None:
    path, _, _ = _record(tmp_path)
    case = make_case().model_copy(update={"now": datetime.fromisoformat("2026-10-29T07:10:00-04:00")})
    with pytest.raises(PlannerFallback, match="differs from the recording"):
        asyncio.run(LivePlanner(client=CassetteClient(path.parent)).plan(case, Reader(), EvidenceSet(case.evidence)))


def test_canonical_cassettes_are_synthetic_and_keyed_to_current_prompts() -> None:
    names = sorted(p.stem for p in CANON.glob("*.jsonl"))
    assert names == sorted(c.name for c in CANONICAL)
    for spec in CANONICAL:
        cas = Cassette.load(CANON / f"{spec.name}.jsonl")
        assert cas.synthetic and cas.hash_mode == "structure" and cas.header["recorded_at"]
        role = "draft" if spec.purpose == "draft" else "exec"
        meta = CallMeta(
            run_id="r",
            agent=spec.agent,
            purpose=spec.purpose,
            situation_key=cas.key["situation_key"],
            subject_id=spec.subject_ids[0],
            seq=0,
            role=role,
        )
        want = cassette_key(meta, build_request(spec.agent, [], model_role=role))
        assert cas.key == want, f"{spec.name} is stale: restamp_synthetic() after a deliberate prompt edit"
        assert {c["subject_id"] for c in cas.calls} == set(spec.subject_ids)


def test_restamp_refuses_recordings(tmp_path: Path) -> None:
    path, _, _ = _record(tmp_path)
    with pytest.raises(ValueError, match="re-record"):
        restamp_synthetic(path, Cassette.load(path).key)


def test_canonical_followup_cassettes_replay_against_the_seeded_world(rt: Runtime) -> None:
    sim = SimWorld(rt.world)
    dom = StoreDomain(rt.store, sim)
    registry = ToolRegistry(sim)
    client = CassetteClient(CANON)
    now = rt.clock.now()
    images = {
        "clm_4821": "img_owens_k_1012_pa_19",
        "clm_4836": "img_grant_l_1014_pa_3",
        "clm_4840": "img_diaz_f_1019_pa_14",
    }
    for claim_id in ("clm_4821", "clm_4836", "clm_4840", "clm_4744", "clm_4709", "clm_4731"):
        run_id = f"run_test_{claim_id}"
        case = build_case(dom, run_id=run_id, agent="followup", subject=Subject(kind="claim", id=claim_id), now=now)
        evidence = EvidenceSet(case.evidence)
        plan = asyncio.run(
            LivePlanner(client=client).plan(case, registry_reader(registry, case, run_id=run_id), evidence)
        )
        assert plan.planner == "live" and plan.actions and not plan.injection_suspected
        cited = {e.kind for a in plan.actions for e in evidence.items if e.id in a.evidence_ids}
        if claim_id in images:
            assert plan.situation_key == case.classifier_situation == "denied:CO-16:N29:pa_missing"
            (a,) = plan.actions
            assert a.action == "resubmit_with_attachment" and a.params["image_id"] == images[claim_id]
            assert {"era_line", "pms_record", "portal_screenshot"} <= cited
            continue
        # the three seeded unknowns: within the reviewed plan (planner/recorded/<claim>.plan.json)
        rec = RecordedPlanPlanner.load(claim_id)
        assert plan.situation_key == "unknown" and plan.situation_description == rec["situation_description"]
        assert [(a.action, a.params) for a in plan.actions] == [(r["action"], r["params"]) for r in rec["actions"]]
        assert [(r.tool, r.args) for r in plan.reads] == [(r["tool"], r["args"]) for r in rec["reads"]]
        assert cited and all(
            e.gathered_by == "agent" for a in plan.actions for e in evidence.items if e.id in a.evidence_ids
        )


def test_canonical_appeal_draft_replays_and_passes_the_text_guard() -> None:
    denial = DenialView(
        group="CO",
        carc="50",
        rarc="N10",
        line_id="cl_4796_1",
        remittance_id="rem_guardian_1029",
        decoded="Not deemed medically necessary after consultant review",
        denied_on=date(2026, 10, 29),
    )
    claim = ClaimView(
        id="clm_4796",
        number=4796,
        patient_id="pat_ito_l",
        visit_id="vis_1009_ito",
        coverage_id="cov_ito_l_1",
        payer_key="guardian",
        status="denied",
        dos=date(2026, 10, 9),
        billed_cents=48_000,
        denial=denial,
        lines=(
            ClaimLineView(id="cl_4796_1", cdt="D4341", surface="UR", fee_cents=24_000),
            ClaimLineView(id="cl_4796_2", cdt="D4341", surface="UL", fee_cents=24_000),
        ),
    )
    at = datetime.fromisoformat("2026-10-30T07:10:00-04:00")
    ev = (
        Evidence(
            id="ev_a1",
            kind="era_line",
            title="Guardian 835 · 10/29",
            excerpt="CO-50 N10 both D4341 lines",
            captured_at=at,
        ),
        Evidence(
            id="ev_a2",
            kind="note_excerpt",
            title="Clinical note 10/09",
            excerpt="Pockets UR/UL, BOP.",
            captured_at=at,
            untrusted=True,
        ),
    )
    case = make_case("appeals", "denied:CO-50:N10:formal_appeal").model_copy(
        update={
            "claim": claim,
            "denial": denial,
            "evidence": ev,
            "subject": Subject(kind="claim", id="clm_4796"),
            "now": at,
        }
    )
    plan = Plan(
        situation_key=case.classifier_situation,
        reviewer_summary="Formal appeal with the chart.",
        planner="scripted",
        actions=(
            ProposedAction(
                action="formal_appeal", params={"claim_id": "clm_4796", "level": 1}, evidence_ids=("ev_a1", "ev_a2")
            ),
        ),
    )
    planner = LivePlanner(client=CassetteClient(CANON))
    draft = asyncio.run(planner.draft(case, plan, "appeal_letter", EvidenceSet(ev)))
    assert draft is not None and draft.source == "agent" and draft.kind == "appeal_letter"
    assert any(s.fact_type == "clinical" and s.evidence_ids for s in draft.segments)
    assert draft.human_must_complete and planner.pin and planner.pin.model == "claude-opus-5-5"
