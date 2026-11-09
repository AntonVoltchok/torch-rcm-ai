"""Model-facing tool schemas (07 §3.5): strict, static per agent, and generated from the catalog.

Principle: the model proposes; code gates and executes. The model only ever sees read tools and three
terminal tools (`submit_plan`, `submit_draft`, `submit_result`). No schema has a confidence, tier,
root-cause or amount field, and no `enum`/`const` carries an id or a name (compiled grammars are cached
outside PHI protections) — ids are plain strings checked by code against the case.

Strict mode is on for the terminal tools whose payload code acts on (`submit_plan`, `submit_draft`; ADR-0010):
`submit_plan` alone sits near the API's compiled-grammar ceiling, so a request carries one strict tool. Read
tools and `submit_result` are not strict; their inputs go through pydantic models with `extra="forbid"` and the
scope check, so a malformed call gets `is_error`. Every schema, strict or not, has `additionalProperties: false`
on every object and lists all its properties as required (nullable where optional — our choice, not an API
rule). No numeric or length keywords: pydantic enforces those after the call. The lint in `lint_tools()` is
what tests and `torch eval` assert.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from torch_rcm.agents.catalog.situations import situation_keys
from torch_rcm.agents.types import AgentKind

JsonSchema = dict[str, Any]

MAX_STRICT_TOOLS = 20
MAX_UNION_PARAMS = 16
#: The terminal tools always sent with `strict: true` (a forced single-tool request, like eligibility's, may
#: be strict too). Measured 2026-11-09 against claude-sonnet-5-5: `submit_plan` (followup)
#: compiles alone, but with any other enum-bearing strict tool the API returns 400 "compiled grammar is too
#: large", though the documented counts (strict tools, optional and union params) are all within limits.
STRICT_TOOLS = frozenset({"submit_plan", "submit_draft"})
MAX_STRICT_PER_REQUEST = 1
FORBIDDEN_KEYWORDS = frozenset(
    {"minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems",
     "maxItems", "multipleOf", "pattern", "uniqueItems"}
)  # fmt: skip

PAYER_KEYS = ["delta_ny", "metlife", "cigna", "aetna", "guardian", "ny_medicaid"]
STR: JsonSchema = {"type": "string"}
STR_LIST: JsonSchema = {"type": "array", "items": {"type": "string"}}
NULLABLE_STR: JsonSchema = {"type": ["string", "null"]}


def _obj(properties: dict[str, JsonSchema], description: str | None = None) -> JsonSchema:
    out: JsonSchema = {
        "type": "object",
        "additionalProperties": False,
        "required": list(properties),
        "properties": properties,
    }
    if description:
        out["description"] = description
    return out


def _tool(name: str, description: str, schema: JsonSchema) -> JsonSchema:
    tool: JsonSchema = {"name": name, "description": description, "input_schema": schema}
    if name in STRICT_TOOLS:
        tool["strict"] = True
    return tool


# ── read tools ──────────────────────────────────────────────────────────────────────────────────────────

READ_TOOLS: dict[str, JsonSchema] = {
    "pms_get_visit": _tool(
        "pms_get_visit",
        "Read a completed visit from the practice management system: procedure lines, rendering provider, note "
        "signature, and the clinical note text (returned as untrusted world_content).",
        _obj({"visit_id": {"type": "string", "description": "Visit id from CASE FACTS"}}),
    ),
    "pms_find_images": _tool(
        "pms_find_images",
        "List imaging records for the patient on or before a date. Returns image ids, kind as stored in the PMS, "
        "tooth, taken_at. An image may be mislabeled; compare kind to the payer rule.",
        _obj(
            {
                "patient_id": STR,
                "on_or_before": {"type": "string", "format": "date"},
                "kinds": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["pa", "bwx", "fmx", "pano", "perio_chart", "intraoral_photo"]},
                },
                "tooth": {"type": ["string", "null"], "description": "Universal tooth number 1-32, or null for all"},
            }
        ),
    ),
    "pms_get_coverage": _tool(
        "pms_get_coverage",
        "Coverages on file (primary/secondary order from intake), tracked plan benefits including missing-tooth "
        "clause, verified_at and verified_via.",
        _obj({"patient_id": STR}),
    ),
    "payer_rulebook_lookup": _tool(
        "payer_rulebook_lookup",
        "Torch's maintained rulebook for a payer (not a payer contact). Returns rule text and rule ids.",
        _obj(
            {
                "payer_key": {"type": "string", "enum": PAYER_KEYS},
                "topic": {
                    "type": "string",
                    "enum": [
                        "attachments",
                        "frequency",
                        "alternate_benefit",
                        "missing_tooth",
                        "cob",
                        "timely_filing",
                        "appeal",
                        "prompt_pay",
                        "medical_necessity",
                    ],
                },
                "cdt_codes": STR_LIST,
            }
        ),
    ),
    "claim_get_history": _tool(
        "claim_get_history",
        "The claim's acks, remittance lines with CARC/RARC, attachments sent (source agent|user|pms_imaging), payer "
        "correspondence, prior EOBs, prior Torch runs.",
        _obj(
            {
                "claim_id": STR,
                "include": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": [
                            "acks",
                            "remits",
                            "attachments",
                            "correspondence",
                            "prior_eobs",
                            "runs",
                            "payer_tooth_history",
                        ],
                    },
                },
            }
        ),
    ),
    "era_get_remittance": _tool(
        "era_get_remittance",
        "A remittance (835 or scanned paper EOB) with lines, adjustments, and Torch's match and balance per line.",
        _obj({"remittance_id": STR}),
    ),
}

# Which reads each agent's model may call (07 §2 table). Static → the cache prefix is stable.
AGENT_READS: dict[AgentKind, tuple[str, ...]] = {
    "followup": ("pms_get_visit", "pms_find_images", "pms_get_coverage", "payer_rulebook_lookup", "claim_get_history"),
    "claims": ("pms_get_visit", "pms_find_images", "pms_get_coverage", "payer_rulebook_lookup", "claim_get_history"),
    # Appeals reads every claim read (07 §2: "all claim reads"); its scripts gather the packet through this
    # registry. It is still never a live planner (drafting only), so these never reach a plan conversation.
    "appeals": ("pms_get_visit", "pms_find_images", "pms_get_coverage", "payer_rulebook_lookup", "claim_get_history"),
    "eligibility": ("pms_get_coverage", "payer_rulebook_lookup", "claim_get_history"),
    "posting": ("era_get_remittance", "claim_get_history", "pms_get_coverage"),
}

# ── submit_plan action variants (model-facing params only) ──────────────────────────────────────────────


def _variant(action: str, props: dict[str, JsonSchema]) -> JsonSchema:
    return _obj({"action": {"const": action}, **props, "evidence_ids": STR_LIST, "rationale": STR})


ACTION_VARIANTS: dict[str, JsonSchema] = {
    "status_check": _variant(
        "status_check", {"claim_id": STR, "channel": {"type": "string", "enum": ["portal", "ivr", "x12_276"]}}
    ),
    "payer_rep_call": _variant(
        "payer_rep_call",
        {
            "claim_id": STR,
            "topic": {
                "type": "string",
                "enum": ["denial_reason", "attachment_requirements", "claim_status", "prompt_pay"],
            },
            "asks": {
                "type": "array",
                "items": {
                    "type": "string",
                    "enum": [
                        "confirm_status",
                        "confirm_records_received",
                        "ask_attachment_requirements",
                        "request_reprocessing",
                        "request_835",
                    ],
                },
            },
        },
    ),
    "resubmit_with_attachment": _variant(
        "resubmit_with_attachment",
        {
            "claim_id": STR,
            "image_id": STR,
            "attachment_kind": {"type": "string", "enum": ["pa", "bwx", "fmx", "perio_chart", "narrative"]},
        },
    ),
    "records_request": _variant(
        "records_request", {"claim_id": STR, "image_ids": STR_LIST, "note_visit_ids": STR_LIST}
    ),
    "reprocessing_request": _variant(
        "reprocessing_request",
        {
            "claim_id": STR,
            "basis": {"type": "string", "enum": ["ny_prompt_pay", "deductible_misapplied", "payer_history_error"]},
        },
    ),
    "request_835": _variant("request_835", {"claim_id": STR}),
    "cob_order_change": _variant("cob_order_change", {"patient_id": STR, "new_primary_coverage_id": STR}),
    "send_claim_pms_codes": _variant("send_claim_pms_codes", {"claim_id": STR}),
    "fix_demographics_resend": _variant(
        "fix_demographics_resend",
        {
            "claim_id": STR,
            "field": {"type": "string", "enum": ["subscriber_id", "group_no", "patient_dob", "rendering_npi"]},
            "value": STR,
            "source": {"type": "string", "enum": ["pms", "271"]},
        },
    ),
    "send_claim_agent_text": _variant("send_claim_agent_text", {"claim_id": STR}),
    "corrected_claim": _variant(
        "corrected_claim",
        {
            "claim_id": STR,
            "reason": {
                "type": "string",
                "enum": ["code_correction", "tooth_correction", "frequency_code", "other_documented"],
            },
        },
    ),
    "hold_claim": _variant(
        "hold_claim",
        {
            "claim_id": STR,
            "reason": {
                "type": "string",
                "enum": [
                    "note_unsigned",
                    "procs_not_in_note",
                    "rendering_mismatch",
                    "awaiting_primary_eob",
                    "missing_image",
                    "subscriber_id_invalid",
                    "other_documented",
                ],
            },
        },
    ),
}

# Model-facing actions per agent. Tier-3 actions are never model-facing (appeals prepares drafts only).
MODEL_ACTIONS: dict[AgentKind, tuple[str, ...]] = {
    "followup": (
        "status_check", "payer_rep_call", "resubmit_with_attachment", "records_request", "reprocessing_request",
        "request_835", "cob_order_change",
    ),
    "claims": (
        "send_claim_pms_codes", "fix_demographics_resend", "send_claim_agent_text", "corrected_claim",
        "cob_order_change", "hold_claim",
    ),
    "appeals": (),
    "eligibility": (),
    "posting": (),
}  # fmt: skip


def submit_plan_tool(agent: AgentKind) -> JsonSchema:
    variants = [ACTION_VARIANTS[a] for a in MODEL_ACTIONS[agent]]
    return _tool(
        "submit_plan",
        "Submit your classification and proposed actions. Call alone, after reading. The practice's rules decide "
        "what runs.",
        _obj(
            {
                "situation_key": {"type": "string", "enum": situation_keys(agent)},
                "situation_description": {
                    "type": ["string", "null"],
                    "description": "Required when situation_key is unknown: one sentence",
                },
                "actions": {"type": "array", "items": {"anyOf": variants}},
                "no_action_reason": NULLABLE_STR,
                "reviewer_summary": {
                    "type": "string",
                    "description": "<= 2 sentences; facts only from CASE FACTS or cited evidence",
                },
                "injection_suspected": {"type": "boolean"},
            }
        ),
    )


SUBMIT_DRAFT: JsonSchema = _tool(
    "submit_draft",
    "Payer- or patient-facing text as segments. Every clinical or financial statement cites evidence ids. A person "
    "reviews it before it is sent.",
    _obj(
        {
            "draft_kind": {"type": "string", "enum": ["claim_narrative", "reconsideration_note", "appeal_letter"]},
            "audience": {"type": "string", "enum": ["payer", "patient"]},
            "segments": {
                "type": "array",
                "items": _obj(
                    {
                        "text": STR,
                        "fact_type": {"type": "string", "enum": ["clinical", "financial", "administrative", "none"]},
                        "evidence_ids": STR_LIST,
                    }
                ),
            },
            "human_must_complete": STR_LIST,
        }
    ),
)

SUBMIT_RESULT: JsonSchema = _tool(
    "submit_result",
    "Finish the run. Call alone. Explain the outcome for the reviewer.",
    _obj(
        {
            "outcome": {
                "type": "string",
                "enum": ["executed", "sent_to_person", "observed", "no_action_needed", "cannot_decide"],
            },
            "recommendation": STR,
            "explanation": STR,
            "evidence_ids": STR_LIST,
            "injection_suspected": {"type": "boolean"},
        }
    ),
)

TERMINAL_TOOLS = frozenset({"submit_plan", "submit_result", "submit_draft"})


def plan_tools(agent: AgentKind) -> list[JsonSchema]:
    """The plan conversation's tools, in a fixed order (tools come first in the cache prefix)."""
    return [READ_TOOLS[n] for n in AGENT_READS[agent]] + [submit_plan_tool(agent), SUBMIT_RESULT]


