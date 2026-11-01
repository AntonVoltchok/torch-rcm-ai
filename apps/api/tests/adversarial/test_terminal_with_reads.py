"""Adversarial: a terminal tool sent alongside reads (or a second terminal) violates the protocol; the loop
answers with `is_error` and a repair turn (07 §3.3). Pure checker in guardrails."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from torch_rcm.agents.guardrails import TERMINAL_TOOL_NAMES, terminal_protocol_violation
from torch_rcm.agents.tools.schemas import TERMINAL_TOOLS


def test_terminal_set_matches_schemas() -> None:
    assert TERMINAL_TOOL_NAMES == TERMINAL_TOOLS


@pytest.mark.parametrize(
    ("uses", "violation"),
    [
        ([], False),
        (["claim_get_history"], False),
        (["claim_get_history", "pms_get_visit"], False),
        (["submit_plan"], False),
        (["submit_result"], False),
        (["claim_get_history", "submit_plan"], True),
        (["submit_plan", "pms_get_visit"], True),
        (["submit_plan", "submit_result"], True),
        (["submit_draft", "submit_draft"], True),
    ],
)
def test_terminal_protocol(uses: list[str], violation: bool) -> None:
    assert terminal_protocol_violation(uses) is violation


def test_accepts_api_blocks_and_objects() -> None:
    blocks = [{"type": "tool_use", "name": "pms_get_visit"}, {"type": "tool_use", "name": "submit_plan"}]
    assert terminal_protocol_violation(blocks)
    assert not terminal_protocol_violation([SimpleNamespace(name="submit_result")])
    assert terminal_protocol_violation([SimpleNamespace(name="submit_result"), SimpleNamespace(name="x")])
