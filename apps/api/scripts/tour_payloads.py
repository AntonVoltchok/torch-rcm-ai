"""Regenerate the onboarding tour's code-pane payloads: apps/web/src/features/tour/payloads/*.txt.

    cd apps/api && uv run python scripts/tour_payloads.py [--out DIR]      (or `make tour-payloads`)

Nothing in a payload is typed by hand. Each file is one of:
- the output of real code (build_case → render_case, ScriptedPlanner / RecordedPlanPlanner → Plan, policy.decide,
  readmodels.wording, routing.route_denial, tools_for, lint_tools) run on the canonical scenario, persisted to a
  throwaway SQLite file in a temp dir (never the developer's torch.db), at the seeded clock (Wed 10:40);
- source text found by symbol (`inspect.getsource`, or an `ast` lookup of a module-level assignment, dict key or
  call), never by line numbers, so an edit above a symbol cannot shift what is shown;
- a repo file read whole (the prompt, the recorded plan, the cassette, two web files).

Output is deterministic: no run time, no temp paths, insertion-ordered JSON. tests/test_tour_payloads.py
regenerates into a temp dir and fails when a committed payload differs (run this script, commit the result).
"""

from __future__ import annotations

import argparse
import ast
import asyncio
import inspect
import json
import re
import shutil
import tempfile
import textwrap
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

from torch_rcm.agents import case as case_mod
from torch_rcm.agents import learning, policy
from torch_rcm.agents import prompts as prompts_mod
from torch_rcm.agents.case import build_case
from torch_rcm.agents.catalog import actions as catalog_actions
from torch_rcm.agents.catalog import recipes as catalog_recipes
from torch_rcm.agents.catalog import situations as situations_mod
from torch_rcm.agents.config import AgentConfig
from torch_rcm.agents.executor import executor as executor_mod
from torch_rcm.agents.llm import client as llm_client
from torch_rcm.agents.llm import models as llm_models
from torch_rcm.agents.planner import live as live_mod
from torch_rcm.agents.planner import scripted as scripted_mod
from torch_rcm.agents.planner.base import EvidenceSet, ReadResult
from torch_rcm.agents.planner.live import Handles, registry_reader, render_case, render_plan, render_read
from torch_rcm.agents.planner.scripted import RecordedPlanPlanner, ScriptedPlanner
from torch_rcm.agents.prompts import PROMPT_DIR, tools_for
from torch_rcm.agents.tools import schemas as schemas_mod
from torch_rcm.agents.tools.adapters import SimWorld, StoreDomain
from torch_rcm.agents.tools.registry import ToolRegistry
from torch_rcm.agents.types import UNKNOWN, AgentKind, CaseFile, Plan, Subject
from torch_rcm.config import Settings
from torch_rcm.domain import routing
from torch_rcm.domain.entities import Claim, Coverage, InboxItem, Practice
from torch_rcm.readmodels import wording
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.runtime import Runtime
from torch_rcm.scheduler.registry import Registry
from torch_rcm.seed.persist import persist, seed_info
from torch_rcm.world.scenarios import build_scenario

API_DIR = Path(__file__).resolve().parents[1]
REPO = API_DIR.parents[1]
WEB_SRC = REPO / "apps" / "web" / "src"
DEFAULT_OUT = WEB_SRC / "features" / "tour" / "payloads"
REGEN = "make tour-payloads   (= cd apps/api && uv run python scripts/tour_payloads.py)"
MAX_LINES = 220

SCENARIO = "canonical"
AGENT: AgentKind = "followup"
CLAIM_PA = "clm_4821"
CLAIM_UNKNOWN = "clm_4744"
ITEM_PA = "itm_4821"
RESUBMIT = "resubmit_with_attachment"
RECORDED_PLAN = scripted_mod.RECORDED_DIR / f"{CLAIM_UNKNOWN}.plan.json"
CASSETTE_DIR = API_DIR / "cassettes" / "canonical"
SYNTHETIC_LABEL = "hand-authored in the live wire format (synthetic: true), not a captured API response"


# ---------------------------------------------------------------- formatting and source lookup


def rel(path: Path) -> str:
    return path.resolve().relative_to(REPO).as_posix()


def where(mod: ModuleType) -> str:
    return rel(Path(inspect.getfile(mod)))


