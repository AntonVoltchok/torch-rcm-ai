"""The HTTP contract as a table (method, path, models, params) and the OpenAPI document built from it.

`openapi_document()` returns FastAPI's generated document when FastAPI is importable; otherwise it builds the
same paths from ROUTES and the same component schemas from the pydantic models. tests/test_api_contract.py
asserts ROUTES and the FastAPI app agree (method + path + response model), so the table cannot drift.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from torch.api import schemas as S
from torch.domain.entities import Remittance, Run, SavedView
from torch.domain.enums import ClaimStatus, RuleMode

PREFIX = "/api/v1"


@dataclass(frozen=True)
class Param:
    name: str
    schema: dict[str, Any]
    required: bool = False
    location: str = "query"


@dataclass(frozen=True)
class Route:
    method: str
    path: str
    tag: str
    summary: str
    response: type[BaseModel] | None
    status: int = 200
    body: type[BaseModel] | None = None
    params: tuple[Param, ...] = field(default_factory=tuple)
    errors: tuple[int, ...] = ()
    sse: bool = False
    response_list: bool = False


STR = {"type": "string"}
INT = {"type": "integer"}
BOOL = {"type": "boolean"}
DATE = {"type": "string", "format": "date"}
DT = {"type": "string", "format": "date-time"}
STATUSES = {"type": "array", "items": {"type": "string", "enum": [s.value for s in ClaimStatus]}}
LOC = Param("location_id", STR)

ROUTES: tuple[Route, ...] = (
    Route("GET", "/clock", "clock", "Sim clock", S.ClockOut),
    Route(
        "POST",
        "/clock/advance",
        "clock",
        "Advance the sim clock (async: 202 + advance_id; ?wait=true awaits)",
        S.AdvanceAccepted,
        202,
        S.AdvanceIn,
        (Param("wait", BOOL),),
        (409, 422),
    ),
    Route(
        "GET",
        "/clock/advance/{advance_id}",
        "clock",
        "Advance progress snapshot",
        S.AdvanceOut,
        errors=(404,),
    ),
    Route("POST", "/clock/reset", "clock", "Reseed the canonical scenario", S.ReseedOut, errors=(409,)),
    Route(
        "GET",
        "/inbox",
        "inbox",
        "Inbox items (priority order)",
        S.InboxList,
        params=(
            Param("state", {"type": "string", "enum": ["open", "snoozed", "done"]}),
            Param("kind", STR),
            Param("agent", STR),
            Param("group", BOOL),
            LOC,
        ),
    ),
    Route("GET", "/inbox/{item_id}", "inbox", "Inbox item with evidence", S.InboxItemDetail, errors=(404,)),
    Route(
        "POST",
        "/inbox/{item_id}:approve",
        "inbox",
        "Approve: starts a run (202)",
        S.ApproveOut,
        202,
        S.ApproveIn,
        errors=(403, 404, 409),
    ),
    Route(
        "POST",
        "/inbox:approve-group",
        "inbox",
        "Approve a payer × item-type group",
        S.GroupApproveOut,
        202,
        S.GroupApproveIn,
        errors=(403, 404, 409),
    ),
    Route("POST", "/inbox/{item_id}:reject", "inbox", "Reject", S.ItemOut, body=S.RejectIn, errors=(404, 409)),
    Route(
        "POST",
        "/inbox/{item_id}:snooze",
        "inbox",
        "Snooze until a sim time",
        S.ItemOut,
        body=S.SnoozeIn,
        errors=(404, 409, 422),
    ),
    Route(
        "POST",
        "/inbox/{item_id}:reopen",
        "inbox",
        "Reopen a snoozed or rejected item",
        S.ItemOut,
        errors=(404, 409),
    ),
    Route(
        "POST",
        "/inbox/{item_id}:always-auto-run",
        "inbox",
        "Propose a rule to always run this (tier 1)",
        S.ProposalOut,
        201,
        errors=(404, 422),
    ),
    Route(
        "GET",
        "/claims",
        "claims",
        "Claims table (server-side filter, sort, cursor)",
        S.ClaimList,
        params=(
            Param("status[]", STATUSES),
            Param("status", STATUSES),
            Param("needs_action", BOOL),
            Param("payer", STR),
            Param("provider", STR),
            Param("age_bucket", {"type": "string", "enum": ["0_30", "31_60", "61_90", "90_plus"]}),
            Param("q", STR),
            Param("sort", STR),
            Param("cursor", STR),
            Param("limit", INT),
            LOC,
        ),
    ),
    Route(
        "GET",
        "/claims/{claim_id}",
        "claims",
        "Claim detail with timeline and open items",
        S.ClaimDetail,
        errors=(404,),
    ),
    Route(
        "GET",
        "/claims/{claim_id}/timeline",
        "claims",
        "Older timeline pages",
        S.TimelinePage,
        params=(Param("cursor", STR),),
        errors=(404,),
    ),
    Route(
        "POST",
        "/claims/{claim_id}:void",
        "claims",
        "Void (frequency 8 · tier 3 · owner)",
        S.ClaimMutationOut,
        body=S.VoidIn,
        errors=(403, 404, 409),
    ),
    Route(
        "POST",
        "/claims/{claim_id}:corrected",
        "claims",
        "Corrected claim (frequency 7 · tier 2)",
        S.ClaimMutationOut,
        201,
        S.CorrectedIn,
        errors=(403, 404, 409),
    ),
    Route(
        "POST",
        "/claims/{claim_id}:triage",
        "claims",
        "Ask an agent to look (manual triage run)",
        S.TriageOut,
        202,
        S.TriageIn,
        errors=(403, 404, 409),
    ),
    Route(
        "GET",
        "/summary/strip",
        "summary",
        "Pipeline strip + inbox count (also meta.counts)",
        S.Strip,
        params=(LOC,),
    ),
    Route("GET", "/views", "views", "Saved views", S.ViewList),
    Route("POST", "/views", "views", "Save a view", SavedView, 201, S.ViewIn, errors=(422,)),
    Route("GET", "/ledger/today", "ledger", "Today's claims", S.LedgerToday),
    Route(
        "GET",
        "/runs",
        "runs",
        "Runs",
        S.RunList,
        params=(
            Param("agent", STR),
            Param("status", STR),
            Param("since", DT),
            Param("claim_id", STR),
            Param("limit", INT),
        ),
    ),
    Route(
        "GET",
        "/runs/stream",
        "runs",
        "SSE firehose: run status, advance progress, agents pause",
        None,
        sse=True,
    ),
    Route("GET", "/runs/{run_id}", "runs", "Run with steps and evidence", S.RunDetail, errors=(404,)),
    Route("GET", "/runs/{run_id}/events", "runs", "SSE for one run (Last-Event-ID replay)", None, sse=True),
    Route("POST", "/runs/{run_id}:cancel", "runs", "Cancel a queued run", Run, errors=(404, 409)),
    Route("GET", "/agents/status", "agents", "Agents status", S.AgentsStatus),
    Route("POST", "/agents:pause", "agents", "Pause agents (owner)", S.AgentsStatus, errors=(403,)),
    Route("POST", "/agents:resume", "agents", "Resume agents (owner)", S.AgentsStatus, errors=(403,)),
    Route("GET", "/rules", "settings", "Tiered rules table", S.RulesOut),
    Route("GET", "/rules/changes", "settings", "Rule change log", S.RuleChangeList),
    Route(
        "PATCH",
        "/rules/{rule_id}",
        "settings",
        "Change a rule (tier 2 needs the owner: 409 owner_signoff_required)",
        S.RulePatchOut,
        body=S.RulePatchIn,
        errors=(403, 404, 409, 422),
    ),
    Route(
        "GET",
        "/settings/preview",
        "settings",
        "This week's decisions under a hypothetical rule",
        S.PreviewOut,
        params=(
            Param("rule_id", STR, True),
            Param("mode", {"type": "string", "enum": [m.value for m in RuleMode]}),
            Param("max_cents", INT),
        ),
        errors=(404,),
    ),
    Route("GET", "/proposals", "settings", "Rule proposals", S.ProposalList),
    Route(
        "POST",
        "/proposals/{proposal_id}:accept",
        "settings",
        "Accept a proposal (422 root_cause_guard)",
        S.ProposalOut,
        errors=(403, 404, 409, 422),
    ),
    Route(
        "POST",
        "/proposals/{proposal_id}:dismiss",
        "settings",
        "Dismiss a proposal",
        S.ProposalOut,
        errors=(404, 409),
    ),
    Route(
        "GET",
        "/activity",
        "activity",
        "Agent run log and this week's decisions",
        S.ActivityOut,
        params=(Param("day", DATE), Param("agent", STR), Param("outcome", STR)),
    ),
    Route(
        "GET",
        "/eligibility",
        "eligibility",
        "Appointments with verification status",
        S.EligibilityOut,
        params=(Param("date", DATE),),
    ),
    Route(
        "GET",
        "/eligibility/{appointment_id}",
        "eligibility",
        "Benefits panel",
        S.BenefitsPanel,
        errors=(404,),
    ),
    Route("GET", "/cash", "cash", "Owner KPIs with formulas", S.CashOut, params=(LOC,), errors=(403,)),
    Route("GET", "/denials", "denials", "Denials worklist by next action", S.DenialsOut, errors=(403,)),
    Route("GET", "/remittances", "payments", "Remittances", S.RemittanceList),
    Route("GET", "/remittances/{remittance_id}", "payments", "Remittance", Remittance, errors=(404,)),
    Route("GET", "/patients/balances", "patients", "Patient balances", S.PatientBalances),
    Route(
        "POST",
        "/_world/reseed",
        "_world",
        "Reseed a scenario",
        S.ReseedOut,
        body=S.ReseedIn,
        errors=(409, 422),
    ),
    Route(
        "GET",
        "/_world/payers",
        "_world",
        "Payer rules in the simulated world",
        S.WorldPayer,
        response_list=True,
    ),
    Route(
        "POST",
        "/_world/inject",
        "_world",
        "Inject a world event",
        S.InjectOut,
        body=S.InjectIn,
        errors=(422,),
    ),
)


def _operation_id(route: Route) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", route.path.replace("{", "").replace("}", "")).strip("_")
    return f"{route.method.lower()}_{slug}"


def _ref(model: type[BaseModel]) -> dict[str, str]:
    return {"$ref": f"#/components/schemas/{model.__name__}"}


def _components() -> dict[str, Any]:
    models: set[type[BaseModel]] = {S.ErrorResponse}
    for r in ROUTES:
        if r.response is not None:
            models.add(r.response)
        if r.body is not None:
            models.add(r.body)
    mode: Literal["serialization"] = "serialization"
    keyed = [(m, mode) for m in sorted(models, key=lambda m: m.__name__)]
    _, top = models_json_schema(keyed, ref_template="#/components/schemas/{model}")
    return dict(sorted(top.get("$defs", {}).items()))


def _path_params(path: str) -> list[Param]:
    return [Param(name, STR, True, "path") for name in re.findall(r"{(\w+)}", path)]


def _operation(route: Route) -> dict[str, Any]:
    op: dict[str, Any] = {"tags": [route.tag], "summary": route.summary, "operationId": _operation_id(route)}
    params = [*_path_params(route.path), *route.params, Param("X-Torch-User", STR, False, "header")]
    op["parameters"] = [{"name": p.name, "in": p.location, "required": p.required, "schema": p.schema} for p in params]
    if route.body is not None:
        op["requestBody"] = {"required": True, "content": {"application/json": {"schema": _ref(route.body)}}}
    if route.sse:
        content: dict[str, Any] = {"text/event-stream": {"schema": STR}}
    elif route.response is None:
        content = {}
    elif route.response_list:
        content = {"application/json": {"schema": {"type": "array", "items": _ref(route.response)}}}
    else:
        content = {"application/json": {"schema": _ref(route.response)}}
    responses: dict[str, Any] = {str(route.status): {"description": "OK", "content": content}}
    for code in (*route.errors, 401):
        responses[str(code)] = {
            "description": "Error",
            "content": {"application/json": {"schema": _ref(S.ErrorResponse)}},
        }
    op["responses"] = responses
    return op


def table_document() -> dict[str, Any]:
    paths: dict[str, Any] = {}
    for route in ROUTES:
        paths.setdefault(PREFIX + route.path, {})[route.method.lower()] = _operation(route)
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Torch API",
            "version": "0.1.0",
            "description": "Generated from torch/api/contract.py (FastAPI's document supersedes it wherever FastAPI is installed).",
        },
        "paths": paths,
        "components": {"schemas": _components()},
    }


def openapi_document() -> dict[str, Any]:
    try:
        from torch.api.app import create_app
        from torch.config import Settings
    except ImportError:
        return table_document()
    doc: dict[str, Any] = create_app(Settings(db_url="sqlite://"), start_worker=False).openapi()
    return doc
