# First-run API pass (2026-11-02)

Folded from `docs/plans/advance-wait.md`. Decision and reasons are in ADR-0004; the options as they stood before the red team are below.

Facts at the time: the spec and hard rule give one shape (async 202); `?wait=true` was unspecified, and its only callers were `tests/test_api_contract.py` (2 sites) and `tests/test_services.py` (the service function). The committed snapshot documented both 200 and 202; the contract table documented only 202.

- **A. Keep and document.** Spec clause, second response in the table, validate by status.
- **B. Remove.** Spec untouched; snapshot loses `wait` and the 200; tests move to the real path.
- **C. Keep but hide.** `include_in_schema=False`.

Worker's lean was B. The red team kept B and added the failure event, stale-row recovery and deterministic wait-then-GET tests (B-plus), which is what shipped.
