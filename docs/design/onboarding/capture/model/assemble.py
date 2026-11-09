import json, re
from pathlib import Path
R = Path("/Users/antonvolt/Desktop/code/torch-rcm-ai/.claude/worktrees/onboarding-tour-mock-405198/apps/api")
OUT = Path(__import__("os").environ["MODEL_OUT"])
def src(path, a, b):
    return "\n".join(Path(R/path).read_text().splitlines()[a-1:b])
def w(name, text): (OUT/name).write_text(text.rstrip("\n")+"\n"); print(name, len(text.splitlines()))
GAP = lambda s: f"# … {s}"

# 1 system prompt
p = "torch_rcm/agents/prompts/followup.md"
w("system_followup.txt", "\n".join([
 "# torch_rcm/agents/prompts/followup.md (system prompt, role=exec; sent as the single cached system block by agents/llm/client.py:system_blocks)",
 src(p,1,3), src(p,4,15), GAP("SITUATIONS (lines 17-25) skipped"), src(p,27,43), GAP("TIERS and EVIDENCE (lines 45-55) skipped"),
 src(p,57,67), GAP("DRAFTING (lines 69-73) skipped; that section applies only to the drafting conversation"),
]))

# 2/3 case facts
hdr = "# torch_rcm.agents.planner.live.render_case(case, Handles(case.evidence)) — first user message of the plan conversation; built by agents.case.build_case; seeded canonical DB at 2026-10-28 10:40 -04:00"
def trimcase(raw, note):
    return hdr + note + "\n" + raw
c21 = (OUT/"raw_case_4821.txt").read_text()
c44 = (OUT/"raw_case_4744.txt").read_text()
w("case_4821.txt", hdr + " (clm_4821)\n" + c21)
w("case_4744.txt", hdr + " (clm_4744; no evidence is on file for this claim, the model gathers it with read tools)\n" + c44)


# 4 tools
def load(n): return json.loads((OUT/f"raw_tool_{n}.json").read_text())
def dump(o):
    t = json.dumps(o, indent=2)
    pat = re.compile(r'\[\n\s+((?:"[^"\n]*"(?:,\n\s+)?)+)\n\s+\]')
    return pat.sub(lambda m: "[" + re.sub(r',\n\s+', ", ", m.group(1)) + "]", t)
sp = load("submit_plan")
anyof = sp["input_schema"]["properties"]["actions"]["items"]["anyOf"]
keep = [v for v in anyof if v["properties"]["action"]["const"] in ("resubmit_with_attachment",)]
dropped = [v["properties"]["action"]["const"] for v in anyof if v not in keep]
sp["input_schema"]["properties"]["actions"]["items"]["anyOf"] = keep + ["@@TRIM@@"]
sp_txt = dump(sp).replace('"@@TRIM@@"', "# … %d more action variants omitted, same shape: %s" % (len(dropped), ", ".join(dropped)))
parts = [
 "# torch_rcm/agents/tools/schemas.py: plan_tools('followup') == prompts.tools_for('followup','plan'); the `tools` array of the request (json.dumps indent=2, scalar arrays collapsed)",
 "# 7 tools, in order: pms_get_visit, pms_find_images, pms_get_coverage, payer_rulebook_lookup, claim_get_history, submit_plan, submit_result",
 "# all have \"strict\": true; lint_tools() returns []. Enums are closed vocabularies (situation keys, action names, channels, payer keys); no patient/claim/visit value is in any enum/const, ids are free strings.",
 "",
 "# --- read tool: pms_get_visit ---", dump(load("pms_get_visit")),
 "# --- read tool: claim_get_history ---", dump(load("claim_get_history")),
 "# --- terminal tool: submit_plan (trimmed: 1 of 7 action variants shown) ---", sp_txt,
]
w("tools_schemas.txt", "\n".join(parts))

# 5 plan 4744 : recorded file + cassette turns + render_plan
rec = json.loads((R/"torch_rcm/agents/planner/recorded/clm_4744.plan.json").read_text())
cas = [json.loads(l) for l in (R/"cassettes/canonical/clm_4744.jsonl").read_text().splitlines()]
def pj(o): return dump(o)
reads = (OUT/"raw_reads_4744.txt").read_text()
parts = [
 "# torch_rcm/agents/planner/recorded/clm_4744.plan.json (reviewed plan replayed by RecordedPlanPlanner) + the cassette turns it was recorded from + live.render_plan()",
 "# NOTE: cassettes/canonical/clm_4744.jsonl is HAND-AUTHORED (header: synthetic: true), not output captured from the Anthropic API.",
 "",
 "# --- recorded/clm_4744.plan.json (verbatim file) ---",
 (R/"torch_rcm/agents/planner/recorded/clm_4744.plan.json").read_text().rstrip(),
 "",
 "# --- cassette header (cassettes/canonical/clm_4744.jsonl line 1) ---",
 pj({k: cas[0][k] for k in ("type","name","synthetic","note","recorded_at")}),
 "",
 "# --- cassette turn 0: assistant response (seq 0) ---",
 pj(cas[1]["response"]["content"]),
 "",
 "# --- tool_result the model gets back for those reads (live.render_read, case at 2026-10-28 10:40) ---",
 reads,
 "",
 "# --- cassette turn 1: assistant response (seq 1), ends the plan conversation with submit_plan ---",
 pj(cas[2]["response"]["content"]),
 "",
 "# --- live.render_plan(plan, handles) for the replayed Plan ---",
 (OUT/"raw_renderplan_4744.txt").read_text().rstrip(),
]
w("plan_4744.txt", "\n".join(parts))

