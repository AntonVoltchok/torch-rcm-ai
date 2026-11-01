# Red team — Round 5 (denials & appeals A/B/C; claim creation decided; settings/payments fixes) — 2026-10-31

Written as a red team by an independent subagent (role: dental insurance appeals specialist, 10 years at an RCM services company then two years in payer claims review). Given: Round 5 mocks, the three earlier red-team reports, and Claude's lean (A surface, B detail, C folded into Cash) with instructions to attack it.

## My recommendation

A as the surface, B as the detail, but with one structural change Claude's hybrid misses: split "appeal" into two paths with different tiers. Most of what a dental office calls an appeal is a **reconsideration** (records response, tooth-history correction with the payer's own EOB, COB resubmit, reprocessing request) that Dana files through the portal in ten minutes and nobody signs. A **formal appeal** attests clinical facts, burns an appeal level, and the treating dentist signs it. The worklist should be grouped by what happens next, with "ours vs theirs" as a tag feeding the pattern cards, not the grouping. C's matrix and upstream-rule cards go in the sidebar; its EV table does not go anywhere.

The single strongest reason: the path is decided by the group code and RARC on the 835 (CO vs PR, N29 vs M127 vs M86), not by whose fault it was. Two of the six sample cases are routed to the wrong path because the mock asks "ours or theirs" first.

## The strongest case against each option

**A.** Ours/theirs grouping puts a CO-16·M127 records request (Castillo) on the formal-appeal path, and files it as tier 3 through the owner. In my old shop a biller who formal-appealed a missing-records denial got retrained; it adds 30–45 days, often comes back "not an appealable determination," and uses the one level you'll need if the clinical review downgrades it. The "Appeal by" column is also one number for three deadlines (timely filing for resubmits and corrected claims, payer appeal window for appeals, nothing for patient transfers). I would refuse to work a queue where the deadline column lies on seven of ten rows.

**B.** It stages a formal appeal for a tooth-history error. Delta's own 03/2022 EOB says #31; that is a portal claim inquiry with one attachment, answered in two weeks, no dentist signature. B sends it to Dr. Morgan, adds a 30-day cycle, and shows "78% · 7 of 9 alike" when A's sidebar says this practice has had four Delta frequency denials in twelve months. B also makes the owner sign for every claim, including Dr. Lee's; the attesting signature belongs to the rendering dentist.

**C.** The EV table is fake precision that produces wrong decisions: Morris CO-29 at "2% win" ignores that the practice holds a dated payer 277CA from 11/2025, which is exactly the proof a timely-filing appeal needs. C also says "if the Ito test appeal wins, the 8 earlier claims are reprocessed too." They are not; each claim is reopened separately, each on its own clock. And "denial rate 6.2%" counts max-met and alternate benefits, which no benchmark counts.

**Claude's hybrid.** It inherits A's grouping and B's one-size tier, so Dana learns to label things "resubmit" to avoid the doctor and the real appeals wait behind $43 downgrades. It also folds C into Cash, where the only person who sees "Guardian counts teeth ≥ 5 mm" is the owner, not the hygienist who charts.

## The three most likely ways the recommended model fails

1. **The classifier picks the path and nobody checks the code.** A CO-16 becomes an appeal, a CO-22 becomes tier 1 even though it rewrites the patient's coverage order in the PMS (tier 2 by the product's own definition). Hurt: the practice, in burned appeal levels and a payer audit for unsigned coverage changes. Dana would export to a spreadsheet. Interviewer spot: "Why is Castillo an appeal and not your tier-1 records-request rule?"
2. **Appeals in flight have no tracker.** "Appealed 3 · $1,920 awaiting payer" is a count with no level, method, reference, or follow-up date. Appeals die in "awaiting" when the payer asks for more records and nobody sees the letter. Hurt: the owner, at day 181. Interviewer spot: click the tab.
3. **One claim, three queues.** Foster's doubled deductible is a held line in Payments, a row in Denials, and an Inbox item; Park's max-met is a posting-agent transfer and a Denials row. Billers work it twice or assume someone else did. Interviewer spot: open Foster from Payments and from Denials and ask which one closes the other.

## What I would change in the denials screens

