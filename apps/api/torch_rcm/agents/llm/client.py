"""Messages API request builder and `LlmClient` (07 §3.1–3.4, ADR-0001).

Principle: the model proposes; code gates and executes. This module only shapes requests and accounts for
them. `build_request` is pure (no SDK import) so every request dict is testable without `anthropic`:

- the static capability table (`llm/models.py`) picks thinking, effort and tool choice per role;
- **no `temperature`, `top_p` or `top_k`** on any 5.5 model;
- order tools → system → messages; one explicit `cache_control` breakpoint on the last system block, plus
  top-level automatic `cache_control` that moves forward with the conversation (no per-turn markers);
- strict tools only (`tools/schemas.py`), linted before they are sent.

`LlmClient.messages_create` lazily imports the SDK (via `SdkTransport`), owns retries (SDK `max_retries=0`),
maps `stop_reason` (incl. `refusal`) and records one `llm_calls` row per call, priced from `pricing.toml`.
"""

from __future__ import annotations

import asyncio
import hashlib
import random
import time
import tomllib
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from functools import cache
from pathlib import Path
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict

from torch_rcm.agents.config import AgentConfig
from torch_rcm.agents.llm.models import SAMPLING_PARAMS, ModelProfile, Role, make_profile
from torch_rcm.agents.prompts import Purpose, load, tools_for
from torch_rcm.agents.tools.schemas import JsonSchema, lint_tools, tools_sha
from torch_rcm.agents.types import AgentKind, Usage

PRICING_PATH = Path(__file__).with_name("pricing.toml")
EPHEMERAL: dict[str, str] = {"type": "ephemeral"}
StopReason = Literal["end_turn", "tool_use", "max_tokens", "refusal", "stop_sequence", "pause_turn", "other"]
_KNOWN_STOPS = frozenset({"end_turn", "tool_use", "max_tokens", "refusal", "stop_sequence", "pause_turn"})
RETRY_STATUSES = frozenset({429, 500, 502, 503, 529})
SDK_KWARGS = frozenset({"model", "max_tokens", "messages", "system", "tools", "tool_choice", "thinking", "metadata"})


# ---------------------------------------------------------------- profiles and the request builder


def profile_for(role: Role, cfg: AgentConfig, *, forced_tool: str | None = None) -> ModelProfile:
    if role == "exec":
        return make_profile("exec", cfg.model_exec, cfg.effort_exec)
    if role == "draft":
        return make_profile("draft", cfg.model_draft, cfg.effort_draft)
    return make_profile("fast", cfg.model_fast, None, forced_tool=forced_tool or "submit_benefits")


def role_for(purpose: Purpose) -> Role:
    return "draft" if purpose == "draft" else "exec"


def system_blocks(agent: AgentKind) -> list[dict[str, Any]]:
    """The static system prompt as one text block carrying the single explicit cache breakpoint."""
    return [{"type": "text", "text": load(agent).text, "cache_control": dict(EPHEMERAL)}]


def build_request(
    agent: AgentKind,
    messages: list[dict[str, Any]],
    *,
    model_role: Role,
    cfg: AgentConfig | None = None,
    tools: list[JsonSchema] | None = None,
    forced_tool: str | None = None,
    max_tokens: int | None = None,
) -> dict[str, Any]:
    """The exact Messages API body for one call. Pure: no SDK, no clock, no I/O beyond the cached prompt file."""
    cfg = cfg or AgentConfig()
    profile = profile_for(model_role, cfg, forced_tool=forced_tool)
    if tools is None:
        tools = tools_for(agent, "draft" if model_role == "draft" else "plan")
    problems = lint_tools(tools)
    if problems:
        raise ValueError(f"tool list is not safe for strict mode: {problems}")
    body: dict[str, Any] = {
        "model": profile.model,
        "max_tokens": max_tokens or cfg.llm_max_tokens,
        "tools": tools,
        "tool_choice": profile.tool_choice_param(),
        "system": system_blocks(agent),
        "messages": messages,
        "thinking": profile.thinking_param(),
        "cache_control": dict(EPHEMERAL),
    }
    if profile.effort is not None:
        body["output_config"] = {"effort": profile.effort}
    if profile.tool_choice == "forced" and not any(t["name"] == profile.forced_tool for t in tools):
        raise ValueError(f"forced tool {profile.forced_tool} is not in the tool list")
    assert not SAMPLING_PARAMS & set(body), "5.5 models reject sampling params"
    return body


