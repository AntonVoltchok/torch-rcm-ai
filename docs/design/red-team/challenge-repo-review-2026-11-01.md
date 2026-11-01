# Red team — Repo review (hiring Director of Engineering persona) — 2026-11-01

Written read-only by an independent subagent after the scaffold, agents runtime and integration landed (365 API tests green; web never compiled because the build session had no npm/PyPI access). Given the whole repo; told the environment constraint; told to judge design and code as written and estimate first-run risk separately.

## Verdict

**Advance to onsite, but run the onsite as a test of whether he owns the code.** The product judgment is above the bar. The tier model, "model proposes, code gates", root-cause-ours never auto-runs, and a policy table stored as data are what we would build. The repo also says, in its own docs, that it was produced by a hands-off coordinator session in about three hours and never compiled on the web side. The single deciding thing is whether he can walk `executor.run` and `useRun` from memory and fix the API↔web shape drift live. If `make lint test e2e` is not green against the real API before the onsite, it's a no.

## What the repo says about engineering judgment

1. **Policy as data, checked at import.** `agents/policy.py:299-328` holds the decision rows (first match wins). `:400-415` asserts the table's own invariants at import. `:337` re-checks only a subset of rows on approval runs. This is good design. One nit: `:296` is a dead branch after the early return at `:291`.
2. **The model's surface is closed, with defence in depth.** `submit_plan` is generated per agent from the catalog (`tools/schemas.py:233`) and has no confidence, tier or amount fields. Policy row 1 then re-validates scope ids, values against evidence, and that cited evidence was actually gathered (`policy.py:124-172`). This is the right instinct.
3. **The executor works but is one god function.** `executor/executor.py:542-771` is a single 230-line method with `noqa: PLR0912, PLR0915`. The planner is typed `Any` and duck-typed through `getattr` (`:585`). A checkpoint pin mismatch is detected and then ignored (`:591`), while ADR-0001 says "mismatch → re-plan". The docs are ahead of the code.
4. **The front-end streaming is senior work, with one real bug.** The monotonic, replay-safe reducer (`lib/runEvents.ts`) and the fetch-based SSE with Last-Event-ID and a polling fallback are good. The bug: if the `done` payload fails to parse, `runEvents.ts:101` sets the run to `'succeeded'` (called from `useRun.ts:70`). `invalidateAfterRun` never invalidates `qk.run`, and `staleTime` is `Infinity`, so a failed run shows as succeeded until reload. That breaks his own rule: never render state the server didn't compute.
5. **There are two backends.** `mocks/db.ts` (1,628 lines) re-implements the preview, denial routing and per-viewer inbox, and it already disagrees with the API. `e2e/demo.spec.ts:202` expects 16; ADR-0002 and spec 06 say 17. The e2e runs against the mock by default, so the demo test checks the TypeScript copy, not the product.

## Red flags a reviewer will hit in the first 30 minutes

1. **`git log`:** 7 commits, about 42k lines, timestamped 00:54–04:06 on Nov 1. CLAUDE.md asks for "small commits".
2. **`docs/SESSIONS.md:3`:** "The owner wants to be hands-off… makes decisions by red team rather than by asking the owner." CLAUDE.md says "do not ask the user", and STATUS credits "coordinator: Fable 5.1". It is disclosed, so not dishonest, but it changes the question from "can he build" to "what did he decide".
3. **Claims that are false today:**
   - README and CLAUDE.md say "Zod schemas generated from OpenAPI". `src/api/schema.ts` is a 900-line hand-written mirror, and `gen-api.mjs` writes a `generated.ts` that nothing imports.
   - The OpenAPI snapshot was built from a hand-written route table (`api/contract.py`), not from FastAPI.
   - CLAUDE.md says "FastAPI + SQLModel". Storage is a custom JSON document store (`db/store.py:1-12`), yet `sqlmodel` is still in `pyproject` dependencies.
   - CLAUDE.md says "mypy --strict on torch/agents". `pyproject` applies strict to `torch.domain` only.
4. **"Live mode gives identical run shapes" is unproven.** The cassettes are hand-written (`synthetic: true`), so `make eval` compares the script against a hand-made copy of the script. No model has ever been called. The injection test (`tests/adversarial/test_prompt_injection.py:36`) asserts the plan is unchanged by injected text, but it runs on scripted and recorded planners that cannot be steered by construction. It really tests the policy backstop.
5. **`make lint` fails today.** I ran ruff 0.16.9 read-only: 71 errors (54 × E501), while STATUS says ruff was clean.
6. **The Python package and CLI are named `torch`,** which shadows PyTorch.
7. **Leftover files:** `src/__probe.ts`, a debug script. Five `docs/plans/*.md` that CLAUDE.md says to delete once merged. `decisions-log.md` is titled "Molar" and contains a `/home/claude` path. The red-team docs name Dentrix, which breaks the repo's own no-vendor-names rule.
8. **Silent agent loss.** `api/app.py:40-48` swallows `ImportError` from `torch.agents`. One bad import and the API boots "world-only" with no error, so the demo is inert.

## First-run risk estimate

