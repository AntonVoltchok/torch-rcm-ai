from common import *
from torch_rcm.agents.planner.live import Handles, render_case, render_plan
from torch_rcm.agents.planner.base import EvidenceSet
w = open_world(False)
for c in ("clm_4821","clm_4744"):
    case = case_for(w, c, "followup")
    h = Handles(list(case.evidence))
    txt = render_case(case, h)
    (OUT / f"raw_case_{c[4:]}.txt").write_text(txt)
    print(c, len(txt.splitlines()), "lines")
