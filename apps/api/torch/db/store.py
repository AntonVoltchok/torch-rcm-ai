"""SQLite persistence for the domain entity set.

Each entity class is a table of JSON documents (`id TEXT PRIMARY KEY, doc TEXT`). The fields an entity lists in
`__indexed__` become generated, indexed columns, so filters and sorts run in SQL; datetimes are generated as epoch
seconds so ordering is correct across DST offsets. `__unique__` fields get unique indexes (idempotency keys).

One writer: every write goes through `tx()`, which takes a process-wide lock and `BEGIN IMMEDIATE`. Readers use
their own per-thread connections (WAL mode), so the API keeps serving while the scheduler writes.

Why documents and not an ORM: the domain model is one pydantic set that is also the OpenAPI contract; storing it as
documents avoids a second, table-shaped copy of every class. See docs/plans/api-core.md (D0/D13).
"""

from __future__ import annotations

import sqlite3
import threading
import types
import typing
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import date, datetime
from enum import Enum
from pathlib import Path
from typing import Any, TypeVar, get_args, get_origin

from torch.domain.entities import ALL_ENTITIES, Entity

E = TypeVar("E", bound=Entity)

Scalar = str | int | float | bool | None
WhereValue = Scalar | Enum | date | datetime | Sequence[Scalar | Enum | date | datetime]


class NotFoundError(LookupError):
    def __init__(self, entity: type[Entity], entity_id: str) -> None:
        super().__init__(f"{entity.__name__} {entity_id} not found")
        self.entity = entity
        self.entity_id = entity_id


class DuplicateError(ValueError):
    """Unique constraint (primary key or an idempotency key) violated."""


def _is_datetime_field(model: type[Entity], name: str) -> bool:
    annotation = model.model_fields[name].annotation
    if annotation is datetime:
        return True
    origin = get_origin(annotation)
    if origin in (types.UnionType, typing.Union):
        return datetime in get_args(annotation)
    return False


def _sql_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, datetime):
        return int(value.timestamp())
    if isinstance(value, date):
        return value.isoformat()
    return value


