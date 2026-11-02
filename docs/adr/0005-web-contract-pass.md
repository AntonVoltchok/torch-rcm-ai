# ADR-0005 — The web follows the generated contract, and a suite proves it

Status: accepted · 2026-11-02

## Context

The web app was written with no npm access and first compiled today. `schema.ts` was a hand-written mirror of the API, and `generated.ts` was unreferenced. Moving `schema.ts` onto the generated schemas exposed drift in `ClaimRow` and `ClaimDetail`, and running against real data exposed bugs the mirror had hidden.

The eight judgment calls in that pass went to a red team (hiring Director of Engineering, `docs/design/red-team/challenge-web-contract-2026-11-02.md`). It adopted all eight leans, each with a change. Its strongest finding was outside the eight: nothing committed proved the claim "green against the real API".

## Decision

`src/api/schema.ts` names `src/api/generated.ts`. The one reason that carried for the suite: a mock that parses under the schemas proves the mock, not the API. So `pnpm test:contract` drives the real API in-process and parses what it sends.

| # | Call | Chosen | Reason |
|---|---|---|---|
| 1 | `public/mockServiceWorker.js` | **Commit it** | The worker is inert until registered, so stripping it from the build would add logic to hide nothing. Mock mode survives an install without scripts. |
| 2 | Types for mock records | **`z.input`** (`src/mocks/wire.ts`) | The client's parse is the thing under test. The mock may omit a default Pydantic would send; the comment says so. |
| 3 | Evidence on the claim timeline | **Fetch the run on click**, with pending, retry and empty states | One cached run on request is not N+1. `ClaimDetail` carries ids only. |
| 4 | CDT descriptions | **Static table** (`src/lib/cdt.ts`); unknown code renders `—` | A display label for a code set, not a server number. The API sends no CDT name. |
| 5 | OutageBanner | **`GET /_world/payers`** | `/_world/status` never existed. `InjectIn` has no Vyne event, so the contract cannot stage the outage spec 05 names. |
| 6 | Fields OpenAPI marks optional | **Normalise at the edge**: `runViewOf` for runs, `??` in selectors for rules | `.required()` would hand-patch a generated cascade. See Consequences for the API fix. |
| 7 | Names in `schema.ts` | **Keep aliases** | `*Out` is a server convention the client has no use for; each alias is one `tsc`-checked line. |
| 8 | Days in A/R at demo step 10 | **Re-baseline the e2e to 26** | The server's number. Wednesday: ($75,500 + $33,100) ÷ $4,020 = 27.0. Thursday: ($70,869 + $33,100) ÷ $3,974 = 26.2. `real.contract.ts` recomputes both from the API's own KPIs, so this is derived, not copied from the app's output. |

**Strictness follows how a failure shows.** REST objects stay `.strict()`: a mismatch is loud, an inline `schema_mismatch` on the screen. SSE frames are lenient: a mismatch is a silently dropped frame. `event: advance` is the sharpest case, because it ends an advance and polling is off while the firehose is live, so dropping it would spin the sidebar forever. API and web are generated from one snapshot in one repo and neither is deployed, so an additive field cannot reach the web unannounced. If they deployed apart, as `infra/` plans (Fly and Vercel), REST should move to strip-and-log.

**Integer cents.** `openapi-zod-client` drops `.int()` inside a union, so `gen-api.mjs` restores it on nullable `*_cents` fields before formatting. `generated.ts` remains exactly what `pnpm gen:api` writes, and `pnpm check:api` regenerates and diffs.

**Estimate or final.** `MoneyMath` compares `patient_est_cents` with `patient_resp_cents` rather than branching on `basis`, a free-text string: the API sends them equal once an 835 is final.

**W5 and W6 were the test environment.** jsdom replaces `AbortController`, and Node's `fetch` refuses a foreign signal, so every query or stream that passed one failed on Node 24. `src/test/setup.ts` restores Node's class. No assertion changed.

## Checked and dropped

The red team flagged a client-side `-0` printing `-$0.00`. `lib/format.ts` guards it (`cents < 0`, and it formats the absolute value), and `MoneyMath.test.tsx` pins it.

## Consequences

- `pnpm test:contract` needs `uv` and the API's environment, so it is separate from `pnpm test`. It is not yet in CI.
- Mock Thursday A/R reads $73,220 where the API reads $70,869. Both round to 26 days, so a basis line differs between modes on one screen.
- **Recommended, not done (API):** `json_schema_serialization_defaults_required` would make the document true for `default_factory` fields. Its cost lands here: those fields become required, so every fixture that omits one stops compiling until `wire.ts` or the fixture changes.
- Plan and full option lists: `docs/adr/worker-notes/web-contract.md`.