**Cases handled wrong.** Castillo (#4797): path is "send records · 10/09 chart + FMX via NEA," tier 1, and the outcome is a new 835 line with SVC06 carrying the submitted code (`SVC*AD:D4342*320*118.40**1*AD:D4341`), not "Appealed → Partial." Morris (#3561): file a timely-filing appeal with the 11/2025 payer 277CA as proof of receipt before any write-off; if upheld, the write-off is ours, non-contractual, and the patient cannot be billed; say so on the row. Webb (#4733): level 1 claim inquiry with Delta's EOB, Dana, tier 1; escalate to a signed appeal only if Delta holds. Moreno (#4800): tier 2, because the PMS coverage order changes, and the deadline that matters is MetLife's timely filing on the new primary claim, not "174 d." Park and Duarte are right, but they belong to Payments, not Denials. Handled right: Kaur corrected claim, tier 2.

**Agent drafts vs human writes.** The agent may draft anything sourced to a document: dates, ICNs, EOB citations, policy clauses with a linked source and retrieval date. Clinical paragraphs quote the signed note verbatim; if the note does not say "MB cusp fracture," the letter cannot. The rendering dentist signs clinical appeals; the owner does not sign for Dr. Lee.

**Levels and deadlines, seeded in Settings › Payers with a source.** Commercial PPO: reconsideration (portal/phone, inside timely filing) → formal appeal (180 d from EOB, consultant review, ~30–45 d) → second level per contract (often 60 d from the decision). Self-funded ERISA (Guardian TPA, Aetna ASO): 180 d by regulation, two levels, often requires the patient's authorization for a provider appeal. NY Medicaid managed care: 60 d. The row shows "180 d · from EOB 10/16 · Delta DPO manual," never a bare number.

**What overturned looks like on the 835.** No CARC says "appeal won." A new CLP arrives on some later EFT, new payer ICN, `REF*F8` pointing at the original, paid lines with CO-45 and PR-2. Reprocessing of a paid claim is a CLP02=22 reversal pair plus the corrected claim; the posting agent must post both, not the net. Upheld produces no 835 at all, only a letter, so the tracker must poll.

**The letter.** Must have: member ID, group, ICN, DOS, CDT and tooth, denial date and codes, the specific request ("correct tooth history and reprocess"), exhibits numbered, signer's NPI/TIN, appeal level, and whether filed as the patient's authorized representative. Must not have: other patients' claims (C2's "8 earlier claims"), hardship language, necessity boilerplate, a typed signature on a draft, or a policy clause without a source link.

**Buildable this week.** Typed deadline column (timely · appeal · none). Path chips with tier per path, and a "reconsideration vs appeal" toggle. A "if we lose, patient can / cannot be billed" line per row from the group code. An Appealed tab: level, method, filed, reference, response due, next check. SVC06 on the outcome panel.

## Today's claims and the revised Settings/Payments: what's still wrong

- Inbox math: Wednesday ends at 13 (Lindgren), Thursday says 15 = "Wednesday's 12 + 3."
- Wednesday's strip has Denied 5 and no Partial or Appealed tile; Thursday's has Denied 8 · Partial 5 · Appealed 3. Same practice, two models.
- Ortega UR "$320 · not billed" counts in "held 4 · $1,860." Unbillable is not held.
- Akers secondary shows timely filing from DOS; most payers run secondary timely filing from the primary EOB date. Label which.
- Readiness check 6 reads PMS history only. Webb proves payer tooth history is the one that denies; check the portal where available.
- Appeal history disagrees three ways: sidebar 2 of 4, B 7 of 9, C 6 of 9 won. Pick one.
- Settings "Any appeal · Never" cannot coexist with "records request → NEA · auto-run" until the product defines which is which.
- Castillo's agent proposes "Guardian counts ≥ 5 mm" from one outcome. That is the n=1 learning the Round 3 team warned about.

## What to keep

The decoded 835 line with LQ*HE and plain English. "What we claim vs what they said." Paragraph-to-exhibit mapping and the "what you are attesting" sign card. The ours/theirs tag as a guard against auto-fixing our own bugs. The turned-into-prevention outcome (C3) as a pattern card. The typed send method with reference saved to the claim. The Castillo partial outcome arithmetic, which balances.

---

## Decision taken (Claude, 2026-10-31)

Adopted the red team's recommendation: **A's worklist as the surface, grouped by next action (not ours/theirs), with "appeal" split into *reconsideration* (portal/records/tooth-history/COB resubmit/reprocessing — Dana, tier 1, or tier 2 when it changes PMS coverage order) and *formal appeal* (attests clinical facts, burns a level, rendering dentist signs — tier 3).** B's workbench is the row-level detail for formal appeals only, with the letter rules above (sourced facts only, clinical text quoted from the signed note, rendering dentist's NPI, no other patients' claims). C's payer × reason matrix and upstream-rule cards live in the worklist sidebar; the EV table is dropped. Typed deadlines (timely · appeal · none, with source), an Appealed tracker tab (level, method, reference, response due, next check), "if we lose, patient can/cannot be billed" per row, and a "one claim, one queue" rule (Foster and Park close from Payments; Denials shows a link, not a duplicate). Reason: the 835 group code and RARC decide the path, and most "appeals" are ten-minute reconsiderations that must not burn an appeal level or a dentist's signature.
