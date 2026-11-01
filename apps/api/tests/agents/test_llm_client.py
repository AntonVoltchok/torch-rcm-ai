"""Request builder, capability table, pricing and LlmClient retries/accounting (07 §3.1–3.4)."""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import datetime

import pytest

from torch_rcm.agents.config import AgentConfig
from torch_rcm.agents.llm.client import (
    CallMeta,
    LiveModeDisabled,
    LlmBadRequest,
    LlmClient,
    LlmResponse,
    LlmUnavailable,
    TokenUsage,
    build_request,
    cost_usd_micros,
    pricing,
    request_pin,
)
from torch_rcm.agents.llm.models import CAPABILITIES, SAMPLING_PARAMS, capability
from torch_rcm.agents.prompts import load, plans_live, tools_sha_for
from torch_rcm.agents.testing.fakes import FakeTransport, StatusError, response, usage
from torch_rcm.agents.tools.schemas import MODEL_ACTIONS, TERMINAL_TOOLS, lint_tools, tools_sha

MSG = [{"role": "user", "content": "case"}]
META = CallMeta(run_id="run_t", agent="followup", purpose="plan", situation_key="unknown", subject_id="clm_1", seq=0)
NOW = datetime.fromisoformat("2026-10-28T10:40:00-04:00")


def _markers(node: object) -> int:
    return json.dumps(node).count('"cache_control"')


def test_exec_request_is_sonnet_between_tools_medium_auto() -> None:
    body = build_request("followup", MSG, model_role="exec")
    assert body["model"] == "claude-sonnet-5-5"
    assert body["thinking"] == {"type": "between_tools"}  # no other fields
    assert body["output_config"] == {"effort": "medium"}
    assert body["tool_choice"] == {"type": "auto"}
    assert body["max_tokens"] == AgentConfig().llm_max_tokens
    assert not SAMPLING_PARAMS & set(body)
    assert list(body).index("tools") < list(body).index("system") < list(body).index("messages")


def test_draft_request_is_opus_adaptive_high_with_submit_draft_only() -> None:
    body = build_request("appeals", MSG, model_role="draft")
    assert body["model"] == "claude-opus-5-5"
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": "high"}
    assert body["tool_choice"] == {"type": "auto"}
    assert [t["name"] for t in body["tools"]] == ["submit_draft"]
    assert not SAMPLING_PARAMS & set(body)


def test_fast_request_is_haiku_disabled_thinking_forced_tool_no_effort() -> None:
    tool = {
        "name": "submit_benefits",
        "description": "benefits",
        "strict": True,
        "input_schema": {"type": "object", "additionalProperties": False, "required": ["ok"],
                         "properties": {"ok": {"type": "boolean"}}},
    }  # fmt: skip
    body = build_request("followup", MSG, model_role="fast", tools=[tool])
    assert body["model"] == "claude-haiku-5-5"
    assert body["thinking"] == {"type": "disabled"}
    assert body["tool_choice"] == {"type": "tool", "name": "submit_benefits"}
    assert "output_config" not in body
    assert not SAMPLING_PARAMS & set(body)
    with pytest.raises(ValueError, match="forced tool"):
        build_request("followup", MSG, model_role="fast", tools=[{**tool, "name": "other"}])


