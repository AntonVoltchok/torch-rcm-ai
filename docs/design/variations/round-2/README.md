# Round 2 variations: how a variation is built

The owner picked variation D in round 1 and liked its Inbox, Claim and Denials. This page compares the original, D and two restyles of D (D1, D2). The product is named TorchRCM in everything people see. All use the same real seed data and simulated actions, so differences are design, never content. Build with `python3 build.py fixture/data fixture/shots`. Published as a private artifact: https://claude.ai/artifact/FrNNQtYKNHQcBxhF7JSDUK. The owner's likes and tags are in its `feedback` collection. 

## Writing a variation

Create `variants/<id>.js` calling `TorchProto.register(def)`. Each variation mounts in its own Shadow DOM at a **fixed 1440×900**, so your CSS cannot leak and nothing outside can leak in. `render` returns an HTML string and is called on every state change. Do not attach listeners; use `data-act`.

```js
TorchProto.register({
  id: 'a', name: 'Biller’s view', tagline: 'one line, plain, shown in the picker',
  premise: 'two sentences: the idea, and who it serves',
  proves: ['H4', 'S1'],       // audit findings it must fix
  serves: 'Demo steps 1, 2, 3',
  fonts: 'https://fonts.googleapis.com/css2?family=...&display=swap', // optional
  autoOpen: true,             // open the first item Dana can act on. false = you design the empty state.
  css: `...`,
  render(s, h) { return `<div class="app">...</div>` },
})
```

Your root element must be exactly 1440×900 with `overflow:hidden` and an explicit background. Scroll inside panes, and give each scrolling pane `data-scroll="name"` so its position survives re-renders. Re-render resets CSS transitions, so use keyframes for entries, and respect `prefers-reduced-motion`.

## `s`: the view state

| Field | Meaning |
|---|---|
| `s.screen` | `'inbox'`, `'claim'` or `'denials'` |
| `s.items` | Open items, server priority order. Each has `.id .kind .tier .cents .agent .claim .patient .recommendation .summary .confidence .evidence .draft .deadline_on .root_cause .audit_note .plan_steps .required_role .record .noRecord .copy` |
| `item.copy` | Plain language: `.who .treatment .headline .why .action .stoppedBy .touches[] .signerNote .doneLine` |
| `item.record` | The track record sentence ("23 of 25 … paid within 30 d"), or null. Lead with this, not the percent. |
| `item.noRecord` | The honest reason there is no record, or null. Never hide it. |
| `item.draft` | For review drafts: `[{text, cites:[title]}]`. **Must be shown**, sentence by sentence with its citations. |
| `item.evidence` | `[{title, excerpt, source, captured_at, ref, kind}]`. `ref` is safe to display. Show the excerpt as text. **Do not fake thumbnails.** |
| `s.mine` | Items this user can act on |
| `s.waitingOnOwner` | Items only Dr. Morgan can sign (tier 3). As Dana, #4611 is here. |
| `s.queue` | Filtered list: `{type:'item', item}` or `{type:'group', key, title, items, count, cents, copy, open, top}`. `group.copy` has `.headline .why .action .stoppedBy .touches[]` |
| `s.selected`, `s.group` | Current item, and its group if any |
| `s.nextItem` | What comes after this one |
| `s.tabs`, `s.filter` | Filters: `{key,label,count}` |
| `s.reconcile` | `{claims, visits}`: "12 items: 9 claims, 3 upcoming visits" |
| `s.strip` | `.tiles[{status,label,count,cents,flagged}] .inbox_open .inbox_open_cents .open_count .ar_cents .flagged_count` |
| `s.week` | `{decisions:53, ranAlone:41, cameToYou:12, statusChecks, payerCalls, claimsSent, remittancesPosted}` |
| `s.run` | The live or last run: `{title, steps:[{text,detail,state}], done, failed, failedText, doneLine, ids, changes:[{label,from,to,note}]}`. Step state is `pending active done failed`. |
| `s.claim` | Full claim: `.claim .provider_name .location_name .coverage .lines .attachments .acks .denial .deadline .money .timeline .timely_filing_due .openItems .queued` |
| `s.denials` | `.groups[{label,count,cents,rows[]}] .total .in_flight`. Rows: `.claim .carc .rarc .decoded .root_cause .next_action .agent .signer .deadline .patient_billable_if_lost .item .resolved` |
| `s.activity`, `s.activityGrouped` | Real run rows; grouped collapses identical runs (`.count .subjects[]`) |
| `s.claimsList` | Real non-inbox claims for agent and payer lanes |
| `s.agents`, `s.clock`, `s.outage`, `s.user`, `s.users`, `s.toast`, `s.from` | As named |

