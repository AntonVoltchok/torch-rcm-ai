"""The persisted event log behind SSE (`run_events`): per-run channels and the `firehose`.

This module only appends and reads; torch.agents owns the live, in-process fan-out (07-agents EventBus) and
publishes into the same table, so a reconnecting client replays from here with Last-Event-ID.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from torch.db.store import Store
from torch.domain.entities import RunEvent

FIREHOSE = "firehose"


def publish(store: Store, channel: str, event: str, data: dict[str, Any], at: datetime) -> int:
    with store.tx():
        seq = (
            int(store.scalar('SELECT COALESCE(MAX("seq"), 0) FROM run_events WHERE "channel" = ?', [channel]) or 0) + 1
        )
        store.insert(RunEvent(id=f"evt_{channel}_{seq:07d}", channel=channel, seq=seq, event=event, data=data, at=at))
    return seq


def replay(store: Store, channel: str, after: int = 0, limit: int = 500) -> list[RunEvent]:
    return store.find(RunEvent, {"channel": channel}, sql='"seq" > ?', params=[after], order_by="seq", limit=limit)


def last_seq(store: Store, channel: str) -> int:
    return int(store.scalar('SELECT COALESCE(MAX("seq"), 0) FROM run_events WHERE "channel" = ?', [channel]) or 0)
