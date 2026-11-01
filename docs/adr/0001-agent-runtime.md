# ADR-0001 — Agent runtime: model proposes, code gates and executes

Status: accepted · 2026-11-01 · Decided after red team (docs/design/red-team/challenge-agent-architecture-2026-11-01.md)

## Decision
- The LLM (live mode) classifies the situation from world content, chooses which **read** tools to call, and submits a **plan** (allowed action from a closed list + evidence citations + optional draft text). It never calls a mutating tool. The Policy layer (rules table × tier × caps × root cause) decides whether the plan runs now, goes to the inbox, is observed only, or is refused. The Executor runs each action as a fixed, idempotent, code-defined step recipe — identical in live and deterministic modes.
- The model earns its place where code cannot decide: `unknown` situations (2–3 are seeded), free-text evidence, posting variances. Those are tested with property checks, not equality with the script.
- Live mode is used for the **claims, followup and appeals** agents only; eligibility and posting are scripted (their screens are static/mock-only in the demo).
- Request builder uses a **static per-model capability table**: no `temperature`/`top_p`/`top_k` on any 5.5 model; Haiku 5.5 → thinking disabled + forced tool choice allowed; Sonnet 5.5 → `thinking: between_tools`, effort medium, `tool_choice: auto`; Opus 5.5 (drafting) → adaptive thinking, `auto`. Automatic top-level prompt caching; prices in `pricing.toml` (cache reads 0.05×).
- A terminal tool (`submit_plan`/`submit_result`) sent in the same turn as reads is rejected with `is_error` and a nudge; one repair turn; then labeled scripted fallback.
- No "round 2" inside a run: a rep call that changes the picture writes evidence and enqueues a new triage run.
- `POST /clock/advance` is **async** (202 + progress on the run firehose), live concurrency 2, per-advance live-run cap.
- Checkpoints pinned to `{model, effort, system_sha, tools_sha}`; mismatch → re-plan (safe: nothing mutates before `submit_plan`). Cassette key includes `system_sha`. Prompt ids deterministic.
- Run states include `paused`; kill switch parks runs (no hot loop). SQLite rules: one writer, short transactions, none held across an LLM await or a step delay.
- Cut from the demo: runtime LearningService and demotion (stats are seeded; threshold is a pure tested function), OpenTelemetry (structlog + `llm_calls` table), replay timing knobs, daily cost cap, alarm rows (asserts instead).

## Consequences
- The demo shows the model visibly deciding on an ambiguous claim (demo step added), while every money-touching action stays reviewable and reproducible.
- Deterministic mode runs the full demo with no API key; live mode adds model triage and drafting with the same run shape.
