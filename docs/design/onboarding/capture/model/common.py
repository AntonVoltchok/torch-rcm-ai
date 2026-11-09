import asyncio, shutil, sys, json
from pathlib import Path
sys.path.insert(0, "tests")
from datetime import datetime
from agent_world import World, case_for, plan_case, policy_ctx_for, reader_for
from torch_rcm.agents.tools.adapters import SimWorld, StoreDomain
from torch_rcm.agents.tools.registry import ToolRegistry
from torch_rcm.config import Settings
from torch_rcm.runtime import Runtime
from torch_rcm.scheduler.registry import Registry
OUT = Path(__import__("os").environ["MODEL_OUT"])
def open_world(advance=True):
    db = OUT / ("work_thu.db" if advance else "work_wed.db")
    shutil.copy(OUT / "seed.db", db)
    rt = Runtime.open(Settings(db_url=f"sqlite:///{db}"), reg=Registry())
    if advance:
        asyncio.run(rt.scheduler.run_due(datetime.fromisoformat("2026-10-29T07:10:00-04:00")))
    sim = SimWorld(rt.world)
    return World(rt=rt, sim=sim, dom=StoreDomain(rt.store, sim), tools=ToolRegistry(sim))
