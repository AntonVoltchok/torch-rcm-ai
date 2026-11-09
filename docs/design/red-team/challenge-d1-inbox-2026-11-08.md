Red team, written by a subagent given the eight leans, the hard rules, decision 5 and the prototype; not given the implementation.
Persona: hiring Director of Engineering (front-end state), with a dental billing lead on workflow.

## 1. The eight leans

1. **Headline: keep A.** The billing lead files work the way the title reads. An empty `summary` renders nothing. Never split `title` on "·". Record the `headline` gap.
2. **Track record: change.** Show `pct` ("92%"), then `basis` as sent. Drop the regex that bolds "N of M": `Confidence` has no `n`/`k`, so it parses English. Record gaps for `n`/`k`, and for "no base rate (n = 4)", which is dev-speak.
3. **Learnability: change.** Hiding the link by tier is the browser deciding, which is what the lean rejects. Hide it only on tier 3, which is human-only by definition. Show it on tiers 1 and 2 whenever there is a `rule_id`, worded as the action it is ("Propose always auto-run"). The inline `root_cause_guard` refusal on a "Root cause: ours" item is the best proof the guard is real.
4. **Run owns the pane: keep, with a fix.** `changes` exists only in the `ApproveOut` response. Keep each launch and its `changes` in the query cache, keyed by launch id, so "Runs you started" can set `?launch=` again and show the full pane. On a cold load of `?launch=`, rebuild steps and batons from GET run, and say the before/after is unavailable.
5. **Lock scope: change.** This tab's launches miss rule-triggered runs and other tabs. Lock when `item.claim.move.who === 'agents'` (a server fact covering queued, running and paused runs), or when this tab has a non-terminal launch run on the claim. The toast uses `move.label`: "Agents paused" is not "still working". Lock Reject and Snooze as well, and disable Approve while its mutation is pending.
6. **Blocked section: change.** "Dr. Morgan signs" in the header is a hard-coded fact. Make the header "Not yours to do", with each row's own `signer_note`. The switch target comes from the users whose role is `required_role`. Keep `signer_note != null` as the test, behind one `isBlocked` selector.
7. **Failure (#4851): change.**
   - Find "Back to …" by `item.run_id === run.id`, not by claim.
   - After a failure, hide the approve-time `changes`. "Inbox 12 to 11" is false once the item has come back.
   - Add the per-item outage note the shell red team handed to this phase, copied from the failed step's `output_summary`. The client never writes "portal is down".
8. **Not built: keep.** Tab counts are badges, and badges come from the server. Add a test that `InboxList.total` equals `strip.inbox_open` on the canonical seed, and decide whether a group counts as 1 or as N.

## 2. Three likely failures in front of a reviewer

1. **Reloading breaks the pane.** The URL is the stated source of truth, and a reviewer will reload mid-run or paste `?item=…&launch=…`. Without a cold-load design they get a blank "What changed", a selection that is already resolved, or J/K moving from an item no longer in the list.
2. **Duplicate runs.** Two tabs, a persona switch or a double-click on Approve can start two runs on one claim, because a client-side lock is only UX. The server must answer 409 for a claim with an active run, and Approve must send an idempotency key. If it doesn't, record a contract gap.
3. **Small facts the client made up.** A reviewer grepping for literal names and `.match(` finds them all:
   - a hard-coded signer name;
   - the bolding regex;
   - "Back to …" matched by claim;
   - approve-time `changes` shown after a failure;
   - stripping the "root cause: ours:" prefix from `audit_note`;
   - D1's draft header "cannot be recalled", which must come from `touches`.

## 3. Missed, must handle

- **Focus.** When the run replaces the pane, move focus to its heading. Use one polite `aria-live` summary, not one announcement per step. Move focus to Next when the run is done. J/K/A do nothing while a text field has focus.
- **A group launch with mixed results.** When one of three runs fails, each row needs its own baton and its own "Back to …".
- **Connections.** N SSE streams plus polling can hit HTTP/1.1's per-origin limit. Use one stream per launch.
- **Cache.** Write `meta.counts` into the strip cache with `setQueryData`, then invalidate inbox and claim. Never patch counts on the client.
- **Untrusted text.** Evidence excerpts and draft segments render as text, never HTML. Show `suspicious_evidence`.
- **Tier-2 draft.** Render the server's segments and their citations. Uncited segments say so.
- **A persona switch or a clock advance mid-run.** The pane says whose launch it is, and the lock re-reads from the refetched `move`.
