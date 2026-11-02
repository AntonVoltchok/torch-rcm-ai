# ADR-0006 — First-run hardening: refusals that leave a record, one root cause, one clock

Status: accepted · 2026-11-02

## Context

The first real run got `make lint test e2e eval` green quickly, then a walk through the demo against the real API found bugs that the green suite had hidden. The fixes needed judgment calls. They went to a red team (staff engineer who ships agents and reviews money-touching systems, `docs/design/red-team/challenge-first-run-decisions-2026-11-02.md`). The options and leans are in `docs/adr/worker-notes/first-run.md`.

The one reason that carried: the safety sentences justifying each fix had to be true in the code. Several of the coordinator's were not, and the red team reproduced them.

## Decisions

| # | Call | Chosen | Reason |
|---|---|---|---|
| 1 | A refusal that must leave a record | **The sign-off branch runs outside `idempotent()`**; the `409` stays | A refusal raised in a transaction rolls back, so the UI said "Sent to Dr. Morgan" and nothing arrived. Teaching `idempotent()` about committing refusals generalises for one call site; a `202` breaks the contract. |
| 1a | Sign-off requests | **One transaction, keyed, pinned** | The key lives in the idempotency table and points at the request: the same key returns it in any state, and a different change is refused. `rule_version` and `before` are pinned, and a stale approval is `409 signoff_stale`. Ids count requests, because the clock is frozen. |
| 1b | Approving a resolved sign-off | **Authority first, and a replay applies nothing** | Replaying approve skipped the owner check and re-applied the rule, so billing could sign a tier-2 rule. This predates the first run. |
| 2 | Where a found root cause lives | **On the claim**, written with the item and an audit event in one transaction | Every screen reads the claim. Keeping it on the item shows two answers and reverts on resolve. Recording happens before the reuse return, and a reused item's payload is refreshed. |
| 2a | Learning guards | **Through `guard_root_cause_ours`, fed the computed cause** | Inline checks read only the stored value, so a reused item could pass "Always auto-run" for a claim the run had just found to be ours. |
| 2b | A second denial | **A recorded `ours` survives re-adjudication** | `sim.py` hard-coded `PAYER`. Keeping `ours` can only tighten the guard. |
| 3 | The OpenAPI error envelope and `default_factory` fields | **Not now** | The owner said no contract changes, and green does not need it. The coordinator's lean to fix it was rejected. `pnpm test:contract` now asserts 14 real refusals instead, so the behaviour is held even where the document is thin. |
| 4 | Counts on the stream | **The strip is never written from a `counts` frame**; `meta.counts` writes only "All locations", for the user who asked | Both are computed without a viewer or a location and landed in a location-keyed cache. `done` refetches. The server still publishes the frame, so the contract stands. |
| 5 | `worker_loop` against the clock | **One `job_lock`**, held by a worker's job, a whole advance and a whole reset | The overlap was reproduced: a run's steps straddled Wed and Thu. |
| 5a | One bad job | **The worker loop survives it** | Nothing restarts that task. A reset under a run ended it silently, and every later approval stayed queued until a restart. |
| 5b | `visit.checked_out`, `eligibility.sweep` | **Still not handled** | Listed in the README. Nothing in the demo depends on them. |

## Where the red team and a hard rule met

Spec row 5 let an `unknown` situation open an item ahead of row 7, so an observe rule did something. CLAUDE.md says Observe does nothing, and the hard rule wins. Rows 4 and 5 now yield to row 7, spec 07 is amended, and two invariants hold it in `make eval`, with all three unknown claims run under every rule on observe. Payer contact is gated too: the rule that will decide is unknown before the plan, but the set of rules that could decide is known, so a run under any such observe rule makes no `payer:*` call.

## Consequences to say out loud

- **Under an observe rule, an `unknown` case reaches nobody:** only a `would_have_run` row in Activity. The hard rule is right, and it is a real cost of Observe.
- **Partial Observe thins evidence.** A rule on observe for an unrelated action can cost a run its portal evidence. The price of proving Observe never contacts a payer is thinner evidence while it is on.
- **Residual disagreement.** An Observe run may find `ours` but cannot write, so Denials still shows `payer` for a first denial. Fixing it would need a write under Observe, which the hard rule forbids.
- **A reset is refused while a run is finishing** (`409 run_in_progress`), and the UI says why.

## Also fixed on the way

- `useRun` closed the stream on the terminal `status` frame, so `counts` and `done` never arrived and the post-run refresh never fired. The mock hid it by sending the frames in another order.
- Call ids were a row count plus a per-process counter, so a restarted API reused ids from the same frozen second. Verified with `kill -9` at step 3 of 8: the run resumed and finished with one NEA upload.
- A timeline entry dated 10/12 listed an attachment made on 10/28; visits finished after their claims were built; #4859 finished after the demo's frozen now. A new invariant holds every seeded claim to the order.

## Not proven

Live mode has never reached the real API: no key on this machine, so cassettes are still hand-authored and eval compares shapes against them. CI has not run on GitHub. `docker compose up` was not tried. `file_departed` is asserted only against the mock, because the canonical seed has no open hold-window item with a queued file.
