"""empty_inbox: the canonical practice with every open item already handled ("Nothing needs you")."""

from __future__ import annotations

from datetime import timedelta

from torch_rcm.domain.entities import InboxItem
from torch_rcm.domain.enums import InboxItemState
from torch_rcm.seed.builder import SeedWorld
from torch_rcm.seed.canonical import build as build_canonical


def build() -> SeedWorld:
    w = build_canonical(scenario="empty_inbox")
    for item in w.of(InboxItem):
        if item.state is InboxItemState.OPEN:
            item.state = InboxItemState.DONE
            item.resolved_by = "usr_dana"
            item.resolved_at = w.now - timedelta(minutes=5)
    return w