## `h`: helpers

`h.esc(v)` (use it on all data), `h.money(cents)`, `h.date(iso)` → `10/12`, `h.dateYear(iso)`, `h.time(iso)`, `h.daysUntil(iso)`, `h.gloss(code)` (an `<abbr>` with the plain meaning, for T1, BWX, N29…), `h.agentName(key)`, `h.move(claim)` → `{who:'you'|'agents'|'payer'|'nobody', label}`, `h.policy(item)` → `{rule, canLearn, reason, preview:{from,to,total,held,net}}` or null.

## `data-act`: everything clickable

`select:<itemId>` · `group:<key>` · `approve:<itemId>` · `approve-group:<key>` · `reject:<itemId>` · `snooze:<itemId>` · `next` · `dismiss` · `filter:<key>` · `nav:inbox` · `nav:denials` · `nav:<Anything else>` (shows "not part of this round") · `open-claim:<claimId>` · `back` · `user:<userId>` (`usr_dana`, `usr_morgan`).

Keyboard is handled for you: `J/K`, `A`, `⇧A`. Show them discoverably, not as a permanent footer.

After `approve`, nothing is selected and `s.run` is set, so **the run owns the pane until `s.run.done`**. Then offer `next`. This is deliberate: never arm another item's approve button under a running job (audit R2).

Approving **#4851 fails on purpose** at the Cigna portal step. Every variation must render that well.

## `data-part`: what can be tagged

Mark regions with `data-part` so the owner can tag them. Use these names so tags compare across variations, and swap cleanly into a hybrid:

- Shell: `shell.nav` `shell.header` `shell.agent-summary` `shell.pipeline` `shell.outage` `shell.demo-controls`
- Inbox: `inbox.queue` `inbox.queue-row` `inbox.group` `inbox.decision` `inbox.why-stopped` `inbox.recommendation` `inbox.draft` `inbox.evidence` `inbox.action-bar` `inbox.policy` `inbox.run` `inbox.after-state` `inbox.empty`
- Claim: `claim.header` `claim.open-item` `claim.money` `claim.denial` `claim.timeline` `claim.lines` `claim.side`
- Denials: `denials.summary` `denials.row` `denials.deadline` `denials.action` `denials.side`

## The floor for every variation

Fix these or the comparison is about skins (from `docs/design/ux-audit-2026-11-02.md`, which you should read):

1. **Whose move.** Every claim says who it is waiting on.
2. **Type:** a real scale with visible steps. Nothing under 12px. Bold means something.
3. **Colour:** action, agent and money-at-risk are separate hues. Tiers are neutral. Text passes WCAG AA, 4.5:1.
4. **One filled action** on a decision screen, next to the decision, naming what happens: "Send 3 x-rays and resubmit", never "Approve & run". Show `copy.touches`.
5. **Blocked items say so in visible text.** As Dana, #4611 shows "Dr. Morgan signs this" and why (`copy.signerNote`), and is not presented as her next task. Offer `user:usr_morgan` as a way to switch.
6. **Why it stopped at me:** show `copy.stoppedBy`.
7. **Evidence stays on the page.** Real excerpts. Never placeholder images or raw ids.
8. **After-state:** the run streams visibly, then shows `run.changes`. "Denied stays 5" must be legible. Failure is as well designed as success.
9. **Draft text is visible** on #4733, with citations. It is the only way to review it.
10. **"Always auto-run":** when `h.policy(item).canLearn` is false, say so up front. Don't offer then refuse. It can be a good demo moment.
11. **Strip stays visible,** compressed. Show `Denied 5`. Reconcile "12 items" with `s.reconcile`.
12. **"Root cause: ours" stays uncomfortable.** Keep the claim number beside the name: there are two Diazes and two K. Owenses.
13. **On the claim:** Allowed and Patient are estimates on a denied claim, so label them. The fix and outcome must not be hidden by the timeline fold, so consider newest-first or anchoring.
14. Persona and clock stay one click away, tidily. The Cigna outage stays visible but quiet.
15. **Hard rules:** no vendor names beyond the payers, Vyne and NEA. The PMS is "the PMS". Tier 3 is human-only.

## Design rules

Follow the frontend-design guidance: distinct, deliberate, specific to dental billing. Avoid the AI tells: cream + serif + terracotta, near-black + acid green, broadsheet hairlines, identical rounded cards with soft shadows, gradient washes, tracked-out all-caps eyebrows on everything, chains of middle dots, `→` on buttons, monospace for small labels, numbered 01/02/03 markers. Copy is plain, sentence case, active voice. No emoji.

Do not change `src/`, `copy.json` or anyone else's variation.
