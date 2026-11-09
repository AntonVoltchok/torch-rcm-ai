# d1-api-2 (D1 phase 3, API + contract): hand-over

Branch `claude/laughing-gould-c20a50`, based on `feat/d1-dashboard` @ 761943f. Not pushed. Decisions: `docs/plans/d1-build.md`, "Phase 3 (api) notes".

## Done

| Item | Fix | Test |
|---|---|---|
| Tier gap | `policy.unreviewed_text()`: text a step sends (`RecipeStep.sends_text`) must be the approved `review_draft` body. Triage: row 9 proposes as `review_draft`; approval: row 1 refuses. Approval runs send the item's held draft (`ApprovedPlanPlanner.draft`). Seed #4733 draft gained `audience` (it was being dropped). | `tests/adversarial/test_reprocessing_text.py` (policy rows, the reviewed note goes out, a draft planted on #4705 never reaches the payer) |
| #4772 `then` | An executed action's `then` (`catalog.actions.follow_up`) becomes its own action in the same run, decided by Policy, run only if its parent ran (`group.after`). `world.sim.receive_records` marks a partial claim in flight. | `tests/test_then_followup.py`; `test_d1_values` lands == claim_outcome.move_to |

Checks at 18a764e: API tests 572 + 12 new green, `make eval` OK (no cassette touched), ruff/mypy clean, web typecheck/lint clean, `parity.test.ts` green (fixture regenerated; `mocks/d1.ts` mirrors `follow_up`, the new #4772 label and touches).

## Not done yet

Items 3 (headline, learnable, Confidence k/n, 409 `claim_busy`, Inbox rendering) and 4 (mock post-run move parity). Leans are in the plan; the session that takes them over finishes this note.