def fmt_json(value: Any, indent: int = 0) -> str:
    """json.dumps(indent=2), except that scalar arrays and small flat objects stay on one line (short panes).
    Key order is the value's own (pydantic field order, file order), so the output is stable."""
    pad, inner = "  " * indent, "  " * (indent + 1)
    flat = json.dumps(value, ensure_ascii=False, separators=(", ", ": "))
    if isinstance(value, dict):
        if not value:
            return "{}"
        if all(not isinstance(v, dict | list) for v in value.values()) and len(flat) <= 60:
            return flat
        body = ",\n".join(
            f"{inner}{json.dumps(k, ensure_ascii=False)}: {fmt_json(v, indent + 1)}" for k, v in value.items()
        )
        return "{\n" + body + "\n" + pad + "}"
    if isinstance(value, list):
        if not value:
            return "[]"
        if all(not isinstance(v, dict | list) for v in value):
            return flat
        return "[\n" + ",\n".join(inner + fmt_json(v, indent + 1) for v in value) + "\n" + pad + "]"
    return json.dumps(value, ensure_ascii=False)


def source(obj: Any) -> str:
    return textwrap.dedent(inspect.getsource(obj)).rstrip()


def _module_lines(mod: ModuleType) -> tuple[ast.Module, list[str]]:
    text = inspect.getsource(mod)
    return ast.parse(text), text.splitlines()


def _assignment(tree: ast.Module, name: str) -> ast.Assign | ast.AnnAssign:
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return node
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == name:
            return node
    raise LookupError(f"no module-level assignment named {name}")


def _lines(lines: list[str], first: ast.AST, last: ast.AST) -> str:
    end = getattr(last, "end_lineno", None) or getattr(last, "lineno", 0)
    return textwrap.dedent("\n".join(lines[getattr(first, "lineno", 1) - 1 : end])).rstrip()


def assignment_source(mod: ModuleType, name: str) -> str:
    """The source of a module-level `NAME = …` or `NAME: T = …`, found by name."""
    tree, lines = _module_lines(mod)
    node = _assignment(tree, name)
    return _lines(lines, node, node)


def dict_entry_source(mod: ModuleType, dict_name: str, key: str) -> str:
    """The `"key": value,` entry of a module-level dict literal, found by key."""
    tree, lines = _module_lines(mod)
    value = _assignment(tree, dict_name).value
    if not isinstance(value, ast.Dict):
        raise LookupError(f"{dict_name} is not a dict literal")
    for k, v in zip(value.keys, value.values, strict=True):
        if isinstance(k, ast.Constant) and k.value == key:
            return _lines(lines, k, v)
    raise LookupError(f"{dict_name} has no key {key!r}")


def call_source(mod: ModuleType, container: str, func: str, first_arg: str) -> str:
    """Inside the module-level assignment `container`, the call `func("first_arg", …)`, found by its first arg."""
    tree, lines = _module_lines(mod)
    for node in ast.walk(_assignment(tree, container)):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == func
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and node.args[0].value == first_arg
        ):
            return _lines(lines, node, node)
    raise LookupError(f"no {func}({first_arg!r}, …) in {container}")


def _is_heading(lines: list[str], j: int) -> bool:
    s = lines[j].strip()
    return bool(s) and s[0].isalpha() and s == s.upper() and (j == 0 or not lines[j - 1].strip())


def skip_sections(text: str, skip: dict[str, str]) -> str:
    """Drop the named sections of a prompt (a heading is an all-caps line after a blank line), leaving a marker."""
    lines = text.rstrip("\n").splitlines()
    out: list[str] = []
    found: set[str] = set()
    i = 0
    while i < len(lines):
        name = lines[i].strip()
        if not (_is_heading(lines, i) and name in skip):
            out.append(lines[i])
            i += 1
            continue
        found.add(name)
        j = i + 1
        while j < len(lines) and not _is_heading(lines, j):
            j += 1
        out.append(f"# … {name} section skipped ({j - i} lines): {skip[name]}")
        i = j
    if missing := sorted(set(skip) - found):
        raise LookupError(f"prompt has no section(s) {missing}")
    return "\n".join(out).rstrip()


