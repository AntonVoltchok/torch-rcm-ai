"""An inbox item's approval in words and where its baton lands, from the action catalog (`agents.catalog.phrases`).

`action_label` is the button, `touches` is "What this does", `signer_note` says who signs when the viewer can't, and
`lands` is where the claim's move goes once the approval has run. The approve service and `Run.action_label` use the
same phrase, so the button names what runs.
"""

from __future__ import annotations

from collections.abc import Sequence

from torch_rcm.agents.catalog.actions import follow_up
from torch_rcm.agents.catalog.phrases import PhraseCtx, phrase, touches
from torch_rcm.agents.types import PayerView
from torch_rcm.domain.entities import InboxItem
from torch_rcm.domain.enums import InboxItemKind, MoveWho, RuleAction, Tier
from torch_rcm.readmodels.moves import FILING_ACTIONS, MoveBasis, approver_roles, can_approve, claim_move, signer
from torch_rcm.readmodels.snapshot import Snapshot

ELIGIBILITY_LABEL = "Note it for the front desk"
ELIGIBILITY_TOUCHES = ["Note added for the front desk"]
SIGNOFF_LABEL = "Sign the rule change"
PAYER_REQUESTS = frozenset({RuleAction.REPROCESSING_REQUEST, RuleAction.RECORDS_REQUEST})  # answered by the payer
SIGNER_WHY = {
    "write_off": "Writing off money commits the practice",
    "formal_appeal": "A formal appeal goes out over the treating dentist's signature",
    "void_claim": "Voiding a claim commits the practice",
    "discretionary_refund": "A refund the practice chooses to give commits it",
    "collections_referral": "Sending a patient to collections commits the practice",
    "waiver": "Waiving a balance commits the practice",
}


def payer_view(snap: Snapshot, key: str) -> PayerView:
    p = snap.payers[key]
    return PayerView(key=p.key, name=p.name, short=p.short_name, file_times=tuple(p.file_times))


def phrase_ctx(snap: Snapshot, item: InboxItem, n: int = 1) -> PhraseCtx | None:
    pa = item.proposed_action
    if pa is None:
        return None
    claim = snap.claims.get(item.claim_id or "")
    attach = pa.params.get("attach") or []
    titles = tuple(snap.evidence[e].title for e in attach if isinstance(e, str) and e in snap.evidence)
    return PhraseCtx(
        params=pa.params,
        payer=payer_view(snap, claim.payer_key.value) if claim else None,
        now=snap.now,
        n=n,
        drafted=item.kind is InboxItemKind.REVIEW_DRAFT,
        enclosures=titles,
    )


def action_label(snap: Snapshot, item: InboxItem, n: int = 1) -> str | None:
    if item.kind is InboxItemKind.ELIGIBILITY_FLAG:
        return ELIGIBILITY_LABEL
    if item.kind is InboxItemKind.OWNER_SIGNOFF:
        return SIGNOFF_LABEL
    ctx = phrase_ctx(snap, item, n)
    return phrase(item.proposed_action.action.value, ctx) if ctx and item.proposed_action else None


def item_touches(snap: Snapshot, items: Sequence[InboxItem]) -> list[str]:
    """For one item, or for a group's members (which share their action)."""
    first = items[0]
    if first.kind is InboxItemKind.ELIGIBILITY_FLAG:
        return list(ELIGIBILITY_TOUCHES)
    if first.proposed_action is None:
        return []
    ctxs = [c for i in items if (c := phrase_ctx(snap, i)) is not None]
    return touches(first.proposed_action.action.value, ctxs)


def signer_note(snap: Snapshot, item: InboxItem, viewer_id: str | None) -> str | None:
    """Why someone else signs, when the viewer can't approve this. Names the one signer `moves.signer` names (the
    owner's override is not offered: billing walks an item to its signer, not to whoever is free)."""
    viewer = snap.users.get(viewer_id or "")
    if approver_roles(item) is None or can_approve(snap, viewer, item):
        return None
    named = signer(snap, item)
    who = named.name if named else "the owner"
    action = item.proposed_action.action.value if item.proposed_action else ""
    why = SIGNER_WHY.get(action, "A rule change needs the owner's signature" if item.tier is not Tier.THREE else "")
    return f"{why}, so {who} signs this." if why else f"{who} signs this."


def lands(snap: Snapshot, item: InboxItem) -> MoveWho | None:
    """Where the claim's move goes once this approval has run. Tier 3 sends nothing (a person performs it), so it
    and every non-filing action fall to the whose-move rules with this item resolved."""
    claim = snap.claims.get(item.claim_id or "")
    if claim is None:
        return None
    action = item.proposed_action.action if item.proposed_action else None
    nxt = follow_up(action.value, item.proposed_action.params) if action and item.proposed_action else None
    if nxt is not None and nxt[0] in RuleAction:  # the run ends with what the post's `then` queues
        action = RuleAction(nxt[0])
    if action is not None and item.tier is not Tier.THREE:
        if action in PAYER_REQUESTS:
            return MoveWho.PAYER
        if action in FILING_ACTIONS:
            return MoveWho.AGENTS
    return claim_move(snap, claim, basis=MoveBasis(exclude_run=item.run_id, closed_item=item.id)).who
