"""Strict model-facing schemas (07 §3.5): lint clean, no PHI/ids in enum/const, ≤ 20 tools, submit_plan has no
confidence/tier/root-cause/amount fields, and every variant round-trips through its pydantic model."""

from __future__ import annotations

from typing import Any

import pytest

from torch_rcm.agents.catalog.actions import ACTIONS, TIER3_ACTIONS
from torch_rcm.agents.tools.registry import READS
from torch_rcm.agents.tools.schemas import (
    ACTION_VARIANTS,
    MAX_STRICT_TOOLS,
    MODEL_ACTIONS,
    READ_TOOLS,
    SUBMIT_DRAFT,
    SUBMIT_RESULT,
    _walk,
    draft_tools,
    lint_tools,
    plan_tools,
    submit_plan_tool,
)
from torch_rcm.agents.types import AGENT_KINDS

FORBIDDEN_FIELD_WORDS = ("confidence", "tier", "root_cause", "amount", "cents", "verdict", "policy", "rule")


@pytest.fixture(scope="module")
def seeded_values(canonical_world) -> frozenset[str]:  # type: ignore[no-untyped-def]
    values: set[str] = set()
    for rows in canonical_world.entities.values():
        for e in rows:
            values.add(e.id)
            for attr in ("first", "last", "name", "subscriber_id", "icn", "group_no"):
                v = getattr(e, attr, None)
                if isinstance(v, str) and v:
                    values.add(v)
    return frozenset(values)


def all_tool_sets() -> list[tuple[str, list[dict[str, Any]]]]:
    return [(f"plan:{a}", plan_tools(a)) for a in AGENT_KINDS] + [("draft", draft_tools())]


@pytest.mark.parametrize(("name", "tools"), all_tool_sets(), ids=[n for n, _ in all_tool_sets()])
def test_lint_clean_and_no_ids_in_enums(name: str, tools: list[dict[str, Any]], seeded_values: frozenset[str]) -> None:
    assert len(seeded_values) > 500
    assert lint_tools(tools, seeded_values) == []
    assert len(tools) <= MAX_STRICT_TOOLS


def test_lint_catches_a_leaked_id() -> None:
    bad = {"name": "x", "strict": True, "input_schema": {
        "type": "object", "additionalProperties": False, "required": ["c"],
        "properties": {"c": {"type": "string", "enum": ["clm_4821"]}}}}  # fmt: skip
    assert any("ids or names" in p for p in lint_tools([bad], frozenset({"clm_4821"})))


def property_names(schema: dict[str, Any]) -> set[str]:
    names: set[str] = set()

    def visit(node: Any, path: str) -> None:
        if isinstance(node, dict) and isinstance(node.get("properties"), dict):
            names.update(node["properties"])

    _walk(schema, "", visit)
    return names


@pytest.mark.parametrize("agent", AGENT_KINDS)
def test_submit_plan_has_no_code_owned_fields(agent: str) -> None:
    tool = submit_plan_tool(agent)  # type: ignore[arg-type]
    names = property_names(tool["input_schema"])
    leaked = {n for n in names if any(w in n for w in FORBIDDEN_FIELD_WORDS)}
    assert leaked == set(), leaked
    assert tool["input_schema"]["additionalProperties"] is False
    for t in (SUBMIT_RESULT, SUBMIT_DRAFT):
        assert not {n for n in property_names(t["input_schema"]) if any(w in n for w in FORBIDDEN_FIELD_WORDS)}


def test_no_tier3_or_mutating_tool_is_model_facing() -> None:
    for agent in AGENT_KINDS:
        assert not set(MODEL_ACTIONS[agent]) & TIER3_ACTIONS
        names = {t["name"] for t in plan_tools(agent)}
        assert names <= set(READ_TOOLS) | {"submit_plan", "submit_result"}
    assert not set(ACTION_VARIANTS) & TIER3_ACTIONS


def example(schema: dict[str, Any]) -> Any:
    """A deterministic instance of a (strict) JSON schema."""
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    t = schema.get("type")
    if isinstance(t, list):
        t = next(x for x in t if x != "null")
    if t == "object":
        return {k: example(v) for k, v in schema["properties"].items()}
    if t == "array":
        return [example(schema["items"])]
    if t == "boolean":
        return False
    if schema.get("format") == "date":
        return "2026-10-12"
    return "x_1"


@pytest.mark.parametrize("action", sorted(ACTION_VARIANTS))
def test_action_variant_round_trips_through_params_model(action: str) -> None:
    raw = example(ACTION_VARIANTS[action])
    assert raw["action"] == action and set(raw) >= {"evidence_ids", "rationale"}
    params = {k: v for k, v in raw.items() if k not in ("action", "evidence_ids", "rationale")}
    model = ACTIONS[action].params.model_validate(params)
    dumped = model.model_dump(mode="json")
    assert {k: dumped[k] for k in params} == params
    assert ACTIONS[action].params.model_validate(dumped) == model
    # every model field the schema leaves out has a default (code fills it, never the model)
    missing = set(ACTIONS[action].params.model_fields) - set(params)
    assert all(not ACTIONS[action].params.model_fields[f].is_required() for f in missing), missing


@pytest.mark.parametrize("tool", sorted(READ_TOOLS))
def test_read_tool_round_trips_through_args_model(tool: str) -> None:
    raw = example(READ_TOOLS[tool]["input_schema"])
    args = READS[tool].args_model.model_validate(raw)
    assert args.model_dump(mode="json") == raw
    assert set(READ_TOOLS[tool]["input_schema"]["properties"]) == set(READS[tool].args_model.model_fields)


def test_strict_models_reject_unknown_fields() -> None:
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ACTIONS["request_835"].params.model_validate({"claim_id": "c", "tier": 1})
    with pytest.raises(ValidationError):
        READS["pms_get_visit"].args_model.model_validate({"visit_id": "v", "confidence": 0.9})
