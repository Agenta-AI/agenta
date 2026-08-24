"""SQLite implementation of the sessions DAO contract.

Turn admission, message appends, and transitions run inside immediate_transaction:
the write lock serializes the read-then-write invariants (idempotency before busy,
sequence = max+1, allowed transitions).
"""

from sqlalchemy import func, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker

from agenta_local.core.agents.types import RevisionNotFound
from agenta_local.core.sessions.dtos import (
    Message,
    MessageRole,
    Session,
    SessionStatus,
    Turn,
    TurnStatus,
)
from agenta_local.core.sessions.interfaces import SessionsDAOInterface
from agenta_local.core.sessions.types import (
    ALLOWED_TURN_TRANSITIONS,
    IdempotencyConflict,
    SessionBusy,
    SessionNotFound,
    TurnNotActive,
    TurnNotFound,
)
from agenta_local.dbs.sqlite.agents.dbes import AgentRevisionDBE
from agenta_local.dbs.sqlite.sessions.dbes import MessageDBE, SessionDBE, TurnDBE
from agenta_local.dbs.sqlite.sessions.mappings import (
    dbe_to_message,
    dbe_to_session,
    dbe_to_turn,
)
from agenta_local.dbs.sqlite.shared.engine import fetch_one, immediate_transaction
from agenta_local.dbs.sqlite.shared.types import new_id, utc_now

ACTIVE_STATUSES = (TurnStatus.PENDING, TurnStatus.RUNNING)


