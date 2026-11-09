# ADR-0010 — First live recording: one strict tool per request, real cassettes

Status: accepted · 2026-11-09

## Context

Live mode had never called the API. The five canonical cassettes were hand-authored (`synthetic: true`, structural hash), so `torch eval`'s "live matches deterministic" compared the code against made-up turns. Getting the key working surfaced four problems, in this order:

1. **The API never went live.** `wire_agent_runtime` built `AgentConfig()` (defaults), so `TORCH_AGENT_MODE=live` was ignored. A reseed (`POST /clock/reset`) rebuilt the shared runtime without a model client, so live runs silently became scripted. Nothing read the repo-root `.env`.
2. **The first real request was rejected.** HTTP 400 "The compiled grammar is too large… reduce the number of strict tools", with every tool `strict: true` (spec 07 §3.5). The published counts were all within limits: 7 strict tools, 0 optional params, 4 union params. Probing with 16-token requests (2026-11-09, `claude-sonnet-5-5`) showed `submit_plan` compiles alone and the reads compile together, but `submit_plan` plus any one enum-bearing strict tool fails. Dropping every enum inside `submit_plan` did not help: the array of 7 action shapes (`anyOf`) is the cost.
3. **Replay missed the recordings.** `claim_get_history` listed the run doing the reading as one of the claim's runs (`"10/28 followup · "`, no result). The recorder never stores a Run, so its requests differed from the app's in that one field, and under full hashing every triage missed.
4. **The model caught a seed gap.** For #4709 (Cigna: "narrative illegible, please resend") the seeded visit had no note text, so the reviewed plan's records request would have sent nothing. The model said so and handed the case to a person, and `torch eval` failed the run as outside the envelope.

## Decision

- **Config.** `AgentConfig.from_env()` everywhere; the model client is built when the shared `AgentRuntime` is (`_make_llm_client`), so a reseed keeps it. `torch_rcm.config.load_env_file()` loads the repo-root `.env` into the environment without overriding it; `TORCH_DOTENV=0` skips it, and the test suite sets that.
- **Strict mode only where code acts on the payload.** `submit_plan` and `submit_draft` are `strict: true`. Reads and `submit_result` are not. `lint_tools()` enforces at most one strict tool per request and that those two are strict; the structure lint (`additionalProperties: false`, all properties required, no numeric keywords, no ids or names in `enum`/`const`) still covers every schema. Read inputs were already parsed by Pydantic models with `extra="forbid"` and scope-checked, so a malformed read gets `is_error`, never a world call. A forced single-tool request (eligibility's `submit_benefits`) may stay strict.
- **History lists finished runs only** (not queued, running or paused, and never the reader). It is the right content for the model too: an in-flight run has no result to report.
- **#4709's visit has a signed clinical note** in the seed. With it, the recorded model plan is the reviewed records request.
- **Cassettes are real.** All five were recorded with `torch cassette record` (`synthetic: false`, `hash_mode: full`). `test_cassette.py` checks them as recordings: current keys, replay against the seeded world, the #4821 group's exact actions, the unknowns inside their reviewed envelope (not equal to the hand-written plans), and the Opus appeal draft through the text guard, built from the seeded world as the recorder builds it. The reviewed-plan files' `recorded_from` now says they are hand-written and names the recording that must stay inside their envelope.

## Alternatives considered

- **Flatten `submit_plan`'s actions into one object** with nullable fields, keeping every tool strict. It would add about 11 union params (14 of 16 in total, with no room for another action) and lose the per-action required fields, and it was not shown to compile. Rejected.
- **Split reads and the plan into separate requests.** That changes the conversation design the cassettes and prompts rely on, which is too much for this fix.
- **Accept #4709's no-action answer and widen its envelope.** The model was right about the data, but the scenario (spec 04, spec 07's table) assumes a note to resend. Fixing the seed keeps the story coherent.

## Consequences

- `tools_sha` changed, so the old synthetic cassettes no longer match. Any prompt or tool edit now needs a re-record (about $1 for all five).
- `torch eval` replays real Sonnet output for #4709, #4731 and #4744, and the inbox counts match deterministic mode (19). #4797 and #4800 still have no cassette and fall back to the script, labelled `scripted_fallback`.
- The model's labels differ from the reviewed plans' labels: for #4744 it chose `denied:CO-16:M127:records_request` for a pending claim. The policy decides on the code's classifier situation (here `unknown`, so a person reviews). A live label that differs from the classifier's can only turn an auto rule into a proposal (policy row 13), never the reverse. The label is shown on the run.
- The onboarding tour now labels the #4744 cassette as a recorded API response (DECISIONS D21).