def request_pin(body: Mapping[str, Any]) -> dict[str, Any]:
    """What a conversation is bound to: model, effort, thinking type and the two prompt hashes."""
    system_text = "".join(b["text"] for b in body["system"])
    return {
        "model": body["model"],
        "effort": (body.get("output_config") or {}).get("effort"),
        "thinking": body["thinking"]["type"],
        "system_sha": hashlib.sha256(system_text.encode("utf-8")).hexdigest(),
        "tools_sha": tools_sha(body["tools"]),
    }


# ---------------------------------------------------------------- pricing


class ModelPrice(BaseModel):
    model_config = ConfigDict(frozen=True)

    input_per_mtok: float
    output_per_mtok: float
    cache_write_multiplier: float = 1.25
    cache_read_multiplier: float


@cache
def pricing(path: Path = PRICING_PATH) -> dict[str, ModelPrice]:
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    return {name: ModelPrice.model_validate(row) for name, row in data["models"].items()}


def price_for(model: str) -> ModelPrice:
    table = pricing()
    family = next((f for f in table if model == f or model.startswith(f + "-")), None)
    if family is None:
        raise KeyError(f"{model} has no row in {PRICING_PATH.name}")
    return table[family]


@dataclass(frozen=True)
class TokenUsage:
    input: int = 0
    output: int = 0
    cache_read: int = 0
    cache_write: int = 0

    @classmethod
    def from_api(cls, usage: Mapping[str, Any] | None) -> TokenUsage:
        u = usage or {}
        return cls(
            input=int(u.get("input_tokens") or 0),
            output=int(u.get("output_tokens") or 0),
            cache_read=int(u.get("cache_read_input_tokens") or 0),
            cache_write=int(u.get("cache_creation_input_tokens") or 0),
        )

    @property
    def total(self) -> int:
        return self.input + self.output + self.cache_read + self.cache_write


def cost_usd_micros(model: str, usage: TokenUsage) -> int:
    """USD per MTok equals micro-USD per token. Thinking is already counted in output tokens."""
    p = price_for(model)
    micros = (
        usage.input * p.input_per_mtok
        + usage.cache_write * p.input_per_mtok * p.cache_write_multiplier
        + usage.cache_read * p.input_per_mtok * p.cache_read_multiplier
        + usage.output * p.output_per_mtok
    )
    return round(micros)


# ---------------------------------------------------------------- responses, call metadata, llm_calls rows


@dataclass(frozen=True)
class CallMeta:
    """Who is calling and why. Cassettes key on it; `llm_calls` rows are written from it."""

    run_id: str
    agent: AgentKind
    purpose: Purpose
    situation_key: str
    subject_id: str
    seq: int
    role: Role = "exec"


@dataclass
class LlmResponse:
    id: str
    model: str
    stop_reason: StopReason
    content: list[dict[str, Any]]
    usage: TokenUsage
    stop_details: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_api(cls, raw: Mapping[str, Any]) -> LlmResponse:
        stop = str(raw.get("stop_reason") or "")
        return cls(
            id=str(raw.get("id") or ""),
            model=str(raw.get("model") or ""),
            stop_reason=stop if stop in _KNOWN_STOPS else "other",  # type: ignore[arg-type]
            content=[dict(b) for b in raw.get("content") or []],
            usage=TokenUsage.from_api(raw.get("usage")),
            stop_details=raw.get("stop_details"),
            raw=dict(raw),
        )

    def tool_uses(self) -> list[dict[str, Any]]:
        return [b for b in self.content if b.get("type") == "tool_use"]


