"""Per-request context for service functions: the runtime, the acting user, fresh snapshots and `meta.counts`."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from torch_rcm.api.errors import ApiError
from torch_rcm.api.schemas import Meta
from torch_rcm.domain.entities import AuditEvent, Claim, User
from torch_rcm.domain.enums import Role
from torch_rcm.readmodels.claims import strip
from torch_rcm.readmodels.snapshot import Snapshot
from torch_rcm.runtime import Runtime

DEFAULT_USER = "usr_dana"


@dataclass
class Ctx:
    rt: Runtime
    user: User

    @classmethod
    def for_user(cls, rt: Runtime, user_id: str | None) -> Ctx:
        user = rt.store.get(User, user_id or DEFAULT_USER)
        if user is None:
            raise ApiError(401, "unknown_user", f"X-Torch-User {user_id!r} is not a seeded user")
        return cls(rt, user)

    @property
    def now(self) -> datetime:
        return self.rt.clock.now()

    def snapshot(self) -> Snapshot:
        snap = Snapshot.from_store(self.rt.store, self.now)
        snap.root_cause_now = self.root_cause_now
        return snap

    def root_cause_now(self, claim_id: str) -> str | None:
        """The cause a run would compute now for this claim; the learning guard reads it with the stored ones.
        Imported here for the same reason as `rules.guard_learning`."""
        from torch_rcm.agents.case import claim_root_cause
        from torch_rcm.agents.tools.adapters import SimWorld, StoreDomain

        if self.rt.store.get(Claim, claim_id) is None:
            return None
        return claim_root_cause(StoreDomain(self.rt.store, SimWorld(self.rt.world)), claim_id)

    def meta(self) -> Meta:
        return Meta(counts=strip(self.snapshot(), self.user.id))

    def require_role(self, *roles: Role, code: str = "forbidden", message: str | None = None) -> None:
        if self.user.role not in roles:
            raise ApiError(403, code, message or f"{self.user.name} ({self.user.role.value}) cannot do this")

    def audit(self, action: str, subject_type: str, subject_id: str, detail: str, **data: object) -> None:
        n = self.rt.store.count(AuditEvent) + 1
        self.rt.store.insert(
            AuditEvent(
                id=f"aud_{self.now:%m%d%H%M%S}_{n:05d}",
                at=self.now,
                actor=self.user.id,
                action=action,
                subject_type=subject_type,
                subject_id=subject_id,
                detail=detail,
                data=dict(data),
            )
        )
