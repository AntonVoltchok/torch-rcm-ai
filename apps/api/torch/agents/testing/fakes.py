"""Test doubles for the live loop: a scripted model client, response builders and a fake transport.

Nothing here talks to the API. `FakeClient` returns canned Messages API responses in order and records every
request body it was sent, so tests can assert on the exact request dicts the planner built.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import date, datetime
from typing import Any

from torch.agents.llm.client import CallMeta, LlmResponse
from torch.agents.planner.base import ReadResult
from torch.agents.types import (
    CaseFile,
    ClaimLineView,
    ClaimView,
    DenialView,
    Evidence,
    JsonValue,
    PatientView,
    Subject,
)

NOW = datetime.fromisoformat("2026-10-28T10:40:00-04:00")


def usage(input: int = 1000, output: int = 150, cache_read: int = 3900, cache_write: int = 0) -> dict[str, int]:
    return {
        "input_tokens": input,
        "output_tokens": output,
        "cache_read_input_tokens": cache_read,
        "cache_creation_input_tokens": cache_write,
    }


def tool_use(tid: str, name: str, inp: dict[str, Any]) -> dict[str, Any]:
    return {"type": "tool_use", "id": tid, "name": name, "input": inp}


def thinking(text: str, sig: str = "sig-test") -> dict[str, Any]:
    return {"type": "thinking", "thinking": text, "signature": sig}


def text(t: str) -> dict[str, Any]:
    return {"type": "text", "text": t}


def response(
    *content: dict[str, Any],
    stop: str = "tool_use",
    model: str = "claude-sonnet-5-5",
    use: dict[str, int] | None = None,
    mid: str = "msg_test",
) -> dict[str, Any]:
    return {
        "id": mid,
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": list(content),
        "stop_reason": stop,
        "usage": use or usage(),
    }


class FakeClient:
    """Plays back responses in order (or computes them from the request with a callable)."""

    def __init__(
        self, responses: Iterable[dict[str, Any] | Callable[[dict[str, Any]], dict[str, Any]] | Exception]
    ) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[CallMeta, dict[str, Any]]] = []

    async def messages_create(self, meta: CallMeta, **body: Any) -> LlmResponse:
        self.calls.append((meta, body))
        if not self.responses:
            raise AssertionError(f"FakeClient ran out of responses at call {len(self.calls)}")
        nxt = self.responses.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        raw = nxt(body) if callable(nxt) else nxt
        return LlmResponse.from_api(raw)


class FakeTransport:
    """For `LlmClient`: raises the queued exceptions, then returns the queued raw responses."""

    def __init__(self, items: Iterable[dict[str, Any] | Exception]) -> None:
        self.items = list(items)
        self.bodies: list[dict[str, Any]] = []

    async def create(self, body: dict[str, Any]) -> dict[str, Any]:
        self.bodies.append(body)
        item = self.items.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


class StatusError(Exception):
    """Looks like an `anthropic.APIStatusError` to `LlmClient` (status_code + response.headers)."""

    def __init__(self, status: int, headers: dict[str, str] | None = None) -> None:
        super().__init__(f"HTTP {status}")
        self.status_code = status
        self.response = type("R", (), {"headers": headers or {}, "status_code": status})()


# ---------------------------------------------------------------- a small followup case and its reads


def fake_case(agent: str = "followup", situation: str = "denied:CO-16:N29:pa_missing") -> CaseFile:
    denial = DenialView(group="CO", carc="16", rarc="N29", line_id="cl_1", decoded="Missing pre-op radiograph")
    claim = ClaimView(
        id="clm_9001",
        number=9001,
        patient_id="pat_test",
        visit_id="vis_test",
        coverage_id="cov_test",
        payer_key="delta_ny",
        status="denied",
        dos=date(2026, 10, 12),
        billed_cents=124_000,
        lines=(ClaimLineView(id="cl_1", cdt="D2740", tooth="19", fee_cents=124_000),),
        denial=denial,
    )
    return CaseFile(
        run_id="run_test",
        practice_id="prc_test",
        agent=agent,  # type: ignore[arg-type]
        subject=Subject(kind="claim", id="clm_9001"),
        now=NOW,
        claim=claim,
        patient=PatientView(id="pat_test", first="Kim", last="Owens"),
        denial=denial,
        classifier_situation=situation,
        related_ids=("img_pa_19", "vis_test"),
        evidence=(
            Evidence(
                id="ev_era", kind="era_line", title="Delta 835 · denial line", excerpt="CO-16 N29", captured_at=NOW
            ),
        ),
    )


class FakeReader:
    def __init__(self, portal_text: str = "Claim denied: pre-op PA required.") -> None:
        self.portal_text = portal_text
        self.calls: list[tuple[str, dict[str, JsonValue]]] = []

    async def __call__(self, tool: str, args: dict[str, JsonValue]) -> ReadResult:
        self.calls.append((tool, args))
        if tool == "pms_find_images":
            ev = Evidence(
                id="ev_img",
                kind="pms_record",
                title="PA x-ray, tooth #19",
                excerpt="PA #19 taken 2026-10-12",
                captured_at=NOW,
                gathered_by="agent",
                data={"kind": "pa", "tooth": "19"},
            )
            return ReadResult(
                ok=True,
                tool=tool,
                args=args,
                data={"images": [{"id": "img_pa_19"}]},
                evidence=[ev],
                progress_line="PMS imaging · PA #19 · 1 found",
            )
        if tool == "claim_get_history":
            ev = Evidence(
                id="ev_portal",
                kind="portal_screenshot",
                title="Delta portal",
                excerpt=self.portal_text,
                captured_at=NOW,
                untrusted=True,
                gathered_by="agent",
            )
            return ReadResult(ok=True, tool=tool, args=args, data={"correspondence": [self.portal_text]}, evidence=[ev])
        return ReadResult(ok=False, tool=tool, args=args, error=f"{tool} not available")


READ_IMAGES = tool_use(
    "tu_1", "pms_find_images", {"patient_id": "pat_test", "on_or_before": "2026-10-12", "kinds": ["pa"], "tooth": "19"}
)
READ_HISTORY = tool_use("tu_h", "claim_get_history", {"claim_id": "clm_9001", "include": ["correspondence"]})


def plan_input(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "situation_key": "denied:CO-16:N29:pa_missing",
        "situation_description": None,
        "actions": [
            {
                "action": "resubmit_with_attachment",
                "claim_id": "clm_9001",
                "image_id": "img_pa_19",
                "attachment_kind": "pa",
                "evidence_ids": ["E1", "E2"],
                "rationale": "payer needs the pre-op PA",
            }
        ],
        "no_action_reason": None,
        "reviewer_summary": "Attach the 10/12 PA of #19 and resubmit.",
        "injection_suspected": False,
    }
    base.update(over)
    return base


def submit(tid: str = "tu_p", **over: Any) -> dict[str, Any]:
    return tool_use(tid, "submit_plan", plan_input(**over))


__all__ = [
    "READ_HISTORY",
    "READ_IMAGES",
    "FakeClient",
    "FakeReader",
    "FakeTransport",
    "StatusError",
    "fake_case",
    "plan_input",
    "response",
    "submit",
    "text",
    "thinking",
    "tool_use",
    "usage",
]
