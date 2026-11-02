# Web contract pass: judgment calls (first run, 2026-11-02)

Historical: the plan as sent to the red team, kept verbatim below this line. Outcome in ADR-0005. The "not committed" harness below is now `pnpm test:contract`; the comparison with `PAYER_NAME` in call 4 did not survive (the API sends payer names and no CDT names).

`schema.ts` now re-exports `generated.ts`, and the web app is green against the real API contract. These calls were made on the way. Options and lean below; the red team decides.

Evidence: 535 real API responses and every SSE frame of one approve-and-advance session parse under the schemas (scratch harness, in-process API, not committed). Mock-mode Playwright passes 3 of 3.

## 1. `public/mockServiceWorker.js` (W8)

`pnpm.onlyBuiltDependencies` now allows msw's postinstall, which writes the file. `public/` is copied into `dist`, so it ships in the production build either way.

- A. Commit it. MSW's own recommendation; works under `--ignore-scripts`; a diff appears only when msw is upgraded.
- B. Generate it and gitignore. No generated file in the repo; depends on the postinstall having run.
- C. Either, plus strip it from the production build.

**Lean: A.** Mock mode then cannot silently break on an install without scripts.

## 2. Types for mock records (`src/mocks/wire.ts`)

The generated schemas' output types make defaulted fields required; fixtures are terse.

- A. `z.input` types for what the mock writes: it is the JSON side of the wire, and the client's parse fills defaults. `wire.test.ts` proves it parses.
- B. Fill every defaulted field in every fixture.
- C. Run fixtures through `.parse()` at load.

**Lean: A.**

## 3. Evidence on the claim timeline

`TimelineEntry` carries `evidence_ids` and `run_id`; `ClaimDetail` has no evidence objects and there is no `/evidence/{id}`. The UI used to render cards inline.

- A. Show "N evidence items"; fetch GET /runs/{id} on click and render the cards (one fetch, on demand).
- B. Ask the API to hydrate evidence on `ClaimDetail`.
- C. Show the count only.

**Lean: A.** Spec 05: no N+1, the timeline comes with the claim.

## 4. CDT descriptions

`ClaimLine` has no description; the design's line table shows one.

- A. A static code-to-name table in the web (`lib/cdt.ts`), like `PAYER_NAME`; unknown code renders `—`.
- B. Ask the API for `ClaimLine.description`.
- C. Drop the column.

**Lean: A.** Not server-computed data; a code set.

## 5. OutageBanner

Written against `GET /_world/status`, which the API never had: a 404 on every load and no banner.

- A. Read `GET /_world/payers` (`portal_down`). Loses "since 10:52"; a Vyne outage stays invisible.
- B. Ask the API for `/_world/status`.
- C. Remove the banner.

**Lean: A**, and report the Vyne gap.

## 6. Fields OpenAPI marks optional that Pydantic always sends

`default_factory` fields (`Run.steps`, `RunStep.progress_lines`, `Rule.scope`, ...) generate as optional. openapi-zod-client also drops a default on an enum `$ref`.

- A. Normalise at the one edge that matters: `runViewOf` for runs, `??` in selectors for rules.
- B. Tighten in `schema.ts` with `.required()`; cascades through every schema that nests them.
- C. Change the API (`json_schema_serialization_defaults_required`) so the document tells the truth.

**Lean: A now**, recommend C to the coordinator.

## 7. Names in `schema.ts`

- A. Keep the app's names as aliases (`StripSummary = schemas.Strip`, `InboxItem = schemas.InboxItemOut`).
- B. Rename every consumer to the API's names; no alias block.

**Lean: A.** About 20 aliases, each one line.

## 8. Days in A/R at demo step 10

Spec 06 and the e2e said 27. The real API says 27 on Wednesday and 26 on Thursday (six paid overnight, and the 90-day production window moves), and the demo reaches Cash on Thursday.

- A. Re-baseline the e2e to 26 and report the spec line (the web worker does not own `docs/spec`).
- B. Make the e2e tolerate either.
- C. Keep 27 and change the mock.

**Lean: A.** Never change a server number to match anything.
