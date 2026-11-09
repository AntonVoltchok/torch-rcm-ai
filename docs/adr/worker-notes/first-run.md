# First-run pass (2026-11-02)

Folded from `docs/plans/first-run.md` and `docs/plans/first-run-decisions.md`. Decisions and reasons are in ADR-0006; both plans are kept below as they stood before the red team.

---

### First run — failure inventory (2026-11-02)

Recorded before any fix, from a clean `uv sync` / `pnpm install` on the owner's laptop (macOS arm64, Python 3.13.18, Node 24.21, pnpm 10.28 via `packageManager`, uv 0.13.6). Fold into `docs/adr/worker-notes/` when the pass lands; delete this file.

### Clean on first run

`uv sync`, `ruff check`, `ruff format --check`, `torch seed --force`, `torch openapi` (48 paths, 147 schemas), `torch eval` (OK in both modes), `pnpm install`, `pnpm gen:api`.

### API

| # | Category | Count | Where | Note |
|---|---|---:|---|---|
| A1 | mypy: stale `type: ignore` | 18 | seed/builder, agents/* | Written for the missing-package environment. Delete; do not relax `warn_unused_ignores`. |
| A2 | mypy: redundant `cast` | 4 | agents/tools/adapters | Same cause. |
| A3 | mypy: `RunStore.list` method shadows builtin in annotations | 5 | agents/runtime | Real type bug, not noise. |
| A4 | mypy: `JsonValue` vs `list[str]` invariance | 2 | catalog/recipes, planner/scripts/followup | |
| A5 | mypy: other strict findings | 6 | case, llm/client, llm/cassette, runtime:343, cli | Includes untyped typer decorator. |
| A6 | pytest: `test_routes_match_the_contract_table` sees no app routes | 1 | tests/test_api_contract | `set() == {...}`; the helper reads an empty set, so the check itself is not running. |
| A7 | pytest: `POST /clock/advance?wait=true` fails response validation | 1 | routers | A real bug: `AdvanceAccepted` response model vs the `AdvanceOut` body. Never executed before. |
| A8 | pytest: `PATCH /settings/practice` smoke call sends no body | 1 | tests/test_api_contract | Test table gap. |

443 of 446 tests pass. The snapshot was regenerated after pytest ran, so tests must be re-run against it.

### Web

| # | Category | Count | Where | Note |
|---|---|---:|---|---|
| W1 | eslint: unnecessary assertions, type-only import | 5 | api/client, claims/search, mocks/handlers | `--fix` candidates. |
| W2 | eslint: `unbound-method` | 3 | state/{launches,live,session} | |
| W3 | eslint: `no-base-to-string` on a `JsonValue` | 1 | mocks/db:1559 | |
| W4 | tsc: two nominally distinct `InboxList` inferences; `error` is `unknown` | 2 | InboxPage:177, routes/__root:19 | Only 2 under the hand mirror; the generated schema may add more. |
| W5 | vitest: `role="article"` queries find nothing | 5 | InboxPage.test | Common cause, or a real render failure? Find out which. |
| W6 | vitest: `audit-line`, `preview-numbers` testids missing | 2 | ProgressPanel.test, SettingsAgentsPage.test | |
| W7 | jsdom `window.scrollTo` not implemented | 13 | setup | Noise; stub in test setup. |
| W8 | pnpm ignored build scripts for esbuild and msw | 2 | package.json | `public/mockServiceWorker.js` was never generated, so mock mode cannot run. |
| W9 | `schema.ts` still hand-maintained; `generated.ts` unreferenced | — | src/api | Planned: re-export. Expect this to expose the remaining `ClaimRow`/`ClaimDetail` drift. |
| W10 | not yet run: Playwright (browsers not installed) | — | e2e | |

### Environment

Node 24 here versus 22 in CI. `act` is not installed. No `ANTHROPIC_API_KEY` in the environment or in `.env`, so step 4 (real cassettes) is blocked unless one appears.

---

## First-run judgment calls (2026-11-02)

Calls the coordinator made, or was left with, while getting the repo green against the real API. A reviewer could reasonably have decided each one differently. Code for calls 1 and 2 is already on `chore/first-run`; both can still be reversed.

### 1. A refusal that must leave a record, under `Idempotency-Key`

`PATCH /rules/{id}` by billing on a tier-2 rule answers `409 owner_signoff_required` and must also create an inbox item for the owner. `idempotent()` runs the mutation in one transaction and stores only successes, so raising the 409 inside it rolled back the item: the UI said "Sent to Dr. Morgan" and nothing arrived.

- A. (shipped) Run the sign-off branch before `idempotent()`, outside the transaction. `request_signoff` returns the open request for the same (rule, change), so a retry cannot duplicate. Item ids count requests rather than use the frozen clock.
- B. Teach `idempotent()` about "committing refusals": catch a marked `ApiError`, commit, store the 409, replay it.
- C. Return `202` with the item instead of `409`. Changes the contract.

**Lean: A.** One call site, and the contract stands.

### 2. Where a root cause found by an agent lives

A run computes `case.root_cause`. It was stored only in the inbox item's payload, so Castillo (#4797) read "ours" in the Inbox and "theirs" on Denials, which reads `claim.denial.root_cause`.

- A. (shipped) Write it to `claim.denial.root_cause` when the item opens. Observe runs open no item, so Observe still writes nothing. A new invariant runs in `make eval`.
- B. Keep it on the item; have Denials read the open item first, then the claim. No write, but the answer reverts when the item resolves.
- C. Write it for every run, at `gather_case`.

**Lean: A.** Check: `case.py` makes `ours` sticky (`"ours" if "ours" in (computed, stored)`), so recording it can only tighten the `ours` guard. Is there any path where recording a cause loosens a guard, or where `payer` overwrites something it should not?

### 3. Is the OpenAPI document the truth?

Two gaps. `default_factory` fields generate as optional although Pydantic always sends them, and errors document FastAPI's `HTTPValidationError` rather than the real envelope, with 403/404/409 absent. The web normalises the first at the edge. CLAUDE.md calls the OpenAPI document the shared contract.

- A. Fix both now (`json_schema_serialization_defaults_required`, error responses in the route table). The cost lands on mock fixtures.
- B. Fix neither; record it.
- C. Fix the error envelope only: a client reading the document cannot otherwise learn the 409 this repo's demo depends on.

**Lean: C now, A's first half later.** Not needed for green, and this pass promised no contract changes.

### 4. The SSE `counts` frame has no viewer

`executor._counts_event` computes the strip with `user_id=None`, so `inbox_open` is the shared queue. The run stream now reads that frame (it was being dropped). For Dr. Morgan with a sign-off assigned to her, the badge can show one less until the `done` invalidation refetches, which follows within milliseconds.

- A. Leave it: the refetch corrects it.
- B. Stop publishing `counts` on the run stream, and rely on the refetch.
- C. Compute it per subscriber.

**Lean: A**, and write it down. "Never render a number the server didn't compute" holds either way.

### 5. Unhandled scheduler jobs, and `worker_loop` overlap

`visit.checked_out` and `eligibility.sweep` jobs go unhandled on advance. The advance red team flagged a possible overlap between `worker_loop` and an advance; it was not reproduced, and no test covers it. Today's claims are static in the demo and nothing visibly depends on either job.

- A. Leave both and list them in STATUS.
- B. Write the handlers now.

**Lean: A.** Out of this session's goal, and the overlap needs a reproduction before it needs a fix.

### 6. What this session does not claim

No `ANTHROPIC_API_KEY` exists on this machine, so cassettes stay synthetic and live mode has never reached the real API. CI has not run on GitHub: nothing has been pushed. Is anything in the repo's own text still overclaiming either?