class LlmCallRecord(BaseModel):
    """One `llm_calls` row (07 §7)."""

    model_config = ConfigDict(frozen=True)

    run_id: str
    seq: int
    purpose: str
    role: str
    model: str
    effort: str | None
    thinking: str
    stop_reason: str
    attempt: int
    latency_ms: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    cost_usd_micros: int
    system_sha: str
    tools_sha: str
    at: datetime | None = None
    error: str | None = None

    @property
    def id(self) -> str:
        return f"llm_{self.run_id}_{self.purpose}_{self.seq:02d}"

    def to_usage(self) -> Usage:
        return Usage(
            model_calls=1,
            input=self.input_tokens,
            output=self.output_tokens,
            cache_read=self.cache_read_tokens,
            cache_write=self.cache_write_tokens,
            cost_usd_micros=self.cost_usd_micros,
        )

    def to_entity(self) -> Any:
        """The persisted `LlmCall` entity (imported lazily: the domain layer is not an agents dependency)."""
        from torch_rcm.domain.entities import LlmCall

        assert self.at is not None, "llm_calls rows carry the frozen clock's time"
        return LlmCall(
            id=self.id,
            run_id=self.run_id,
            seq=self.seq,
            model=self.model,
            at=self.at,
            purpose=self.purpose,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            cache_read_tokens=self.cache_read_tokens,
            cache_write_tokens=self.cache_write_tokens,
            stop_reason=self.stop_reason,
            latency_ms=self.latency_ms,
            cost_usd_micros=self.cost_usd_micros,
        )


def call_record(
    meta: CallMeta, body: Mapping[str, Any], resp: LlmResponse, *, attempt: int, latency_ms: int, at: datetime | None
) -> LlmCallRecord:
    pin = request_pin(body)
    return LlmCallRecord(
        run_id=meta.run_id,
        seq=meta.seq,
        purpose=meta.purpose,
        role=meta.role,
        model=str(body["model"]),
        effort=pin["effort"],
        thinking=pin["thinking"],
        stop_reason=resp.stop_reason,
        attempt=attempt,
        latency_ms=latency_ms,
        input_tokens=resp.usage.input,
        output_tokens=resp.usage.output,
        cache_read_tokens=resp.usage.cache_read,
        cache_write_tokens=resp.usage.cache_write,
        cost_usd_micros=cost_usd_micros(str(body["model"]), resp.usage),
        system_sha=pin["system_sha"],
        tools_sha=pin["tools_sha"],
        at=at,
    )


# ---------------------------------------------------------------- errors and transports


class LlmError(Exception):
    reason = "api_error"

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class LlmBadRequest(LlmError):  # noqa: N818
    """400: not retried; the model-error path (labelled scripted fallback)."""

    reason = "api_bad_request"


class LlmUnavailable(LlmError):  # noqa: N818
    """Retries exhausted (429/529/5xx/connection)."""

    reason = "api_unavailable"


class LiveModeDisabled(LlmError):  # noqa: N818
    """401/403: the key was rejected; live mode is off for the process."""

    reason = "live_mode_unavailable"


class Transport(Protocol):
    async def create(self, body: dict[str, Any]) -> dict[str, Any]: ...


class SdkTransport:
    """The real API, through the `anthropic` SDK imported on first use (it is optional at import time)."""

    def __init__(self, api_key: str, timeout_s: float) -> None:
        self.api_key = api_key
        self.timeout_s = timeout_s
        self._client: Any = None

    def _sdk(self) -> Any:
        if self._client is None:
            import anthropic  # lazy: tests and deterministic mode never need it

            self._client = anthropic.AsyncAnthropic(api_key=self.api_key, max_retries=0, timeout=self.timeout_s)
        return self._client

    async def create(self, body: dict[str, Any]) -> dict[str, Any]:
        kwargs = {k: v for k, v in body.items() if k in SDK_KWARGS}
        extra = {k: v for k, v in body.items() if k not in SDK_KWARGS}  # output_config, top-level cache_control
        resp = await self._sdk().messages.create(**kwargs, extra_body=extra or None)
        dumped: dict[str, Any] = resp.model_dump(mode="json", exclude_none=True)
        return dumped


def _status(exc: BaseException) -> int | None:
    status = getattr(exc, "status_code", None)
    if status is None:
        status = getattr(getattr(exc, "response", None), "status_code", None)
    return int(status) if isinstance(status, int) else None


