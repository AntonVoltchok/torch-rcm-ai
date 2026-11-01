# Plan — agents runtime integration (slice A → coordinator)

`torch/api/app.py` has no `include_agents` extension point (only `_load_agents()`, which imports `torch.agents`
for side effects). `torch.agents` deliberately registers nothing on import: tests import it freely and the
global registry must stay world-only for the contract tests. The coordinator wires it with **two lines**:

```python
# torch/api/app.py · _load_agents(), after `import torch.agents`:
    from torch.agents.handlers import register; register(registry)        # run.start, triage, era.arrived

# torch/api/app.py · create_app(), after the include_router loop:
    from torch.agents.api_hooks import include_agents; include_agents(app)  # adds only routes the app lacks
```

(`registry` is `torch.scheduler.registry.registry`, the one `Runtime.open` uses.)

## Notes

- `include_agents` adds nothing against today's routers: `system.py` already serves `/runs/stream`,
  `/runs/{id}/events`, `/agents/status`, `/agents:pause|resume`, and `claims.py` serves `/claims/{id}:triage`.
  All of them read/write the same `run_events` log and `Practice.agents_paused`, so behaviour matches. The
  hooks matter for a slimmer app, and give live (non-polling) SSE via the shared `AgentRuntime.bus`.
- `system.set_paused(False)` only unparks jobs. That is enough: when the executor stops a run at a step
  boundary, the `run.start` handler enqueues a parked resume job (`run.start:{run_id}:resume:{n}`).
  `AgentRuntime.resume()` also re-creates a missing one.
- Optional third line in the lifespan, after `rt.scheduler.queue.recover()`:
  `AgentRuntime.shared(rt.store, rt.clock, rt.world).recover()` re-queues `run.start` for `running` runs that
  have a checkpoint (seeded "running" runs have none and are left alone).
- Live mode: set `AgentRuntime.shared(...).llm_client` to the model client (HTTP or cassette transport) at
  startup, or expose `make_planner(runtime, run_id)` in `torch.agents.planner.live`. Without either the
  executor uses `ScriptedPlanner(kind="scripted_fallback", note="live planner unavailable")`.
- `era.arrived` is registered by slice A (overnight Follow-up triage per denied claim). If a posting worker
  also handles it, `register()` keeps the existing handler; that handler should then enqueue
  `triage {claim_id, agent: "followup"}` per denied line itself (key `triage:{claim_id}:era:{remittance_id}`).
- Adapter gap: `SimWorld.act("nea.upload")` answers `{nea_number}` without `reference`; the executor falls
  back to `data[output_key]`. Adding `"reference": resp.get("nea_number")` in `adapters._act` would be cleaner.
