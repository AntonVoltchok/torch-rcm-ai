"""01-domain-model invariants after seed, after the Thursday advance and after the Friday advance."""

from __future__ import annotations

import asyncio
from datetime import datetime

import pytest

from conftest import FRIDAY_0710, THURSDAY_0710, snap
from torch_rcm.domain import invariants as inv
from torch_rcm.domain.entities import (
    Claim,
    InboxItem,
    Practice,
    Remittance,
    Rule,
    RuleProposal,
    Run,
    User,
    WorldCallLog,
)
from torch_rcm.domain.enums import AckStage, AttachmentSource, ClaimStatus, MoveWho, Role
from torch_rcm.readmodels.claims import is_open, strip, summarize
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.runtime import Runtime


def move_totals(s: Snapshot, user_id: str) -> list[str]:
    """D1's whose-move numbers add up (plan d1-build decision 1): one `moves` row per MoveWho summing to the open
    claims, each row's `by_status` summing to it, every tile's `by_holder` summing to the tile, and the rows agreeing
    with each open claim's own `move`."""
    st = strip(s, user_id)
    out: list[str] = []
    if [m.who for m in st.moves] != list(MoveWho):
        out.append(f"{user_id}: moves rows {[m.who for m in st.moves]}")
    if (sum(m.count for m in st.moves), sum(m.cents for m in st.moves)) != (st.open_count, st.open_cents):
        out.append(f"{user_id}: moves sum != open_count/open_cents")
    out += [f"{user_id}: {m.who} by_status" for m in st.moves if sum(b.count for b in m.by_status) != m.count]
    out += [f"{user_id}: {t.status} by_holder" for t in st.tiles if sum(h.count for h in t.by_holder) != t.count]
    per_claim = dict.fromkeys(MoveWho, 0)
    for c in s.of(Claim):
        if is_open(c):
            per_claim[summarize(s, c).move.who] += 1
    if per_claim != {m.who: m.count for m in st.moves}:
        out.append(f"{user_id}: moves {[(m.who, m.count) for m in st.moves]} != claims' move {per_claim}")
    return out


def assert_all(s: Snapshot, calls: list[WorldCallLog]) -> None:
    owners = {u.id for u in s.of(User) if u.role is Role.OWNER}
    tiles = {t.status: t.count for t in strip(s).tiles}
    flagged = {c.id for c in s.of(Claim) if s.needs_action(c.id)}
    rules = {r.id: r for r in s.of(Rule)}
    checks = {
        "remit lines balance": inv.remit_lines_balance(s.of(Remittance)),
        "claim lines balance": inv.claim_lines_balance(s.of(Claim)),
        "strip = group by": inv.strip_equals_group_by(s.of(Claim), tiles),
        "needs_action ⇔ open item": inv.needs_action_iff_open_item(s.of(Claim), s.of(InboxItem), flagged),
        "would_have_run ⇔ observe": inv.would_have_run_iff_observe(s.of(Run), rules),
        "rules valid": inv.rules_valid(s.of(Rule), owners),
        "guarded proposals": inv.guarded_proposals_unaccepted(s.of(RuleProposal)),
        "no agent tier 3": inv.no_agent_tier3(s.of(Run)),
        "unique keys": inv.unique_idempotency_keys(s.of(Run), calls),
        "paused": inv.nothing_ran_while_paused(s.of(Practice)[0], calls),
        "moves add up": move_totals(s, "usr_dana") + move_totals(s, "usr_morgan"),
    }
    assert {k: v[:3] for k, v in checks.items() if v} == {}


def test_invariants_after_seed(canonical: Snapshot, canonical_world) -> None:  # type: ignore[no-untyped-def]
    assert_all(canonical, canonical_world.of(WorldCallLog))


def test_inbox_badge_equals_open_items_and_activity_awaiting(canonical: Snapshot) -> None:
    from torch_rcm.readmodels.activity import activity

    s = strip(canonical, "usr_dana")
    assert s.inbox_open == len(canonical.open_items) == activity(canonical).summary.awaiting_you == 12
    assert s.inbox_claims == len({i.claim_id for i in canonical.open_items if i.claim_id})


def test_every_claim_is_built_at_checkout_after_its_visit(canonical: Snapshot) -> None:
    early = [
        c.number
        for c in canonical.claims.values()
        if (v := canonical.visits.get(c.visit_id or "")) is not None and c.built_at < v.completed_at
    ]
    assert early == []


def test_every_claim_happens_in_order_visit_built_sent_acked_remitted(canonical: Snapshot) -> None:
    """visit completed ≤ built ≤ sent ≤ acks ≤ remitted, for every claim in the seed. A resent claim (#4860, the
    first file rejected at Vyne) keeps its first acks before `sent_at`, so the newest 999 is what follows the send."""
    remitted: dict[str, list[datetime]] = {}
    for r in canonical.of(Remittance):
        for line in r.lines:
            if line.claim_id:
                remitted.setdefault(line.claim_id, []).append(r.received_at)
    out: list[str] = []
    for c in canonical.claims.values():
        v = canonical.visits.get(c.visit_id or "")
        acks = sorted(a.at for a in canonical.acks_by_claim.get(c.id, []))
        files = sorted(a.at for a in canonical.acks_by_claim.get(c.id, []) if a.stage is AckStage.FILE_999_OK)
        if v is not None and c.built_at < v.completed_at:
            out.append(f"#{c.number} built before the visit completed")
        if c.sent_at is not None and c.sent_at < c.built_at:
            out.append(f"#{c.number} sent {c.sent_at:%m/%d %H:%M} before it was built {c.built_at:%H:%M}")
        if acks and (c.sent_at is None or acks[0] < c.built_at):
            out.append(f"#{c.number} acked {acks[0]:%m/%d %H:%M} before it was built or sent")
        if files and c.sent_at is not None and files[-1] < c.sent_at:
            out.append(f"#{c.number} last 999 at {files[-1]:%H:%M} precedes the send at {c.sent_at:%H:%M}")
        for at in [*remitted.get(c.id, []), *([c.paid_at] if c.paid_at else [])]:
            if c.sent_at is None or at < c.sent_at or (acks and at < acks[-1]):
                out.append(f"#{c.number} remitted {at:%m/%d %H:%M} before it was sent or acked")
        for att in c.attachments:
            if att.source is AttachmentSource.AGENT and att.created_at < c.built_at:
                out.append(f"#{c.number} agent attachment {att.id} predates the build")
    assert out == []


def test_no_tier3_rule_leaves_human_only(canonical: Snapshot) -> None:
    tier3 = [r for r in canonical.of(Rule) if int(r.tier) == 3]
    assert len(tier3) == 3
    assert all(r.mode.value == "human_only" for r in tier3)
    rule = tier3[0].model_copy(update={"mode": "auto"})
    with pytest.raises(inv.InvariantError):
        inv.check_rule(rule)


def test_tier2_auto_rule_needs_owner_signature(canonical: Snapshot) -> None:
    rule = next(r for r in canonical.of(Rule) if r.id == "rule_t2_post_era").model_copy(update={"signed_by": None})
    with pytest.raises(inv.InvariantError):
        inv.check_rule(rule)


@pytest.mark.parametrize("until", [THURSDAY_0710, FRIDAY_0710])
def test_invariants_after_advance(rt: Runtime, until) -> None:  # type: ignore[no-untyped-def]
    asyncio.run(rt.scheduler.run_due(until))
    s = snap(rt)
    assert_all(s, rt.store.all(WorldCallLog))
    assert s.now == until
    assert any(c.status is ClaimStatus.DENIED for c in s.of(Claim))