- **API.** `pytest`: 365 passed, 2 skipped, 23 s (pure Python + pydantic). Never executed: the FastAPI routers, SSE, lifespan, the typer CLI and `test_api_contract.py`; mypy with the pydantic plugin over 25k lines with `disallow_untyped_defs`. `asyncio_mode=auto` will start doing something once pytest-asyncio is installed. There is no `uv.lock`. **4–8 h.**
- **Web, mock mode.** Never compiled. Expect most `tsc` errors from TanStack Router's typed `search` and `navigate`. ESLint `recommendedTypeChecked` with `--max-warnings 0` will flag floating promises. No `pnpm-lock.yaml`, so CI's `--frozen-lockfile` fails. **6–12 h.**
- **Web against the real API — the real risk.** `GET /runs/{id}` returns `RunDetail {run, evidence, last_event_id}`, but `api/endpoints.ts:66` parses it as a flat `Run` → `schema_mismatch` on the ProgressPanel, the centrepiece of demo steps 3 and 3b. The API's `InboxItemOut` has `claim` and `patient` objects and `evidence_ids`; `schema.ts:321` expects `claim_id`, `patient_id` and `evidence`. Zod is non-strict, so it parses, and the evidence cards and claim links render empty with no error. **6–12 h**, plus re-baselining the e2e from 16 to 17.
- **Live mode.** The request uses thinking, effort and top-level caching parameters that have never been sent to the API. **2–4 h**, plus re-recording the cassettes.
- **Total:** about **20–35 h** to green `lint test e2e eval` against the real API.

## What to cut or simplify before the onsite

- Cut `mocks/db.ts` down to fixtures (or drop MSW) and run the e2e against the API only.
- Drop live mode from the demo claims, or record real cassettes with a key and say so in the README.
- Trim `07-agents.md` (712 lines) to what is built, and add a "not built" list (the six missing handlers).
- Split `executor.run` into one function per step, and type the planner as a Protocol.
- Rename the package (`torch_rcm`).
- Delete `__probe.ts` and the merged plans, fix the "Molar" title and the vendor names, and make the docs match the code (SQLModel, codegen, mypy scope).
- Rewrite `SESSIONS.md` to say what *he* decided and what he reviewed. Don't rewrite history.
- Be ready to defend or cut the 418-line seed fitter (`seed/fit.py`), which fits invented data to pinned KPIs.

## Ten onsite questions this repo invites, with the answer the candidate should give

1. **"What did you write and decide?"** Be exact. He orchestrated Claude Code sessions. He personally chose the tier model, policy-as-table and model-proposes. He should name what he reviewed and changed afterwards. Don't oversell.
2. **"Walk me through Approve 3."** The UI removes the items optimistically and POSTs the group. The server creates approval runs keyed `approval:{item}` and `run.start` jobs. The executor re-checks rows 0, 1, 3, 14 and 15, then runs the recipe steps with idempotency keys. Steps stream over SSE, `meta.counts` updates the strip via `setQueryData`, and `done` triggers the invalidations.
3. **"Where does the server read `Idempotency-Key`?"** Nowhere (`client.ts:68`). Dedupe is the server's `approval:{item_id}`. Either honour the header with a stored-response table or delete it.
4. **"Can Observe mode reach a payer?"** Yes. Rows 5 and 6 propose before row 7, and approval runs skip row 7, so a human approval executes. Either defend that (the human is the gate) and reword CLAUDE.md, or add row 7 to the approval re-check.
5. **"Why does the e2e say 16 when the ADR says 17?"** The mock is a second implementation. The fix is to test the API and reduce the mock to fixtures.
6. **"How do you know live mode works?"** Not yet. The cassettes are synthetic. Bring a real recording to the onsite.
7. **"What would fail your injection test?"** Nothing in the scripted mode. The real guarantees are the row 1 scope/value checks and row 5 (cites only suspicious evidence). The real test is a recorded live cassette with injected content, asserting the verdict is never `execute`.
8. **"Why a hand-rolled document store?"** One pydantic model set serves as OpenAPI and storage, with generated indexed columns and a single writer. The cost is no migrations and a process-wide lock. Production would be Postgres with JSONB, an outbox and a real queue. Policy and recipes survive unchanged. Admit PyPI was blocked.
9. **"What if the SSE `done` event is malformed?"** Today the run shows as succeeded indefinitely. Fix: on a parse failure, invalidate `qk.run` and never assume a status.
10. **"Partial pays one line and denies another. How is it reconsidered?"** It can't be. `transitions.py` has no outgoing edge from PARTIAL, and `void_claim` and `corrected_claim` have no edges at all. He should acknowledge the gap and sketch line-level status, or Partial plus an appealable flag (which the decisions log already lists as reversible).

---

## Decision taken (Claude, 2026-11-01)

Fix pass applied for: the `done`-parse bug and `qk.run` invalidation; `RunDetail` and `InboxItemOut` shape drift; ruff E501; docs made truthful (document store, hand-written Zod mirror until `gen-api` runs, mypy scope); `sqlmodel` dependency removed; `__probe.ts` and merged plans removed (decisions folded into ADR-0003); decisions-log title/path; vendor names redacted in historical reports with a note; agents import failure no longer silent; `Idempotency-Key` honored server-side; Observe mode added to the approval re-check; Partial/void/corrected transitions; executor split into step functions with a typed Planner protocol and re-plan on pin mismatch; package renamed `torch_rcm`; e2e re-baselined to 17; a "Not built in this demo" section in README. Not changed: git history; `seed/fit.py` (kept, documented as the reconciliation fitter); `07-agents.md` length (a "built vs not built" map added at its top instead of trimming).
