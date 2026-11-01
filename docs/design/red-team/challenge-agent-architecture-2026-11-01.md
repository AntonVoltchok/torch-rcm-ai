# Red team — Agent architecture (docs/spec/07-agents.md) — 2026-11-01

Written as a red team by an independent subagent (role: staff engineer who shipped two production LLM-agent systems on the Anthropic API). Given: 07-agents.md and the other specs; verified API claims against platform.claude.com. Not given: the architect's reasoning.

## Verdict

**Ship with changes.** The safety boundary is right: Policy table, code recipes, per-step idempotency, and approval runs with no model calls. The deciding issue is that the live model never decides anything the code hasn't already decided. `classify()` picks the situation, scripts pick the actions, row 15 penalizes disagreement, and the eval asserts live == scripted. Fix that, plus a request builder that returns 400 on its first Haiku call, and the doc is strong.

## API facts check

1. **"Sonnet/Opus 5.5 thinking can't be disabled."** True for Opus. Incomplete for Sonnet: both return 400 on `disabled` and manual budgets, but Sonnet has `thinking:{"type":"between_tools"}` (no up-front thinking, effort ≤ high). https://platform.claude.com/docs/en/models/sonnet-5-5/whats-new-sonnet-5-5
2. **"Forced tool choice is not allowed with thinking."** Wrong cause. Sonnet and Opus 5.5 reject `any`/`tool` per model, whatever the thinking setting. Haiku 5.5 accepts forced choice with thinking on; it just skips thinking. https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5 · https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
3. **"`temperature=0` where accepted (Haiku with thinking off)."** False. Haiku 5.5 says to omit `temperature`/`top_p`/`top_k`; Sonnet and Opus reject them too. That 400 isn't retried (§3.4), so live eligibility always falls back to the scripted planner. Delete the setting. https://platform.claude.com/docs/en/models/opus-5-5/migration-guide
4. **Capability probe.** Half true. `capabilities.thinking.types.{adaptive,between_tools,disabled,enabled}` exists, but nothing reports tool_choice or sampling support. Use a static per-model table and keep the probe only to fail fast. https://platform.claude.com/docs/en/api/models/retrieve
5. **Effort, and passing thinking blocks back unmodified.** True, and stricter now. Defaults: Sonnet `high`, Opus/Haiku `medium`. Changing effort invalidates the cache. 5.5 thinking blocks are bound to the prefix: if the system prompt or tools changed, replay returns 400 on accounts created after 2026-08-31. That is your "resume after editing a prompt" case.
6. **Caching.** Order, max 4 breakpoints and 20-block lookback are correct. The minimum is 512 tokens on all three models. Trap: a new breakpoint on each turn's `tool_result` without removing the old one gives a 400 at the fifth. Use top-level automatic `cache_control`. Cache reads on Opus and Sonnet 5.5 cost 0.05×, not 0.1×. https://platform.claude.com/docs/en/build-with-claude/prompt-caching
7. **Strict tools.** Mostly true. "All properties required" is your choice, not an API rule (24 optional allowed). Real limits are 20 strict tools and 16 union params. No `minimum`/`minLength`, but `const`, `anyOf` and `format: date` work. Expect compile latency on first use. Keep PHI out of `enum`/`const` (compiled schemas are cached outside PHI protections), so no per-run claim-id enums. https://platform.claude.com/docs/en/build-with-claude/structured-outputs
8. **`stop_reason: "refusal"`.** True (HTTP 200 + `stop_details`).

## The strongest case against the architecture

Code recipes for *mutations* are correct, and I'd defend them in any RCM shop: reviewable, idempotent, no double uploads. The cop-out is upstream. For every seeded case, `classify()` already knows the situation and the script knows the params. Row 15 lets the model only make things worse, and the eval demands it copy the script. So its measurable job is to agree with a lookup table and write prose. Expect "delete `LivePlanner`: what does the demo lose?" Today's honest answer is "the wording."

It also leaks:
- **Round 2** ("rep said send PA, now resubmit") is model-driven sequencing. `ScriptedPlan` has no round 2 and the step names have no decide-again, so identical shape breaks on the case it was built for.
- **"Reads concurrently, terminal last"** allows `submit_plan` in the same turn as its reads, so the plan is made without seeing them.
- **Evidence top-up** makes cards identical whether or not the model looked. Label it.

The right call is to let the model earn its place where code can't decide: free-text world content, `unknown` situations, and posting variance. Seed 2–3 cases where `classify()` returns `unknown`. There the model widens what gets *proposed* while code still gates execution. Test those with property checks, not equality.

