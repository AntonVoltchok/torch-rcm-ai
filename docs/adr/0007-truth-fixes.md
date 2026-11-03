# ADR-0007 — Truth fixes: why an item stopped, and routine runs beside decisions

Status: accepted · 2026-11-02

## Context

The UX audit (`docs/design/ux-audit-2026-11-02.md`) and its red team found defects that ship whichever redesign wins: a review draft nobody could read, nothing saying why an item reached a person, and screens that disagreed. Two fixes could reasonably have gone another way.

## Decisions

**`stopped_by` is built on the server.** Inbox items carry one sentence on why they reached a person. A run now stores the policy's own reason in `payload.policy_reason`, and the read model turns it into a sentence. Seeded items predate that, so their tier, kind and rule say it instead.

The web only displays the sentence. The alternative was a client mapping from tier and rule mode, which would restate policy in a second place and drift. The Policy layer stays the only thing that decides, and the only thing that explains.

**Routine runs are shown beside decisions, never added to them.** Activity reported 1 payer call while Settings showed that rule ran 0, because status checks and payer calls are routine, not decisions. Adding them to `ran_without_review_7d` would make the rows sum past the 41 of 53 that the Inbox, Activity and the preview all rest on. So `routine_runs_7d` is a new field and the row reads "1 routine". The rows still sum to the decisions that ran (tested).

## Smaller calls

- **Evidence cards show the captured words.** No images exist in the world, so the gray wireframe and gradient "x-ray" went. A drawn stand-in is a fake on the trust surface. Internal ids such as `img_diaz_f_1019_pa_14` are hidden; ICNs and call references stay.
- **A row with a signer is tier 3.** The path's default tier is only the default.
- **`last_file_time` counts today's sent claims,** because seeded sends carry their file time on the claim with no file entry.
- **The Delta 10:45 and 11:15 files are not a disagreement.** Both exist. The resubmit's NEA# arrives after the 10:44 cut-off, so it leaves at 11:15 (`test_scheduler.py`). The red team's claim was wrong, and nothing changed.
- **`E2E_API_BASE`** points the real-stack demo's reset at a chosen API, so the suite can run beside a live `make dev` without resetting it.