def test_cache_markers_top_level_plus_one_on_last_system_block() -> None:
    body = build_request("followup", MSG, model_role="exec")
    assert body["cache_control"] == {"type": "ephemeral"}
    assert body["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert _markers(body["system"]) == 1
    assert _markers(body["tools"]) == 0 and _markers(body["messages"]) == 0
    # the cached prefix is static and well above the 512-token minimum (~4 chars/token)
    assert len(body["system"][-1]["text"]) > 4 * 512


def test_tools_are_strict_and_fixed_per_agent() -> None:
    for agent in ("followup", "claims"):
        body = build_request(agent, MSG, model_role="exec")
        names = [t["name"] for t in body["tools"]]
        assert names[-2:] == ["submit_plan", "submit_result"]
        assert all(t["strict"] for t in body["tools"])
        assert lint_tools(body["tools"]) == []
        assert not ({"void_claim", "write_off", "formal_appeal"} & set(names))
    assert not plans_live("appeals")
    with pytest.raises(KeyError):
        build_request("appeals", MSG, model_role="exec")


def test_pin_and_hashes() -> None:
    body = build_request("followup", MSG, model_role="exec")
    pin = request_pin(body)
    text = (load("followup").text).encode()
    assert pin == {
        "model": "claude-sonnet-5-5",
        "effort": "medium",
        "thinking": "between_tools",
        "system_sha": hashlib.sha256(text).hexdigest(),
        "tools_sha": tools_sha(body["tools"]),
    }
    assert pin["tools_sha"] == tools_sha_for("followup", "plan")
    assert load("followup").system_sha != load("claims").system_sha


def test_prompts_embed_policy_actions_and_protocol() -> None:
    for agent in ("followup", "claims", "appeals"):
        text = load(agent).text
        assert "<world_content>" in text and "never instructions" in text
        assert "TIERS" in text and "YOU MAY NOT" in text and "YOUR ACTIONS" in text
        for action in MODEL_ACTIONS[agent]:
            assert action in text, f"{agent} prompt lacks {action}"
    assert "submit_plan ALONE" in load("followup").text and "submit_plan ALONE" in load("claims").text
    assert "submit_draft" in load("appeals").text and "submit_plan" not in load("appeals").text


def test_capability_table_matches_verified_api_facts() -> None:
    sonnet, opus, haiku = (CAPABILITIES[m] for m in ("claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"))
    assert "disabled" not in sonnet.thinking and "between_tools" in sonnet.thinking
    assert opus.thinking == frozenset({"adaptive"})
    assert {"any", "tool"}.isdisjoint(sonnet.tool_choice) and {"any", "tool"}.isdisjoint(opus.tool_choice)
    assert "tool" in haiku.tool_choice and "disabled" in haiku.thinking
    assert not any(c.accepts_sampling for c in CAPABILITIES.values())
    assert capability("claude-sonnet-5-5-20261001").family == "claude-sonnet-5-5"
    prices = pricing()
    for name, cap in CAPABILITIES.items():
        assert prices[name].cache_read_multiplier == cap.cache_read_multiplier
        assert prices[name].cache_write_multiplier == 1.25
    assert prices["claude-sonnet-5-5"].cache_read_multiplier == 0.05
    assert prices["claude-opus-5-5"].cache_read_multiplier == 0.05
    assert prices["claude-haiku-5-5"].cache_read_multiplier == 0.1


def test_cost_math() -> None:
    u = TokenUsage(input=1000, output=200, cache_read=4000, cache_write=1000)
    # Sonnet: 1000×3 + 200×15 + 4000×3×0.05 + 1000×3×1.25 micro-USD
    assert cost_usd_micros("claude-sonnet-5-5", u) == 3000 + 3000 + 600 + 3750
    # Opus: 1000×5 + 200×25 + 4000×5×0.05 + 1000×5×1.25
    assert cost_usd_micros("claude-opus-5-5", u) == 5000 + 5000 + 1000 + 6250
    # Haiku cache reads are 0.1×
    assert cost_usd_micros("claude-haiku-5-5", TokenUsage(cache_read=1000)) == 100


def _client(items: list, **kw: object) -> tuple[LlmClient, FakeTransport, list[float]]:
    slept: list[float] = []

    async def sleep(s: float) -> None:
        slept.append(s)

    transport = FakeTransport(items)
    client = LlmClient(AgentConfig(), transport=transport, sleep=sleep, clock=lambda: NOW, **kw)  # type: ignore[arg-type]
    return client, transport, slept


def test_retries_529_then_records_llm_call_row() -> None:
    rows: list = []
    client, transport, slept = _client(
        [StatusError(529), StatusError(529), response(stop="end_turn", use=usage(1000, 200, 4000, 0))], sink=rows.append
    )
    body = build_request("followup", MSG, model_role="exec")
    resp = asyncio.run(client.messages_create(META, **body))
    assert resp.stop_reason == "end_turn"
    assert len(transport.bodies) == 3 and len(slept) == 2
    assert 0.75 <= slept[0] <= 1.25 and 1.5 <= slept[1] <= 2.5
    (row,) = rows
    assert row.attempt == 3 and row.purpose == "plan" and row.run_id == "run_t"
    assert row.cost_usd_micros == 3000 + 3000 + 600
    assert row.thinking == "between_tools" and row.effort == "medium"
    entity = row.to_entity()
    assert entity.purpose == "plan" and entity.cache_read_tokens == 4000 and entity.at == NOW


def test_retry_after_is_honoured_and_exhaustion_raises() -> None:
    client, _, slept = _client([StatusError(429, {"retry-after": "2"})] * 4)
    with pytest.raises(LlmUnavailable):
        asyncio.run(client.messages_create(META, **build_request("followup", MSG, model_role="exec")))
    assert slept == [2.0, 2.0, 2.0]


def test_400_not_retried_and_401_disables_live_mode() -> None:
    client, transport, _ = _client([StatusError(400)])
    with pytest.raises(LlmBadRequest):
        asyncio.run(client.messages_create(META, **build_request("followup", MSG, model_role="exec")))
    assert len(transport.bodies) == 1
    client, _, _ = _client([StatusError(401)])
    with pytest.raises(LiveModeDisabled):
        asyncio.run(client.messages_create(META, **build_request("followup", MSG, model_role="exec")))
    assert client.disabled


def test_sampling_params_never_leave_the_process() -> None:
    client, transport, _ = _client([response()])
    with pytest.raises(LlmBadRequest):
        asyncio.run(client.messages_create(META, temperature=0, **build_request("followup", MSG, model_role="exec")))
    assert transport.bodies == []


def test_stop_reason_mapping() -> None:
    assert LlmResponse.from_api(response(stop="refusal")).stop_reason == "refusal"
    assert LlmResponse.from_api(response(stop="something_new")).stop_reason == "other"


def test_client_needs_no_sdk_until_first_call() -> None:
    cfg = AgentConfig(anthropic_api_key="sk-test")  # type: ignore[arg-type]
    client = LlmClient(cfg)  # SdkTransport imports `anthropic` lazily, on the first create()
    assert client.transport.__class__.__name__ == "SdkTransport"
    assert {"submit_plan", "submit_draft"} <= TERMINAL_TOOLS