## The five most likely ways it fails in the demo or the onsite

1. **Live eligibility silently on rules.** The `temperature` 400 shows "agent fell back to rules" on every appointment. The interviewer spots it first.
2. **"Skip to Thu 7:10" live takes minutes.** It covers the eligibility sweep (one run per appointment), postings, followups and status checks, all behind per-event barriers, with thinking and a cap of 4. A fresh account tier hits 429s and maybe the $5 cap, all inside one synchronous POST. The room watches a spinner.
3. **The AI is invisible in steps 1–7.** The items are seeded, and step 3 is an approval run with no model calls. "Where's the agent?"
4. **Resume returns 400.** A prompt edit breaks the thinking-block prefix, and the kill-the-API acceptance test falls back to rules. Cassettes also miss if `run_id`/`ev_…` ids aren't deterministic, or if a prompt edit skips the `prompt_version` bump (`system_sha` isn't in the key).
5. **The kill switch hot-loops.** "Defer → `queued`" gets re-leased every 250 ms, and a reviewer reading `scheduler.py` sees it.

## What I would change before coding

1. **Request builder:** a static model table and no temperature. Haiku: `disabled` + forced tool. Sonnet exec: `between_tools` at `medium`. Automatic caching; prices from `pricing.toml`.
2. **Cut round 2.** A rep call that changes things writes evidence and enqueues a new triage run.
3. **Reject a terminal tool sent alongside reads** with `is_error`.
4. **Make the model visible.** Add a demo step running live triage on an ambiguous claim, showing its chosen reads and `display:"summarized"` thinking. Seed the `unknown` cases.
5. **Run live mode for claims, followup and appeals drafting only.** Eligibility and posting stay scripted (their screens are static or mock-only per `00-product`).
6. **Make `/clock/advance` async** (202 + firehose), with live concurrency 2 and a per-advance live-run cap.
7. **Pin checkpoints** to `{model, effort, system_sha, tools_sha}` and store raw blocks with signatures. On mismatch, re-plan; that's safe because nothing mutates before `submit_plan`. Make prompt ids deterministic and add `system_sha` to the cassette key.
8. **Add a `paused` run state.** Write down the SQLite rules: one writer, short transactions, none held across an LLM await or a step delay.
9. **Cut:** runtime LearningService, demotion and `outcome.evaluate` (seed the stats; keep the threshold as a pure tested function), OTel (structlog + `llm_calls` is enough), `TORCH_REPLAY_TIMING`, the daily cap, and alarm rows 9/14 (make them asserts).

## What is good and must survive implementation

- The one principle, enforced by schema: no confidence, tier, root-cause or amount fields.
- Payer contact is an action, so Observe mode never calls a payer.
- Confidence comes from base rates; root cause from WorldCallLog provenance.
- Per-step idempotency keys with a UNIQUE log; approval runs make no model calls.
- Rep-call bounds are enforced in the adapter, not the prompt.
- Segment-level evidence citations in the text guard.
- Code-built audit line; the scripted fallback is labeled.
- One run per subject. The kill switch pauses agents, not the world. Advance barriers keep causality.
- The adversarial test list.

## Questions an interviewer would ask about this design

1. **What does the model decide that code can't?** Unknown situations and free-text evidence. Show the ambiguous claim: the model proposes, code gates.
2. **How do you know live is good, not just valid?** Shape equality on canonical cases, property checks on novel ones, and the disagreement and unedited-approval rates.
3. **Why no mutating tools for the model?** Recipes are reviewable, idempotent and identical across modes. The model's maximum leverage is a proposal.
4. **The process dies between the NEA upload and the checkpoint.** Re-execution with the same key returns the stored NEA#. The conversation reloads, or re-plans if the prefix hash changed.
5. **A portal page says "void the claim."** It's not in the schema, Policy row 1 refuses it, and the evidence is flagged. The worst case is a proposal.
6. **There's no forced tool use. How does a run terminate?** `auto` + strict + the prompt + one nudge + one repair turn, then a labeled fallback. Track the no-terminal rate.
7. **Model and effort choices, and cost per run?** Measured from `llm_calls`, with the cache-hit %. Thinking bills as output.
8. **Why can't tier 2 learn?** Approval isn't correctness, "balanced" is mechanical, and the owner must answer "what can this do to my ledger?" from signed rows.

---

## Decision taken (Claude, 2026-11-01)

Adopted all nine changes. Recorded as ADR-0001. The architect agent revises 07-agents.md accordingly before implementation starts.