class Store:
    """A small repository over SQLite. Thread-safe; one writer at a time."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        self._memory = self.path == ":memory:"
        self._local = threading.local()
        self._write_lock = threading.RLock()
        self._shared: sqlite3.Connection | None = None
        self._tx_depth = threading.local()
        if self._memory:
            self._shared = self._open()

    # ── connections ────────────────────────────────────────────────────────────────────────────────────────

    def _open(self) -> sqlite3.Connection:
        if not self._memory:
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None, timeout=5.0)
        conn.execute("PRAGMA busy_timeout=5000")
        if not self._memory:
            conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    @property
    def conn(self) -> sqlite3.Connection:
        if self._shared is not None:
            return self._shared
        conn: sqlite3.Connection | None = getattr(self._local, "conn", None)
        if conn is None:
            conn = self._open()
            self._local.conn = conn
        return conn

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            conn.close()
            self._local.conn = None
        if self._shared is not None:
            self._shared.close()
            self._shared = None

    # ── schema ─────────────────────────────────────────────────────────────────────────────────────────────

    def create_schema(self) -> None:
        with self.tx():
            for model in ALL_ENTITIES:
                for statement in self._ddl(model):
                    self.conn.execute(statement)

    def drop_all(self) -> None:
        with self.tx():
            for model in ALL_ENTITIES:
                self.conn.execute(f"DROP TABLE IF EXISTS {model.__table__}")

    def _ddl(self, model: type[Entity]) -> list[str]:
        table = model.__table__
        cols = ["id TEXT PRIMARY KEY", "doc TEXT NOT NULL"]
        for name in model.__indexed__:
            path = f"json_extract(doc, '$.{name}')"
            expr = f"unixepoch({path})" if _is_datetime_field(model, name) else path
            cols.append(f'"{name}" GENERATED ALWAYS AS ({expr}) VIRTUAL')
        statements = [f"CREATE TABLE IF NOT EXISTS {table} ({', '.join(cols)})"]
        unique = set(getattr(model, "__unique__", ()))
        for name in model.__indexed__:
            kind = "UNIQUE INDEX" if name in unique else "INDEX"
            statements.append(f'CREATE {kind} IF NOT EXISTS ix_{table}_{name} ON {table} ("{name}")')
        return statements

    # ── transactions ───────────────────────────────────────────────────────────────────────────────────────

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """Write transaction. Re-entrant within a thread (inner blocks join the outer transaction)."""
        with self._write_lock:
            depth: int = getattr(self._tx_depth, "n", 0)
            conn = self.conn
            if depth == 0:
                conn.execute("BEGIN IMMEDIATE")
            self._tx_depth.n = depth + 1
            try:
                yield conn
            except BaseException:
                self._tx_depth.n = depth
                if depth == 0:
                    conn.execute("ROLLBACK")
                raise
            self._tx_depth.n = depth
            if depth == 0:
                conn.execute("COMMIT")

    # ── writes ─────────────────────────────────────────────────────────────────────────────────────────────

    def insert(self, entity: Entity) -> None:
        self.insert_many([entity])

    def insert_many(self, entities: Sequence[Entity]) -> None:
        if not entities:
            return
        by_table: dict[str, list[tuple[str, str]]] = {}
        for e in entities:
            by_table.setdefault(type(e).__table__, []).append((e.id, e.model_dump_json()))
        with self.tx() as conn:
            for table, rows in by_table.items():
                try:
                    conn.executemany(f"INSERT INTO {table} (id, doc) VALUES (?, ?)", rows)
                except sqlite3.IntegrityError as exc:
                    raise DuplicateError(f"{table}: {exc}") from exc

    def upsert(self, entity: Entity) -> None:
        with self.tx() as conn:
            try:
                conn.execute(
                    f"INSERT INTO {type(entity).__table__} (id, doc) VALUES (?, ?) "
                    "ON CONFLICT(id) DO UPDATE SET doc = excluded.doc",
                    (entity.id, entity.model_dump_json()),
                )
            except sqlite3.IntegrityError as exc:
                raise DuplicateError(str(exc)) from exc

    def update(self, entity: Entity) -> None:
        with self.tx() as conn:
            cur = conn.execute(
                f"UPDATE {type(entity).__table__} SET doc = ? WHERE id = ?",
                (entity.model_dump_json(), entity.id),
            )
            if cur.rowcount == 0:
                raise NotFoundError(type(entity), entity.id)

    def delete(self, model: type[Entity], entity_id: str) -> None:
        with self.tx() as conn:
            conn.execute(f"DELETE FROM {model.__table__} WHERE id = ?", (entity_id,))

    # ── reads ──────────────────────────────────────────────────────────────────────────────────────────────

    def get(self, model: type[E], entity_id: str) -> E | None:
        row = self.conn.execute(f"SELECT doc FROM {model.__table__} WHERE id = ?", (entity_id,)).fetchone()
        return model.model_validate_json(row[0]) if row else None

    def require(self, model: type[E], entity_id: str) -> E:
        found = self.get(model, entity_id)
        if found is None:
            raise NotFoundError(model, entity_id)
        return found

    def get_many(self, model: type[E], ids: Sequence[str]) -> dict[str, E]:
        if not ids:
            return {}
        marks = ",".join("?" for _ in ids)
        rows = self.conn.execute(f"SELECT doc FROM {model.__table__} WHERE id IN ({marks})", list(ids))
        out = [model.model_validate_json(r[0]) for r in rows]
        return {e.id: e for e in out}

    def find(
        self,
        model: type[E],
        where: dict[str, WhereValue] | None = None,
        *,
        sql: str | None = None,
        params: Sequence[Any] = (),
        order_by: str | Sequence[str] = "id",
        limit: int | None = None,
        offset: int = 0,
    ) -> list[E]:
        clause, args = self._where(model, where, sql, params)
        order = self._order(model, order_by)
        query = f"SELECT doc FROM {model.__table__}{clause} ORDER BY {order}"
        if limit is not None:
            query += f" LIMIT {int(limit)} OFFSET {int(offset)}"
        return [model.model_validate_json(r[0]) for r in self.conn.execute(query, args)]

    def all(self, model: type[E]) -> list[E]:
        return self.find(model)

    def count(
        self,
        model: type[Entity],
        where: dict[str, WhereValue] | None = None,
        *,
        sql: str | None = None,
        params: Sequence[Any] = (),
    ) -> int:
        clause, args = self._where(model, where, sql, params)
        row = self.conn.execute(f"SELECT COUNT(*) FROM {model.__table__}{clause}", args).fetchone()
        return int(row[0])

    def scalar(self, query: str, params: Sequence[Any] = ()) -> Any:
        row = self.conn.execute(query, list(params)).fetchone()
        return row[0] if row else None

    # ── query building ─────────────────────────────────────────────────────────────────────────────────────

    @staticmethod
    def _column(model: type[Entity], name: str) -> str:
        if name != "id" and name not in model.__indexed__:
            raise ValueError(f"{model.__name__}.{name} is not an indexed field")
        return f'"{name}"'

    def _where(
        self,
        model: type[Entity],
        where: dict[str, WhereValue] | None,
        sql: str | None,
        params: Sequence[Any],
    ) -> tuple[str, list[Any]]:
        parts: list[str] = []
        args: list[Any] = []
        for name, value in (where or {}).items():
            col = self._column(model, name)
            if value is None:
                parts.append(f"{col} IS NULL")
            elif isinstance(value, list | tuple | set | frozenset):
                values = [_sql_value(v) for v in value]
                if not values:
                    parts.append("0")
                    continue
                parts.append(f"{col} IN ({','.join('?' for _ in values)})")
                args.extend(values)
            else:
                parts.append(f"{col} = ?")
                args.append(_sql_value(value))
        if sql:
            parts.append(f"({sql})")
            args.extend(_sql_value(p) for p in params)
        return (" WHERE " + " AND ".join(parts) if parts else ""), args

    def _order(self, model: type[Entity], order_by: str | Sequence[str]) -> str:
        keys = [order_by] if isinstance(order_by, str) else list(order_by)
        out = []
        for key in keys:
            desc = key.startswith("-")
            col = self._column(model, key.lstrip("-"))
            out.append(f"{col} {'DESC' if desc else 'ASC'}")
        if "id" not in {k.lstrip("-") for k in keys}:
            out.append("id ASC")
        return ", ".join(out)