def head(title: str, sources: list[str], ran: str | None = None, notes: tuple[str, ...] = ()) -> list[str]:
    """The `# ` block every payload starts with: what it is, where it came from, how to regenerate it."""
    lines = [f"# {title}", *(f"# source: {s}" for s in sources)]
    if ran:
        lines.append(f"# ran against: {ran}")
    lines += [f"# {n}" for n in notes]
    lines += [
        f"# regenerate: {REGEN}",
        "# generated, never hand-edited; apps/api/tests/test_tour_payloads.py fails on drift",
        "",
    ]
    return lines


def section(title: str) -> str:
    return f"\n# --- {title} ---"


# ---------------------------------------------------------------- the world


@dataclass
class World:
    rt: Runtime
    dom: StoreDomain
    tools: ToolRegistry
    ran: str  # the "ran against" line of every runtime-derived payload

    def case(self, claim_id: str) -> CaseFile:
        return build_case(
            self.dom,
            run_id=f"run_{claim_id.removeprefix('clm_')}",
            agent=AGENT,
            subject=Subject(kind="claim", id=claim_id),
            now=self.rt.clock.now(),
        )

    def plan(self, case: CaseFile) -> tuple[Plan, EvidenceSet, str]:
        """The planner executor.Executor._planner picks for a deterministic triage, reading through the Reader
        `torch cassette record` uses (planner/live.py registry_reader: the scope-checked ToolRegistry)."""
        evidence = EvidenceSet(case.evidence)
        recorded = case.classifier_situation == UNKNOWN and RecordedPlanPlanner().can_plan(case)
        planner = RecordedPlanPlanner() if recorded else ScriptedPlanner()
        plan = asyncio.run(planner.plan(case, registry_reader(self.tools, case, run_id=case.run_id), evidence))
        return plan, evidence, type(planner).__name__

    def policy_ctx(self, case: CaseFile, plan: Plan, evidence: EvidenceSet) -> policy.PolicyCtx:
        """The PolicyCtx executor.Executor._policy_ctx builds for a triage run (no actor, no draft text)."""
        claim = case.claim
        practice = self.rt.store.all(Practice)[0]
        needs_window = any(
            (s := catalog_actions.spec_for(a.action)) is not None and s.needs_hold_window for a in plan.actions
        )
        return policy.PolicyCtx(
            agent=case.agent,
            run_kind="triage",
            paused=practice.agents_paused,
            classifier_situation=case.classifier_situation,
            model_situation=plan.situation_key if plan.planner == "live" else None,
            root_cause=case.root_cause,
            payer_key=claim.payer_key if claim else (case.payer.key if case.payer else None),
            item_type=case.item_type,
            cents=case.cents,
            scope_ids=case.subject_ids,
            evidence=evidence.by_id(),
            expected_values=case.expected_values,
            paper_eob=case.paper_eob,
            hold_window_open=self.dom.hold_window_open(claim.id) if (claim and needs_window) else None,
            rules=case.rules_snapshot,
            practice_cap_cents=practice.practice_cap_cents,
        )


def _settings(db: Path) -> Settings:
    # Explicit values and no .env file: the developer's TORCH_* environment cannot change a payload.
    return Settings(_env_file=None, db_url=f"sqlite:///{db}", agent_mode="deterministic", scenario=SCENARIO)


def seed_template(tmp: Path) -> Path:
    """The canonical scenario persisted once (as tests/conftest.py's template_db is); each payload gets a copy."""
    path = tmp / "template.db"
    rt = Runtime.open(_settings(path), reg=Registry())
    persist(rt.store, build_scenario(SCENARIO))
    rt.store.conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    rt.store.close()
    return path


@contextmanager
def seeded_world(template: Path, name: str) -> Iterator[World]:
    db = template.with_name(f"{name}.db")
    shutil.copy(template, db)
    settings = _settings(db)
    rt = Runtime.open(settings, reg=Registry())
    try:
        sim = SimWorld(rt.world)
        info = seed_info(rt.store) or {}
        ran = (
            f"scenario {SCENARIO} (world/scenarios.py build_scenario, seed {info.get('seed', settings.seed)})"
            f" in a throwaway SQLite DB; clock {rt.clock.now():%a %Y-%m-%d %H:%M %z} (as seeded, not advanced);"
            " TORCH_AGENT_MODE=deterministic"
        )
        yield World(rt=rt, dom=StoreDomain(rt.store, sim), tools=ToolRegistry(sim), ran=ran)
    finally:
        rt.store.close()


