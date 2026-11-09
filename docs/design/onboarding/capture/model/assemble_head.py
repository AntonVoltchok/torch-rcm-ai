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