def _retry_after(exc: BaseException) -> float | None:
    headers = getattr(getattr(exc, "response", None), "headers", None) or getattr(exc, "headers", None) or {}
    try:
        value = headers.get("retry-after")
        return float(value) if value is not None else None
    except (TypeError, ValueError, AttributeError):
        return None


def _is_connection_error(exc: BaseException) -> bool:
    name = type(exc).__name__
    return isinstance(exc, (ConnectionError, TimeoutError, asyncio.TimeoutError)) or name in (
        "APIConnectionError",
        "APITimeoutError",
    )


type Sink = Callable[[LlmCallRecord], None]
type Sleep = Callable[[float], Awaitable[None]]


class LlmClient:
    """Retries, stop-reason mapping and `llm_calls` accounting around a `Transport`."""

    MAX_SLEEP_S = 30.0

    def __init__(
        self,
        cfg: AgentConfig,
        *,
        transport: Transport | None = None,
        sink: Sink | None = None,
        sleep: Sleep = asyncio.sleep,
        rng: random.Random | None = None,
        clock: Callable[[], datetime] | None = None,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self.cfg = cfg
        if transport is None:
            if cfg.anthropic_api_key is None:
                raise LiveModeDisabled("ANTHROPIC_API_KEY is not set")
            transport = SdkTransport(cfg.anthropic_api_key.get_secret_value(), cfg.llm_timeout_s)
        self.transport = transport
        self.sink = sink
        self.sleep = sleep
        self.rng = rng or random.Random(0)
        self.clock = clock
        self.monotonic = monotonic
        self.records: list[LlmCallRecord] = []
        self.disabled = False

    def backoff(self, attempt: int, retry_after: float | None) -> float:
        if retry_after is not None:
            return min(retry_after, self.MAX_SLEEP_S)
        base: float = 1.0 * (2**attempt)
        return min(base * self.rng.uniform(0.75, 1.25), self.MAX_SLEEP_S)

    async def messages_create(self, meta: CallMeta, **body: Any) -> LlmResponse:
        if self.disabled:
            raise LiveModeDisabled("live mode unavailable: key rejected")
        if SAMPLING_PARAMS & set(body):
            raise LlmBadRequest(f"refusing to send {sorted(SAMPLING_PARAMS & set(body))} to a 5.5 model", 400)
        last: BaseException | None = None
        for attempt in range(self.cfg.llm_max_attempts):
            started = self.monotonic()
            try:
                raw = await self.transport.create(dict(body))
            except Exception as exc:
                status = _status(exc)
                if status in (401, 403):
                    self.disabled = True
                    raise LiveModeDisabled("live mode unavailable: key rejected", status) from exc
                if status == 400 or (status is not None and 400 <= status < 500 and status != 429):
                    raise LlmBadRequest(str(exc), status) from exc
                if status in RETRY_STATUSES or _is_connection_error(exc):
                    last = exc
                    if attempt + 1 < self.cfg.llm_max_attempts:
                        await self.sleep(self.backoff(attempt, _retry_after(exc)))
                    continue
                raise LlmError(str(exc), status) from exc
            resp = LlmResponse.from_api(raw)
            latency = int((self.monotonic() - started) * 1000)
            rec = call_record(
                meta, body, resp, attempt=attempt + 1, latency_ms=latency, at=self.clock() if self.clock else None
            )
            self.records.append(rec)
            if self.sink is not None:
                self.sink(rec)
            return resp
        raise LlmUnavailable(
            f"gave up after {self.cfg.llm_max_attempts} attempts: {last}", _status(last) if last else None
        )


__all__ = [
    "CallMeta",
    "LiveModeDisabled",
    "LlmBadRequest",
    "LlmCallRecord",
    "LlmClient",
    "LlmError",
    "LlmResponse",
    "LlmUnavailable",
    "SdkTransport",
    "TokenUsage",
    "Transport",
    "build_request",
    "call_record",
    "cost_usd_micros",
    "price_for",
    "pricing",
    "profile_for",
    "request_pin",
    "role_for",
    "system_blocks",
]
