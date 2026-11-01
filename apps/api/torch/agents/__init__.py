"""Torch agent runtime.

The one principle: **the model proposes; code gates and executes.**

A planner (scripted, recorded, or a live Claude conversation) classifies the situation, chooses which
read tools to call and submits a plan: allowed actions from a closed list, the evidence each cites and
optional draft text. It never calls a mutating tool. `policy.decide()` alone decides whether an action
runs now, goes to a person, is observed only, or is refused. The executor runs each allowed action as a
fixed, idempotent, code-defined recipe that is identical in deterministic and live modes.

Entry points: `runtime.AgentRuntime` (job handlers, triage, approvals, pause/resume, recovery),
`api_hooks.include_agents(app)` (HTTP + SSE), `eval.main()` (`torch eval`).
Spec: docs/spec/07-agents.md · Decision: docs/adr/0001-agent-runtime.md.
"""