async def _awaited(read: Awaitable[ReadResult]) -> ReadResult:
    return await read


def cassette(name: str) -> tuple[Path, dict[str, Any], list[dict[str, Any]]]:
    path = CASSETTE_DIR / f"{name}.jsonl"
    records = [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    header = next(r for r in records if r.get("type") == "header")
    calls = sorted((r for r in records if r.get("type") == "call"), key=lambda r: int(r["seq"]))
    return path, header, calls


def live_note(situation: str) -> str:
    live = AgentConfig(agent_mode="live").is_live_for(AGENT) and situations_mod.is_judgment(AGENT, situation)
    return (
        f"live mode (TORCH_AGENT_MODE=live) {'hands this case to the model' if live else 'keeps this case scripted'}:"
        f" executor.Executor._planner, situations.is_judgment('{AGENT}', '{situation}') ="
        f" {situations_mod.is_judgment(AGENT, situation)}"
    )


# ---------------------------------------------------------------- the payloads


def prompt_4821(w: World) -> str:
    case = w.case(CLAIM_PA)
    handles = Handles(list(case.evidence))
    prompt_file = PROMPT_DIR / f"{AGENT}.md"
    prompt = skip_sections(
        prompt_file.read_text(encoding="utf-8"),
        {"DRAFTING": f"it applies only to the drafting conversation (tools_for('{AGENT}', 'draft'))"},
    )
    path, header, _ = cassette(f"{CLAIM_PA}_group")
    notes = [
        f"deterministic mode (the default) sends nothing: the classifier names {case.classifier_situation}, so"
        " ScriptedPlanner plans this claim (plan_4821.txt).",
        live_note(case.classifier_situation),
    ]
    if header.get("synthetic"):
        notes.append(f"its canonical live turns, {rel(path)}, are {SYNTHETIC_LABEL}.")
    out = head(
        f"What a live Follow-up plan conversation for #{CLAIM_PA[4:]} sends: system prompt, first user message",
        [
            f"{rel(prompt_file)} (verbatim; the one cached system block, {where(llm_client)} system_blocks)",
            f"{where(case_mod)} build_case → {where(live_mod)} render_case(case, Handles(case.evidence))",
        ],
        w.ran,
        tuple(notes),
    )
    out += ["# --- system prompt ---", prompt, section("first user message: render_case"), render_case(case, handles)]
    out.append(section("evidence handles: the model sees E-numbers; the run and the Inbox store ids (live.py Handles)"))
    out += [f"# {h} → {ev.id}   ({ev.kind}, source {ev.source})" for h, ev in handles.by_handle.items()]
    return "\n".join(out)


def plan_4821(w: World) -> str:
    case = w.case(CLAIM_PA)
    plan, evidence, planner = w.plan(case)
    handles = Handles(list(evidence.items))
    on_file = {e.id for e in case.evidence}
    out = head(
        f"The plan for #{CLAIM_PA[4:]}: Plan.model_dump(mode='json'), render_plan, and the submit_plan schema",
        [
            f"{where(scripted_mod)} {planner}.plan(case, reader, EvidenceSet(case.evidence))",
            f"{where(live_mod)} render_plan(plan, Handles(evidence.items))",
            f"{where(schemas_mod)} submit_plan_tool, via {where(prompts_mod)} tools_for('{AGENT}', 'plan')",
        ],
        w.ran,
        (
            f"planner: {planner}, the script for {AGENT} {plan.situation_key}; no model call.",
            f"reads go through the scope-checked ToolRegistry via {where(live_mod)} registry_reader (run_id"
            f" {case.run_id}); evidence ids are ev_ + sha256(run_id:seq:i)[:10].",
            live_note(case.classifier_situation),
        ),
    )
    out.append(fmt_json(plan.model_dump(mode="json")))
    out += [section("render_plan: the same plan as model-facing text"), render_plan(plan, handles)]
    # DECISIONS.md D8: the plan's own read built evidence for an image the seeded Inbox item already cites.
    item = w.rt.store.require(InboxItem, ITEM_PA)
    cited = set(plan.actions[0].evidence_ids) if plan.actions else set()
    out.append(section(f"evidence ids: this run's read vs the seeded Inbox item {ITEM_PA}"))
    for e in (e for e in evidence.items if e.id not in on_file):
        out.append(
            f"# {e.id} = {handles.handle(e.id)}: built by this plan's read ({e.kind}, reference {e.reference})"
            + ("; the plan cites it" if e.id in cited else "")
        )
        for s in case.evidence:
            if s.id in item.evidence and s.kind == e.kind and s.reference and s.reference == e.reference:
                out.append(
                    f"# {ITEM_PA} cites {s.id} (= {handles.handle(s.id)} in prompt_4821.txt) for the same reference;"
                    " each run's read gets its own id."
                )
    sp = json.loads(json.dumps(next(t for t in tools_for(AGENT, "plan") if t["name"] == "submit_plan")))
    variants = sp["input_schema"]["properties"]["actions"]["items"]["anyOf"]
    keep = [v for v in variants if v["properties"]["action"]["const"] == RESUBMIT]
    dropped = [v["properties"]["action"]["const"] for v in variants if v not in keep]
    sp["input_schema"]["properties"]["actions"]["items"]["anyOf"] = [*keep, "@@TRIM@@"]
    trimmed = fmt_json(sp).replace(
        '"@@TRIM@@"', f"# … {len(dropped)} more action variants, same shape: {', '.join(dropped)}"
    )
    out += [section(f"the terminal tool, called alone (strict; the {RESUBMIT} variant shown)"), trimmed]
    return "\n".join(out)


def tools_txt(w: World) -> str:
    tools = tools_for(AGENT, "plan")
    by = {t["name"]: t for t in tools}
    out = head(
        "The Follow-up plan conversation's tools: the request's `tools` array",
        [f"{where(prompts_mod)} tools_for('{AGENT}', 'plan') → {where(schemas_mod)} plan_tools, lint_tools"],
        notes=("JSON as json.dumps(indent=2), except that scalar arrays and small flat objects sit on one line",),
    )
    for i, t in enumerate(tools, 1):
        role = "terminal" if t["name"] in schemas_mod.TERMINAL_TOOLS else "read"
        out.append(f"# {i}. {t['name']}  strict={json.dumps(t.get('strict'))}  ({role})")
    out.append(f"# lint_tools(tools) -> {schemas_mod.lint_tools(tools)!r}   (strict-mode limits; no PHI in enum/const)")
    out.append(f"# tools_sha_for('{AGENT}', 'plan') = {prompts_mod.tools_sha_for(AGENT, 'plan')}")
    for name in ("pms_find_images", "claim_get_history"):
        out += [section(f"read tool: {name}"), fmt_json(by[name])]
    return "\n".join(out)


def policy_txt(w: World) -> str:
    out = head(
        "The decision table: the first matching row decides; the model's plan is only an input",
        [
            f"{where(policy)} ROWS (ast lookup by name); _row10, guard_root_cause_ours (inspect.getsource)",
            f"{where(policy)} decide(ctx, plan.actions[0]) on the real plans, ctx built as"
            f" {where(executor_mod)} Executor._policy_ctx builds it for a triage run",
        ],
        w.ran,
    )
    out += [assignment_source(policy, "ROWS"), section("row 10's predicate"), source(policy._row10)]
    out += [section("the one guard learning goes through"), source(policy.guard_root_cause_ours)]
    for claim_id in (CLAIM_PA, CLAIM_UNKNOWN):
        case = w.case(claim_id)
        plan, evidence, planner = w.plan(case)
        action = plan.actions[0]
        d = policy.decide(w.policy_ctx(case, plan, evidence), action)
        row = next(r for r in policy.ROWS if r.number == d.policy_row)
        out.append(
            section(f"decide() for #{claim_id[4:]} {action.action} ({planner}; situation {case.classifier_situation})")
        )
        out.append(f'# matched row {row.number} "{row.condition}" → {row.verdict} (root cause {case.root_cause})')
        out.append(fmt_json(d.model_dump(mode="json")))
    return "\n".join(out)


GUARD_TOKENS = (
    "guard_root_cause_ours",
    "guard_causes",
    "assert_learnable",
    "RootCauseGuardError",
    "root_cause_guard",
    "acceptable(",
    'root_cause="ours"',
)


def guard_tests() -> list[str]:
    """Test functions under apps/api/tests whose body calls the guard or asserts on its refusal (ast + text)."""
    found: list[str] = []
    for path in sorted((API_DIR / "tests").rglob("test_*.py")):
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        for node in ast.parse(text).body:
            if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name.startswith("test_"):
                body = "\n".join(lines[node.lineno - 1 : node.end_lineno])
                hits = [t.rstrip("(") for t in GUARD_TOKENS if t in body]
                if hits:
                    found.append(f"{path.relative_to(API_DIR).as_posix()}::{node.name}   ({', '.join(hits)})")
    return found


def guard_txt(w: World) -> str:
    out = head(
        "Root cause `ours` can never be learned into auto-run: one guard, and the learning code that calls it",
        [
            f"{where(policy)} guard_root_cause_ours, guard_causes (inspect.getsource)",
            f"{where(learning)} acceptable, assert_learnable (inspect.getsource)",
            f"apps/api/tests/**/test_*.py: test functions whose body uses one of {', '.join(GUARD_TOKENS)}",
        ],
    )
    out += [source(policy.guard_root_cause_ours), "", source(policy.guard_causes)]
    out += [section(where(learning)), source(learning.acceptable), "", source(learning.assert_learnable)]
    out += [section("tests that pin it (what each one uses)"), *(f"# {t}" for t in guard_tests())]
    return "\n".join(out)


def recipe_resubmit(w: World) -> str:
    spec = catalog_actions.ACTIONS[RESUBMIT]
    approved = executor_mod.ApprovedPlanPlanner
    snap = Snapshot.from_store(w.rt.store, w.rt.clock.now())
    item = w.rt.store.require(InboxItem, ITEM_PA)
    out = head(
        f"What approving {ITEM_PA} runs: the catalog recipe for {RESUBMIT}, its ActionSpec, and the item's sentences",
        [
            f"{where(catalog_recipes)} RECIPES[{RESUBMIT!r}] (ast lookup by key) and _queue (inspect.getsource)",
            f"{where(catalog_actions)} ACTIONS: the _spec({RESUBMIT!r}, …) call (ast), {spec.params.__name__}",
            f"{where(wording)} action_label, item_touches, lands, signer_note on the seeded item",
            f"{where(executor_mod)} {approved.__name__} docstring",
        ],
        w.ran,
    )
    out.append(
        f"# Approval runs replay the approved plan ({approved.__name__}): no model call in deterministic or live mode."
    )
    out += [f"#   {ln}" for ln in (inspect.getdoc(approved) or "").splitlines()]
    out.append("")
    out.append(dict_entry_source(catalog_recipes, "RECIPES", RESUBMIT))
    out += [section("_queue, the recipe's last step"), source(catalog_recipes._queue)]
    out += [section("ActionSpec"), call_source(catalog_actions, "ACTIONS", "_spec", RESUBMIT), "", source(spec.params)]
    fields = ", ".join(f"{k}={v.__name__ if isinstance(v, type) else repr(v)}" for k, v in spec.model_dump().items())
    out.append(f"# ACTIONS[{RESUBMIT!r}] = ActionSpec({fields})")
    out.append(section(f"{where(wording)} on {ITEM_PA} (snapshot at {w.rt.clock.now():%Y-%m-%d %H:%M})"))
    out.append(f"action_label(snap, {ITEM_PA})  -> {json.dumps(wording.action_label(snap, item), ensure_ascii=False)}")
    out.append(
        f"item_touches(snap, [{ITEM_PA}]) -> {json.dumps(wording.item_touches(snap, [item]), ensure_ascii=False)}"
    )
    out.append(f"lands(snap, {ITEM_PA})         -> {wording.lands(snap, item)!s}")
    for user_id in sorted(snap.users):
        note = wording.signer_note(snap, item, user_id)
        out.append(f"signer_note(snap, {ITEM_PA}, {user_id!r}) -> {json.dumps(note, ensure_ascii=False)}")
    return "\n".join(out)


def case_4744(w: World) -> str:
    case = w.case(CLAIM_UNKNOWN)
    out = head(
        f"#{CLAIM_UNKNOWN[4:]}: the first user message of a live Follow-up plan conversation",
        [f"{where(case_mod)} build_case → {where(live_mod)} render_case(case, Handles(case.evidence))"],
        w.ran,
        (
            f"classifier situation {case.classifier_situation}; {live_note(case.classifier_situation)}",
            "deterministic mode replays the reviewed recorded plan instead (plan_4744.txt).",
        ),
    )
    out.append(render_case(case, Handles(list(case.evidence))))
    return "\n".join(out)


def plan_4744(w: World) -> str:
    case = w.case(CLAIM_UNKNOWN)
    plan, evidence, planner = w.plan(case)
    path, header, calls = cassette(CLAIM_UNKNOWN)
    key = header.get("key", {})
    recorded = json.loads(RECORDED_PLAN.read_text(encoding="utf-8"))
    label = SYNTHETIC_LABEL if header.get("synthetic") else "captured by `torch cassette record` (synthetic: false)"
    same_system = key.get("system_sha") == prompts_mod.system_sha(AGENT)
    same_tools = key.get("tools_sha") == prompts_mod.tools_sha_for(AGENT, "plan")
    notes = [
        f"cassette key system_sha == prompts.system_sha('{AGENT}') today: {same_system};"
        f" tools_sha == tools_sha_for('{AGENT}', 'plan'): {same_tools}",
    ]
    named = re.search(r"cassettes/\S+?\.jsonl", str(recorded.get("recorded_from", "")))
    if named and not (API_DIR / named.group(0)).exists():
        notes.append(
            f"the plan file's recorded_from names {named.group(0)}, which does not exist; the cassette is {rel(path)}"
        )
    if header.get("synthetic"):
        notes.append(
            "its recorded_from says 'live triage', but the turns it reproduces are the synthetic cassette below"
        )
    out = [f"# HONEST LABEL: the cassette turns below are {label}."]
    out += head(
        f"#{CLAIM_UNKNOWN[4:]}: the reviewed plan deterministic mode replays, and the live-format turns it reproduces",
        [
            f"{rel(RECORDED_PLAN)} (verbatim; {planner} in {where(scripted_mod)} replays it)",
            f"{rel(path)} (header, then each call's response.content)",
            f"{where(live_mod)} render_read for each read on the seed, render_plan for the replayed Plan",
        ],
        w.ran,
        tuple(notes),
    )
    out += ["# --- recorded plan (verbatim file) ---", RECORDED_PLAN.read_text(encoding="utf-8").rstrip()]
    out += [section("cassette header"), fmt_json({k: header[k] for k in sorted(header) if k != "key"})]
    reader = registry_reader(w.tools, case, run_id=f"{case.run_id}_live")
    handles = Handles(list(case.evidence))
    for call in calls:
        resp = call["response"]
        out.append(
            section(
                f"cassette call seq {call['seq']} ({call['purpose']}): assistant turn,"
                f" stop_reason {resp.get('stop_reason')}"
            )
        )
        out.append(fmt_json(resp["content"]))
        for use in resp["content"]:
            if use.get("type") == "tool_use" and use.get("name") not in schemas_mod.TERMINAL_TOOLS:
                res = asyncio.run(_awaited(reader(use["name"], dict(use["input"]))))
                out += [
                    f"# tool_result for {use['id']}, as render_read renders it on the seed:",
                    render_read(res, handles),
                ]
    out += [section(f"render_plan for the replayed Plan ({planner})"), render_plan(plan, Handles(list(evidence.items)))]
    return "\n".join(out)


def models_txt(w: World) -> str:
    out = head(
        "The model capability table, and the exact Messages API body a live run sends (5.5 models)",
        [
            f"{where(llm_models)} SAMPLING_PARAMS, CAPABILITIES (ast lookup by name)",
            f"{where(llm_client)} EPHEMERAL (ast lookup), system_blocks and build_request (inspect.getsource)",
        ],
    )
    out += [assignment_source(llm_models, "SAMPLING_PARAMS"), "", assignment_source(llm_models, "CAPABILITIES")]
    out += [section(where(llm_client)), assignment_source(llm_client, "EPHEMERAL"), ""]
    out += [source(llm_client.system_blocks), "", source(llm_client.build_request)]
    return "\n".join(out)


def router_txt(w: World) -> str:
    claim = w.rt.store.require(Claim, CLAIM_PA)
    if claim.denial is None:
        raise LookupError(f"{CLAIM_PA} has no denial in the seed")
    cov = w.rt.store.require(Coverage, claim.coverage_id)
    d = claim.denial
    route = routing.route_denial(
        d.carc, d.rarc, root_cause=d.root_cause, payer=claim.payer_key, self_funded=cov.self_funded
    )
    out = head(
        "CARC·RARC → next action → agent: one function, shared by the Denials worklist and the agents",
        [
            f"{where(routing)} route_denial (inspect.getsource)",
            f"called the way api/services/screens.py (the Denials worklist) calls it, with {CLAIM_PA}'s stored denial",
        ],
        w.ran,
    )
    out += [source(routing.route_denial), section(f"route_denial on {CLAIM_PA}")]
    out.append(
        f"route_denial({d.carc!r}, {d.rarc!r}, root_cause={d.root_cause.value!r}, payer={claim.payer_key.value!r},"
        f" self_funded={cov.self_funded!r})"
    )
    result = {
        "next_action": route.next_action.value,
        "agent": route.agent.value,
        "why": route.why,
        "signer_role": route.signer_role,
        "checklist": list(route.checklist),
    }
    out.append("-> " + fmt_json(result))
    return "\n".join(out)


def mockonly_txt(w: World) -> str:
    banner = WEB_SRC / "components" / "MockOnlyBanner.tsx"
    nav = WEB_SRC / "features" / "shell" / "nav.ts"
    rows = [ln.strip() for ln in nav.read_text(encoding="utf-8").splitlines() if re.search(r"status:\s*'mock'", ln)]
    out = head(
        "Mock-only routes: the banner, and the nav entries whose status is 'mock'",
        [f"{rel(banner)} (verbatim)", f"{rel(nav)}: the NAV rows with status 'mock' (verbatim lines)"],
    )
    out += [banner.read_text(encoding="utf-8").rstrip(), section(f"{rel(nav)}: status 'mock'"), *rows]
    return "\n".join(out)


def search_txt(w: World) -> str:
    path = WEB_SRC / "features" / "claims" / "search.ts"
    out = head("The URL is the source of truth for filters, sort, selection and tabs", [f"{rel(path)} (verbatim)"])
    out.append(path.read_text(encoding="utf-8").rstrip())
    return "\n".join(out)


PAYLOADS: dict[str, Callable[[World], str]] = {
    "prompt_4821.txt": prompt_4821,
    "plan_4821.txt": plan_4821,
    "tools.txt": tools_txt,
    "policy.txt": policy_txt,
    "guard.txt": guard_txt,
    "recipe_resubmit.txt": recipe_resubmit,
    "case_4744.txt": case_4744,
    "plan_4744.txt": plan_4744,
    "models.txt": models_txt,
    "router.txt": router_txt,
    "mockonly.txt": mockonly_txt,
    "search.txt": search_txt,
}


def generate() -> dict[str, str]:
    """name → file text. The scenario is seeded once; each payload runs on its own copy, so no payload sees
    another's reads."""
    out: dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="tour_payloads_") as tmp:
        template = seed_template(Path(tmp))
        for name, build in PAYLOADS.items():
            with seeded_world(template, Path(name).stem) as w:
                out[name] = build(w).rstrip("\n") + "\n"
            if tmp in out[name] or Path(tmp).resolve().as_posix() in out[name]:
                raise ValueError(f"{name} leaks a temp path")
    for name, text in out.items():
        if (n := text.count("\n")) > MAX_LINES:
            raise ValueError(f"{name} is {n} lines (> {MAX_LINES}); elide more in scripts/tour_payloads.py")
    return out


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Regenerate the onboarding tour's code-pane payloads.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="directory to write (default: %(default)s)")
    out: Path = parser.parse_args(argv).out
    out.mkdir(parents=True, exist_ok=True)
    for name, text in generate().items():
        (out / name).write_text(text, encoding="utf-8")
        print(f"{text.count(chr(10)):4d} lines  {name}")


if __name__ == "__main__":
    main()
