# ADR-0013 — The deployed demo replays recorded Claude responses

Status: accepted · 2026-11-10 · changes the deployed mode in ADR-0011

## Context

The deployed API ran in deterministic mode, so every agent run followed a hand-written plan. Five canonical cases have real recordings of the Claude API (`apps/api/cassettes/canonical/*.jsonl`, `synthetic: false`), but only the test suite and `make eval` replayed them. The welcome card said "no model calls by default; live mode sends the same cases to Claude", and the owner asked to make clear that viewers see real Claude output played back. With deterministic mode that would have been false.

Checked locally before deciding, in live + replay mode on a fresh seed:
- On the seed state, the triages of #4709, #4731 and #4744 (the tour's Try it) replay their recordings: 8 model calls, with Claude's own reads, situation label and proposal.
- After the overnight skip the case facts differ, the full-hash request no longer matches, and those triages use the hand-written plan (`recorded_plan`), labelled. Nothing errors.
- The overnight itself is rule-driven: of 65 runs, none called the model except where a judgment case had no recording (#4797, #4800: `scripted_fallback`, labelled "fell back to rules").
- `make eval`: same run shapes in both modes (Inbox 19, Denied 9).

## Decision

- Production runs `TORCH_AGENT_MODE=live` with `TORCH_CASSETTE_MODE=replay` (`render.yaml`). Replay reads only the cassette files: no API key, no network, no cost. Local development and tests keep `deterministic` as the default.
- `GET /agents/status` gains `replay: bool`. The UI never calls a replayed run a live call:
  - the run pane labels a model-planned run "Claude, recorded API response replayed" (or "Claude, live call" when not replaying);
  - the sidebar says "Recorded Claude" or "Live Claude";
  - the welcome's Agent mode card reads the mode from the server: "Recorded Claude", "Live Claude" or "No model";
  - the claim tour's #4744 step explains the replay and the fallback.
- A run now records the agent mode it ran under (`Run.mode`); it was always `deterministic` before.

## Consequences

- What evaluators see on the seed state is real model output for the judgment calls, and the copy says exactly that, including that routine work follows rules and an off-path case falls back to a hand-written plan.
- A recording plays only for the exact request it was made from, so a visitor who changes a recorded case first sees the fallback. "Reset demo" brings the recordings back.
- If Render's Blueprint sync is off, the env change in `render.yaml` needs a manual sync. `GET /agents/status` showing `"mode": "live", "replay": true` confirms it took.

## Alternatives rejected

Rewording only, keeping deterministic mode (honest, but viewers never see Claude's output); live calls with a key and a cost cap (cost, rate limits and non-deterministic runs on a shared demo).
