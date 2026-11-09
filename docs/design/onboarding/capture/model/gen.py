from common import *
import json
from torch_rcm.agents.planner.live import Handles, render_case, render_plan, render_read
from torch_rcm.agents.planner.base import EvidenceSet
from torch_rcm.agents.policy import decide
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.readmodels import wording
from torch_rcm.domain.entities import InboxItem

w = open_world(False)
# ---- 4821
case = case_for(w, "clm_4821", "followup", run_id="run_4821")
plan, evidence = plan_case(w, case)
(OUT/"raw_plan_4821.json").write_text(json.dumps(plan.model_dump(mode="json"), indent=2))
d = decide(policy_ctx_for(case, evidence), plan.actions[0])
(OUT/"raw_decision_4821.json").write_text(json.dumps(d.model_dump(mode="json"), indent=2))
h = Handles(list(evidence.items))
(OUT/"raw_renderplan_4821.txt").write_text(render_plan(plan, h))
print(plan.model_dump(mode="json")["actions"][0]["evidence_ids"], [e.id for e in evidence.items])
# ---- 4744
case = case_for(w, "clm_4744", "followup", run_id="run_4744")
plan, evidence = plan_case(w, case)
(OUT/"raw_plan_4744.json").write_text(json.dumps(plan.model_dump(mode="json"), indent=2))
h = Handles(list(evidence.items))
(OUT/"raw_renderplan_4744.txt").write_text(render_plan(plan, h))
d = decide(policy_ctx_for(case, evidence), plan.actions[0])
(OUT/"raw_decision_4744.json").write_text(json.dumps(d.model_dump(mode="json"), indent=2))
reads=[]
for r in plan.reads:
    pass
# render the reads as the model would see them
import asyncio
from torch_rcm.agents.planner.base import ReadResult
rd = reader_for(w, case)
h2 = Handles([])
out=[]
for r in plan.reads:
    res = asyncio.run(rd(r.tool, dict(r.args)))
    out.append(f"# tool_result for {r.tool} {json.dumps(dict(r.args))}\n"+render_read(res, h2))
(OUT/"raw_reads_4744.txt").write_text("\n\n".join(out))
# ---- wording for itm_4821
snap = Snapshot.from_store(w.rt.store, w.rt.clock.now())
it = w.rt.store.require(InboxItem, "itm_4821")
res = {"action_label": wording.action_label(snap, it), "touches": wording.item_touches(snap,[it]),
       "signer_note_owens_viewer": None, "lands": str(wording.lands(snap, it)), "tier": str(it.tier), "kind": str(it.kind)}
for viewer in ("usr_dana","usr_morgan"):
    res["signer_note_"+viewer]=wording.signer_note(snap,it,viewer)
(OUT/"raw_wording_4821.json").write_text(json.dumps(res, indent=2, default=str))
print(res)