# 6 plan 4821
parts = [
 "# ScriptedPlanner.plan(case, reader, evidence) -> Plan (torch_rcm/agents/planner/scripted.py; the situation classifier named denied:CO-16:N29:pa_missing so no model is called in deterministic mode). Plan.model_dump(mode='json')",
 "# clm_4821 at 2026-10-28 10:40; the one read (pms_find_images) went through the real scope-checked ToolRegistry. ev_run_4821_1 is the PMS image evidence that read produced.",
 (OUT/"raw_plan_4821.json").read_text().rstrip(),
 "",
 "# live.render_plan(plan, handles) for the same Plan, as the live loop would echo it",
 (OUT/"raw_renderplan_4821.txt").read_text().rstrip(),
]
w("plan_4821.txt", "\n".join(parts))

# 7 policy rows
dec = (OUT/"raw_decision_4821.json").read_text().rstrip()
dec44 = (OUT/"raw_decision_4744.json").read_text().rstrip()
parts = [
 "# torch_rcm/agents/policy.py: ROWS (decision table, first matching row decides), _row10, guard_root_cause_ours, then decide() run on the real Plans",
 src("torch_rcm/agents/policy.py", 341, 376),
 "",
 GAP("predicate for row 10, same file"),
 src("torch_rcm/agents/policy.py", 296, 297),
 "",
 GAP("guard for root cause `ours`, same file"),
 src("torch_rcm/agents/policy.py", 472, 475),
 "",
 "# decide(policy_ctx_for(case, evidence), plan.actions[0]) for clm_4821 resubmit_with_attachment (Decision.model_dump(mode='json'))",
 "# row 8 matched before row 10 because the seeded Delta PA rule is mode `ask`; row 10 would also stop it (root cause: ours).",
 dec,
 "",
 "# same call for clm_4744 records_request (classifier situation `unknown`)",
 dec44,
]
w("policy_rows.txt", "\n".join(parts))

# 8 recipes + wording
wd = json.loads((OUT/"raw_wording_4821.json").read_text())
parts = [
 "# torch_rcm/agents/catalog/recipes.py RECIPES[...] (verbatim), actions.py ActionSpec, readmodels/wording.py outputs for itm_4821",
 src("torch_rcm/agents/catalog/recipes.py", 254, 285),
 src("torch_rcm/agents/catalog/recipes.py", 286, 301),
 "",
 "# actions.py ActionSpec entries (verbatim)",
 src("torch_rcm/agents/catalog/actions.py", 153, 161),
 "",
 "# phrases.py (verbatim): the button for resubmit_with_attachment",
 src("torch_rcm/agents/catalog/phrases.py", 51, 53),
 "    ...",
 src("torch_rcm/agents/catalog/phrases.py", 84, 84),
 "",
 "# readmodels/wording.py functions, called on the seeded item itm_4821 (snapshot at 2026-10-28 10:40):",
 "action_label(snap, itm_4821)  -> " + json.dumps(wd["action_label"]),
 "item_touches(snap, [itm_4821]) -> " + json.dumps(wd["touches"]),
 "lands(snap, itm_4821)         -> " + json.dumps(wd["lands"]) + "   # MoveWho.AGENTS: the filing action puts the move back with the agents",
 "signer_note(snap, itm_4821, viewer) -> None for usr_dana and usr_morgan   # no other signer needed",
]
w("recipes.txt", "\n".join(parts))

# 9 learning guard
parts = [
 "# torch_rcm/agents/policy.py:guard_root_cause_ours / guard_causes and torch_rcm/agents/learning.py:acceptable / assert_learnable (verbatim)",
 src("torch_rcm/agents/policy.py", 472, 483),
 "",
 GAP("torch_rcm/agents/learning.py"),
 src("torch_rcm/agents/learning.py", 80, 90),
 GAP("assert_learnable, same file"),
 src("torch_rcm/agents/learning.py", 97, 99),
 "",
 "# guarded by tests (names):",
 "#   tests/agents/test_policy_table.py::test_root_cause_ours_guard",
 "#   tests/agents/test_policy_table.py::test_row10_root_cause_ours_blocks_auto",
 "#   tests/agents/test_learning.py::test_ours_is_eligible_but_guarded_and_never_acceptable",
 "#   tests/test_services.py::test_always_auto_run_guards_root_cause_ours   # API: 422 root_cause_guard on itm_4821",
]
w("learning_guard.txt", "\n".join(parts))

# 10 models
parts = [
 "# torch_rcm/agents/llm/models.py CAPABILITIES (verbatim) and torch_rcm/agents/llm/client.py system_blocks / build_request (verbatim)",
 src("torch_rcm/agents/llm/models.py", 42, 57),
 GAP("claude-haiku-5-5 entry omitted (lines 58-66)"),
 src("torch_rcm/agents/llm/models.py", 67, 67),
 src("torch_rcm/agents/llm/client.py", 39, 39),
 "",
 src("torch_rcm/agents/llm/client.py", 61, 63),
 GAP("build_request: signature and docstring (lines 66-78) skipped"),
 src("torch_rcm/agents/llm/client.py", 79, 99),
]
w("models.txt", "\n".join(parts))
