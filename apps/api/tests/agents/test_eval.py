"""`make eval` (07 §7): the canonical scenario through deterministic and live-cassette modes."""

from __future__ import annotations

from pathlib import Path

import pytest

from torch.agents.eval import evaluate, render, run_eval
from torch.agents.eval.harness import UNKNOWN_CLAIMS, compare, run_scenario
from torch.agents.llm.cassette import CANONICAL_DIR, Cassette


def _cassettes_load() -> bool:
    try:
        return all(Cassette.load(p) for p in (CANONICAL_DIR / "canonical").glob("*.jsonl"))
    except Exception:  # noqa: BLE001 - a broken cassette skips live replay; test_cassette.py reports why
        return False


@pytest.fixture(scope="module")
def det(tmp_path_factory: pytest.TempPathFactory):  # type: ignore[no-untyped-def]
    return run_scenario("deterministic", tmp_path_factory.mktemp("eval_det"))


def test_deterministic_scenario_passes_every_check(det) -> None:  # type: ignore[no-untyped-def]
    assert det.failures == []
    assert det.inbox_open == 19 and det.strip["denied"] == 9
    assert det.inbox_kinds == {"approve_action": 12, "eligibility_flag": 3, "review_draft": 3, "variance": 1}
    shapes = det.shapes
    assert {k.split()[1] for k in shapes if k.endswith(" approval")} == {"clm_4821", "clm_4836", "clm_4840"}
    assert shapes["appeals clm_4796 rule"].item_kind == "review_draft"  # Ito CO-50 → Appeals, not Follow-up
    assert shapes["followup clm_4800 rule"].action == "cob_order_change"  # Moreno: the seeded COB branch
    assert shapes["followup clm_4797 rule"].item_kind == "approve_action"  # Castillo: root cause ours → Dana
    for claim_id in UNKNOWN_CLAIMS:
        s = shapes[f"followup {claim_id} manual"]
        assert s.planner == "recorded_plan" and s.item_kind == "approve_action"


@pytest.mark.skipif(not _cassettes_load(), reason="canonical cassettes do not load")
def test_live_replay_has_identical_run_shapes(det, tmp_path: Path) -> None:  # type: ignore[no-untyped-def]
    live = run_scenario("live", tmp_path)
    assert live.failures == []
    assert compare(det, live) == []
    assert {live.shapes[f"followup {c} manual"].planner for c in UNKNOWN_CLAIMS} == {"live"}


def test_compare_reports_a_shape_mismatch(det) -> None:  # type: ignore[no-untyped-def]
    from dataclasses import replace

    from torch.agents.eval.harness import ModeResult

    key = "followup clm_4821 approval"
    other = ModeResult(mode="live", shapes={**det.shapes, key: replace(det.shapes[key], steps=("gather_case",))})
    other.inbox_open, other.strip = det.inbox_open, det.strip
    (msg,) = compare(det, other)
    assert msg.startswith(key) and "steps" in msg


def test_run_eval_exit_code_and_table(tmp_path: Path) -> None:
    lines: list[str] = []
    assert run_eval(("deterministic",), echo=lines.append) == 0
    assert "eval: OK" in lines[0] and "followup clm_4744 manual" in lines[0]
    report = evaluate(("deterministic",), workdir=tmp_path)
    assert report.ok and "inbox 19" in render(report)
