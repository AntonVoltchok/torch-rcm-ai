"""A consistent in-memory view of the practice at one instant, built from the store (API) or a SeedWorld (tests).

Read models are pure functions of a Snapshot, so the API, the seed tests and the invariant tests compute every
number the same way: one implementation, no stored counts.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from functools import cached_property

from torch_rcm.db.store import Store
from torch_rcm.domain.entities import (
    AckEvent,
    AppealRecord,
    Appointment,
    AuditEvent,
    Claim,
    Coverage,
    Entity,
    Estimate,
    Evidence,
    FileEntry,
    Hold,
    Image,
    InboxItem,
    Location,
    Patient,
    PatientLedgerEntry,
    Payer,
    Practice,
    ProcedureLine,
    Provider,
    Remittance,
    Rule,
    RuleChange,
    RuleProposal,
    Run,
    SavedView,
    User,
    Visit,
)
from torch_rcm.domain.enums import InboxItemState

SNAPSHOT_TYPES: tuple[type[Entity], ...] = (
    Practice,
    Location,
    User,
    Provider,
    Payer,
    Patient,
    Coverage,
    Appointment,
    Visit,
    ProcedureLine,
    Image,
    Claim,
    AckEvent,
    FileEntry,
    Hold,
    Remittance,
    PatientLedgerEntry,
    Estimate,
    AppealRecord,
    Rule,
    RuleChange,
    RuleProposal,
    InboxItem,
    Evidence,
    Run,
    AuditEvent,
    SavedView,
)


@dataclass
class Snapshot:
    now: datetime
    rows: dict[type[Entity], list[Entity]] = field(default_factory=dict)

    @classmethod
    def from_store(cls, store: Store, now: datetime, kinds: tuple[type[Entity], ...] = SNAPSHOT_TYPES) -> Snapshot:
        return cls(now=now, rows={k: list(store.all(k)) for k in kinds})

    @classmethod
    def from_entities(cls, now: datetime, entities: dict[type[Entity], list[Entity]]) -> Snapshot:
        return cls(now=now, rows={k: list(v) for k, v in entities.items()})

    def of[E: Entity](self, kind: type[E]) -> list[E]:
        return self.rows.get(kind, [])  # type: ignore[return-value]

    @property
    def today(self) -> date:
        return self.now.date()

    # ── indices ────────────────────────────────────────────────────────────────────────────────────────────

    @cached_property
    def claims(self) -> dict[str, Claim]:
        return {c.id: c for c in self.of(Claim)}

    @cached_property
    def patients(self) -> dict[str, Patient]:
        return {p.id: p for p in self.of(Patient)}

    @cached_property
    def coverages(self) -> dict[str, Coverage]:
        return {c.id: c for c in self.of(Coverage)}

    @cached_property
    def payers(self) -> dict[str, Payer]:
        return {p.key.value: p for p in self.of(Payer)}

    @cached_property
    def providers(self) -> dict[str, Provider]:
        return {p.id: p for p in self.of(Provider)}

    @cached_property
    def users(self) -> dict[str, User]:
        return {u.id: u for u in self.of(User)}

    @cached_property
    def locations(self) -> dict[str, Location]:
        return {loc.id: loc for loc in self.of(Location)}

    @cached_property
    def visits(self) -> dict[str, Visit]:
        return {v.id: v for v in self.of(Visit)}

    @cached_property
    def evidence(self) -> dict[str, Evidence]:
        return {e.id: e for e in self.of(Evidence)}

    @cached_property
    def rules(self) -> dict[str, Rule]:
        return {r.id: r for r in self.of(Rule)}

    @cached_property
    def open_items(self) -> list[InboxItem]:
        return [i for i in self.of(InboxItem) if i.state is InboxItemState.OPEN]

    @cached_property
    def open_items_by_claim(self) -> dict[str, list[InboxItem]]:
        """`needs_action` is derived from this and nothing else (01-domain-model invariant)."""
        out: dict[str, list[InboxItem]] = defaultdict(list)
        for item in self.open_items:
            if item.claim_id:
                out[item.claim_id].append(item)
        return out

    @cached_property
    def acks_by_claim(self) -> dict[str, list[AckEvent]]:
        out: dict[str, list[AckEvent]] = defaultdict(list)
        for ack in sorted(self.of(AckEvent), key=lambda a: (a.at, a.id)):
            out[ack.claim_id].append(ack)
        return out

    @cached_property
    def runs_by_claim(self) -> dict[str, list[Run]]:
        out: dict[str, list[Run]] = defaultdict(list)
        for run in self.of(Run):
            if run.claim_id:
                out[run.claim_id].append(run)
        return out

    @cached_property
    def holds_by_subject(self) -> dict[str, list[Hold]]:
        out: dict[str, list[Hold]] = defaultdict(list)
        for hold in self.of(Hold):
            if hold.cleared_at is None:
                out[hold.subject_id].append(hold)
        return out

    @cached_property
    def file_entries_by_claim(self) -> dict[str, list[FileEntry]]:
        out: dict[str, list[FileEntry]] = defaultdict(list)
        for entry in sorted(self.of(FileEntry), key=lambda e: (e.file_time, e.id)):
            out[entry.claim_id].append(entry)
        return out

    @cached_property
    def practice(self) -> Practice:
        return self.of(Practice)[0]

    def needs_action(self, claim_id: str) -> bool:
        return claim_id in self.open_items_by_claim