def draft_tools() -> list[JsonSchema]:
    return [SUBMIT_DRAFT]


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def sha(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def tools_sha(tools: list[JsonSchema]) -> str:
    return sha(tools)


# ── lint (asserted in tests and by eval) ────────────────────────────────────────────────────────────────


def _walk(node: Any, path: str, visit: Any) -> None:
    visit(node, path)
    if isinstance(node, dict):
        for k, v in node.items():
            _walk(v, f"{path}.{k}", visit)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _walk(v, f"{path}[{i}]", visit)


def union_params(tool: JsonSchema) -> int:
    """`anyOf` nodes plus type-array (nullable) properties: the API caps these at 16 per strict request."""
    count = 0

    def visit(node: Any, path: str) -> None:
        nonlocal count
        if isinstance(node, dict):
            if "anyOf" in node:
                count += 1
            if isinstance(node.get("type"), list):
                count += 1

    _walk(tool["input_schema"], tool["name"], visit)
    return count


def lint_tools(tools: list[JsonSchema], forbidden_values: frozenset[str] = frozenset()) -> list[str]:
    """Problems with a request's tool list; empty means it is safe to send."""
    problems: list[str] = []
    strict = sum(1 for t in tools if t.get("strict"))
    if strict > min(MAX_STRICT_TOOLS, MAX_STRICT_PER_REQUEST):
        problems.append(f"{strict} strict tools (> {MAX_STRICT_PER_REQUEST}: the compiled grammar gets too large)")
    unions = sum(union_params(t) for t in tools)
    if unions > MAX_UNION_PARAMS:
        problems.append(f"{unions} union params (> {MAX_UNION_PARAMS})")

    def visit(node: Any, path: str) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "object" or "properties" in node:
            if node.get("additionalProperties") is not False:
                problems.append(f"{path}: additionalProperties must be false")
            if sorted(node.get("required", [])) != sorted(node.get("properties", {})):
                problems.append(f"{path}: every property must be required")
        bad = FORBIDDEN_KEYWORDS & set(node)
        if bad:
            problems.append(f"{path}: numeric/length keywords {sorted(bad)}")
        values = [*node.get("enum", []), *([node["const"]] if "const" in node else [])]
        leaked = [v for v in values if isinstance(v, str) and v in forbidden_values]
        if leaked:
            problems.append(f"{path}: enum/const carries ids or names {leaked}")

    for t in tools:
        if t["name"] in STRICT_TOOLS and not t.get("strict"):
            problems.append(f"{t['name']}: not strict")
        _walk(t["input_schema"], t["name"], visit)
    return problems
