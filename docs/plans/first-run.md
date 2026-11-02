# First run — failure inventory (2026-11-02)

Recorded before any fix, from a clean `uv sync` / `pnpm install` on the owner's laptop (macOS arm64, Python 3.13.18, Node 24.21, pnpm 10.28 via `packageManager`, uv 0.13.6). Fold into `docs/adr/worker-notes/` when the pass lands; delete this file.

## Clean on first run

`uv sync`, `ruff check`, `ruff format --check`, `torch seed --force`, `torch openapi` (48 paths, 147 schemas), `torch eval` (OK in both modes), `pnpm install`, `pnpm gen:api`.

## API

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

## Web

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

## Environment

Node 24 here versus 22 in CI. `act` is not installed. No `ANTHROPIC_API_KEY` in the environment or in `.env`, so step 4 (real cassettes) is blocked unless one appears.
