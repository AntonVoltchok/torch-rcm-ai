import json, sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from torch_rcm.agents.prompts import tools_for
from torch_rcm.agents.tools.schemas import lint_tools
tools = tools_for("followup","plan")
print([t["name"] for t in tools], lint_tools(tools), all(t["strict"] for t in tools))
by = {t["name"]:t for t in tools}
P=__import__("os").environ["MODEL_OUT"] + "/"
for n in ("pms_find_images","claim_get_history","pms_get_visit","submit_plan"):
    open(P+f"raw_tool_{n}.json","w").write(json.dumps(by[n],indent=2))
    print(n, len(json.dumps(by[n],indent=2).splitlines()))
