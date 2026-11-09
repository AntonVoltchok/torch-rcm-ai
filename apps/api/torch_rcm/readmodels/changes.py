"""What changed: the viewer's strip numbers before and after one approval (`ApproveOut.changes`).

Computed by the approve service inside its write transaction, so no advance can land in between and `after` is
`meta.counts`. Rows: the viewer's Inbox, the claims behind it, and the tile of every claim the approval touched, even
when the number did not move ("Denied stays 5"). No `move.*` rows: at approve time they would only say "agents +N";
where the baton lands is the claim's post-run `move` (plan d1-build decision 4, red team d1-api item 7).
"""

from __future__ import annotations

from torch_rcm.api.schemas import StripChange
from torch_rcm.domain.entities import InboxItem
from torch_rcm.domain.enums import ClaimStatus, RuleAction
from torch_rcm.readmodels.claims import TILE_ORDER, strip
from torch_rcm.readmodels.moves import FILING_ACTIONS
from torch_rcm.readmodels.snapshot import Snapshot

PAYER_REQUESTS = frozenset({RuleAction.REPROCESSING_REQUEST, RuleAction.RECORDS_REQUEST, RuleAction.FORMAL_APPEAL})


def _note(snap: Snapshot, status: ClaimStatus, items: list[InboxItem]) -> str | None:
    """Why an unchanged tile did not move: the payer has not answered what this approval sends."""
    actions = {i.proposed_action.action for i in items if i.proposed_action and i.claim_id}
    payers = {snap.claims[i.claim_id].payer_key.value for i in items if i.claim_id in snap.claims}
    payer = snap.payers[next(iter(payers))].short_name if len(payers) == 1 else "the payer"
    label = status.value
    if actions and actions <= FILING_ACTIONS - PAYER_REQUESTS:
        return f"Stays {label} until {payer} processes the resubmission"
    if actions and actions <= FILING_ACTIONS:
        return f"Stays {label} until {payer} replies"
    return None


def strip_changes(
    before: Snapshot, after: Snapshot, viewer_id: str | None, items: list[InboxItem]
) -> list[StripChange]:
    b, a = strip(before, viewer_id), strip(after, viewer_id)
    rows = [
        StripChange(key="inbox", label="Your Inbox", before=b.inbox_open, after=a.inbox_open, note=None),
        StripChange(
            key="inbox_claims", label="Claims in your Inbox", before=b.inbox_claims, after=a.inbox_claims, note=None
        ),
    ]
    touched = {before.claims[i.claim_id].status for i in items if i.claim_id in before.claims}
    touched |= {after.claims[i.claim_id].status for i in items if i.claim_id in after.claims}
    tiles_b = {t.status: t for t in b.tiles}
    tiles_a = {t.status: t for t in a.tiles}
    for status in TILE_ORDER:
        if status not in touched:
            continue
        tb, ta = tiles_b[status], tiles_a[status]
        same = tb.count == ta.count
        rows.append(
            StripChange(
                key=f"tile.{status.value}",  # one of the closed StripChangeKey values; pydantic validates it
                label=ta.label,
                before=tb.count,
                after=ta.count,
                note=_note(after, status, items) if same else None,
            )
        )
    return rows