class SessionsDAO(SessionsDAOInterface):
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._factory = session_factory

    async def create_session(
        self, *, agent_revision_id: str, title: str | None = None
    ) -> Session:
        session_id = new_id("ses")
        async with immediate_transaction(self._factory) as conn:
            revision = (
                await conn.execute(
                    select(AgentRevisionDBE.id).where(
                        AgentRevisionDBE.id == agent_revision_id
                    )
                )
            ).scalar()
            if revision is None:
                raise RevisionNotFound(f"revision {agent_revision_id} does not exist")
            await conn.execute(
                insert(SessionDBE).values(
                    id=session_id, agent_revision_id=agent_revision_id, title=title
                )
            )
            return await _load_session(conn, session_id)

    async def get_session(self, *, session_id: str) -> Session | None:
        async with self._factory() as session:
            dbe = await session.get(SessionDBE, session_id)
            return None if dbe is None else dbe_to_session(dbe)

    async def list_sessions(
        self, *, status: SessionStatus = SessionStatus.ACTIVE
    ) -> list[Session]:
        async with self._factory() as session:
            dbes = (
                (
                    await session.execute(
                        select(SessionDBE)
                        .where(SessionDBE.status == status)
                        .order_by(SessionDBE.updated_at.desc(), SessionDBE.id.asc())
                    )
                )
                .scalars()
                .all()
            )
            return [dbe_to_session(dbe) for dbe in dbes]

    async def archive_session(self, *, session_id: str) -> Session:
        async with immediate_transaction(self._factory) as conn:
            await _require_session(conn, session_id)
            await conn.execute(
                update(SessionDBE)
                .where(SessionDBE.id == session_id)
                .values(status=SessionStatus.ARCHIVED)
            )
            return await _load_session(conn, session_id)

    async def begin_turn(
        self, *, session_id: str, client_turn_id: str, input_hash: str
    ) -> Turn:
        turn_id = new_id("trn")
        async with immediate_transaction(self._factory) as conn:
            await _require_session(conn, session_id)
            # Idempotency before busy: an exact duplicate replays even while active.
            existing = await fetch_one(
                conn,
                select(TurnDBE)
                .where(TurnDBE.session_id == session_id)
                .where(TurnDBE.client_turn_id == client_turn_id),
                TurnDBE,
            )
            if existing is not None:
                if existing.input_hash != input_hash:
                    raise IdempotencyConflict(
                        f"client_turn_id {client_turn_id} was submitted with"
                        " different input"
                    )
                return dbe_to_turn(existing)
            active = await fetch_one(
                conn,
                select(TurnDBE)
                .where(TurnDBE.session_id == session_id)
                .where(TurnDBE.status.in_(ACTIVE_STATUSES)),
                TurnDBE,
            )
            if active is not None:
                raise SessionBusy(
                    f"session {session_id} already has an active turn",
                    details={"active_turn_id": active.id},
                )
            try:
                await conn.execute(
                    insert(TurnDBE).values(
                        id=turn_id,
                        session_id=session_id,
                        client_turn_id=client_turn_id,
                        input_hash=input_hash,
                        status=TurnStatus.PENDING,
                    )
                )
            except IntegrityError as exc:
                # Unreachable under one writer at a time; maps out-of-band races to
                # the stable domain outcome instead of a raw integrity error.
                raise SessionBusy(
                    f"session {session_id} lost an active-turn race"
                ) from exc
            return dbe_to_turn(
                await fetch_one(
                    conn, select(TurnDBE).where(TurnDBE.id == turn_id), TurnDBE
                )
            )

    async def finish_turn(
        self,
        *,
        turn_id: str,
        status: TurnStatus,
        error_json: str | None = None,
    ) -> Turn:
        target = TurnStatus(status)
        async with immediate_transaction(self._factory) as conn:
            dbe = await fetch_one(
                conn, select(TurnDBE).where(TurnDBE.id == turn_id), TurnDBE
            )
            if dbe is None:
                raise TurnNotFound(f"turn {turn_id} does not exist")
            current = TurnStatus(dbe.status)
            if target not in ALLOWED_TURN_TRANSITIONS.get(current, frozenset()):
                raise TurnNotActive(
                    f"turn {turn_id} cannot move from {current} to {target}"
                )
            values: dict[str, object] = {"status": target}
            if target is TurnStatus.RUNNING:
                values["started_at"] = utc_now()
            if target not in ACTIVE_STATUSES:
                values["finished_at"] = utc_now()
            if error_json is not None:
                values["error_json"] = error_json
            await conn.execute(
                update(TurnDBE).where(TurnDBE.id == turn_id).values(**values)
            )
            return dbe_to_turn(
                await fetch_one(
                    conn, select(TurnDBE).where(TurnDBE.id == turn_id), TurnDBE
                )
            )

    async def append_message(
        self,
        *,
        session_id: str,
        turn_id: str,
        role: MessageRole,
        content_json: str,
    ) -> Message:
        message_id = new_id("msg")
        async with immediate_transaction(self._factory) as conn:
            await _require_session(conn, session_id)
            dbe = await fetch_one(
                conn,
                select(TurnDBE)
                .where(TurnDBE.id == turn_id)
                .where(TurnDBE.session_id == session_id),
                TurnDBE,
            )
            if dbe is None:
                raise TurnNotFound(f"turn {turn_id} does not exist in this session")
            if TurnStatus(dbe.status) not in ACTIVE_STATUSES:
                raise TurnNotActive(
                    f"turn {turn_id} is {dbe.status}; messages attach only while"
                    " pending/running"
                )
            next_sequence = (
                await conn.execute(
                    select(func.coalesce(func.max(MessageDBE.sequence), -1)).where(
                        MessageDBE.session_id == session_id
                    )
                )
            ).scalar_one()
            try:
                await conn.execute(
                    insert(MessageDBE).values(
                        id=message_id,
                        session_id=session_id,
                        turn_id=turn_id,
                        sequence=next_sequence + 1,
                        role=role,
                        content_json=content_json,
                    )
                )
            except IntegrityError as exc:
                # Allocation and insert share the transaction, so failure rolls back
                # together and consumes no sequence number.
                raise TurnNotActive(
                    f"message append for turn {turn_id} violated a uniqueness rule"
                ) from exc
            return dbe_to_message(
                await fetch_one(
                    conn,
                    select(MessageDBE).where(MessageDBE.id == message_id),
                    MessageDBE,
                )
            )

    async def list_messages(self, *, session_id: str) -> list[Message]:
        async with self._factory() as session:
            if await session.get(SessionDBE, session_id) is None:
                raise SessionNotFound(f"session {session_id} does not exist")
            dbes = (
                (
                    await session.execute(
                        select(MessageDBE)
                        .where(MessageDBE.session_id == session_id)
                        .order_by(MessageDBE.sequence.asc())
                    )
                )
                .scalars()
                .all()
            )
            return [dbe_to_message(dbe) for dbe in dbes]

    async def interrupt_incomplete_turns(self) -> int:
        async with immediate_transaction(self._factory) as conn:
            result = await conn.execute(
                update(TurnDBE)
                .where(TurnDBE.status.in_(ACTIVE_STATUSES))
                .values(status=TurnStatus.INTERRUPTED, finished_at=utc_now())
            )
            return result.rowcount


async def _require_session(conn: AsyncConnection, session_id: str) -> None:
    exists = (
        await conn.execute(select(SessionDBE.id).where(SessionDBE.id == session_id))
    ).scalar()
    if exists is None:
        raise SessionNotFound(f"session {session_id} does not exist")


async def _load_session(conn: AsyncConnection, session_id: str) -> Session:
    return dbe_to_session(
        await fetch_one(
            conn, select(SessionDBE).where(SessionDBE.id == session_id), SessionDBE
        )
    )
