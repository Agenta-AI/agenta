"""SQLite implementation of the sessions DAO contract (contracts.md).

Turn admission, context loading, and terminal commits run inside
immediate_transaction: the write lock serializes the read-then-write invariants
(idempotency before busy, sequence = max+1, one terminal transition).
"""

import json

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
    TurnAlreadyExists,
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
        self, *, session_id: str, client_turn_id: str, input: str, input_hash: str
    ) -> Turn:
        turn_id = new_id("trn")
        async with immediate_transaction(self._factory) as conn:
            await _require_session(conn, session_id)
            # Idempotency before busy: a duplicate client_turn_id resolves first.
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
                        " different input",
                        details={"turn_id": existing.id},
                    )
                raise TurnAlreadyExists(
                    f"turn {existing.id} already exists for client_turn_id"
                    f" {client_turn_id}",
                    details={"turn_id": existing.id, "status": existing.status},
                )
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
                await _insert_message(
                    conn,
                    session_id=session_id,
                    turn_id=turn_id,
                    role=MessageRole.USER,
                    content={"text": input},
                )
            except IntegrityError as exc:
                # Unreachable under one writer at a time; maps out-of-band races
                # to the stable domain outcome instead of a raw integrity error.
                raise SessionBusy(
                    f"session {session_id} lost an active-turn race"
                ) from exc
            return dbe_to_turn(
                await fetch_one(
                    conn, select(TurnDBE).where(TurnDBE.id == turn_id), TurnDBE
                )
            )

    async def mark_turn_running(self, *, turn_id: str) -> Turn:
        return await _transition(
            self._factory,
            turn_id=turn_id,
            target=TurnStatus.RUNNING,
            extra_values={"started_at": utc_now()},
        )

    async def load_completed_context(
        self, *, session_id: str, current_turn_id: str
    ) -> list[Message]:
        async with self._factory() as session:
            dbes = (
                (
                    await session.execute(
                        select(MessageDBE)
                        .join(TurnDBE, MessageDBE.turn_id == TurnDBE.id)
                        .where(MessageDBE.session_id == session_id)
                        .where(
                            (TurnDBE.status == TurnStatus.COMPLETED)
                            | (MessageDBE.turn_id == current_turn_id)
                        )
                        .order_by(MessageDBE.sequence.asc())
                    )
                )
                .scalars()
                .all()
            )
            return [dbe_to_message(dbe) for dbe in dbes]

    async def complete_turn(self, *, turn_id: str, assistant_message: str) -> Turn:
        async with immediate_transaction(self._factory) as conn:
            turn = await _require_turn(conn, turn_id)
            if TurnStatus(turn.status) is not TurnStatus.RUNNING:
                raise TurnNotActive(
                    f"turn {turn_id} cannot move from {turn.status} to completed"
                )
            await _insert_message(
                conn,
                session_id=turn.session_id,
                turn_id=turn_id,
                role=MessageRole.ASSISTANT,
                content={"text": assistant_message},
            )
            await _apply_transition(
                conn,
                turn_id,
                TurnStatus.COMPLETED,
                extra_values={"finished_at": utc_now()},
            )
            return dbe_to_turn(
                await fetch_one(
                    conn, select(TurnDBE).where(TurnDBE.id == turn_id), TurnDBE
                )
            )

    async def fail_turn(self, *, turn_id: str, error: str) -> Turn:
        return await _terminal(
            self._factory, turn_id=turn_id, target=TurnStatus.FAILED, error=error
        )

    async def cancel_turn(self, *, turn_id: str) -> Turn:
        return await _terminal(
            self._factory, turn_id=turn_id, target=TurnStatus.CANCELLED, error=None
        )

    async def interrupt_turn(self, *, turn_id: str, error: str) -> Turn:
        return await _terminal(
            self._factory, turn_id=turn_id, target=TurnStatus.INTERRUPTED, error=error
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


async def _transition(
    factory: async_sessionmaker[AsyncSession],
    *,
    turn_id: str,
    target: TurnStatus,
    extra_values: dict[str, object] | None = None,
) -> Turn:
    async with immediate_transaction(factory) as conn:
        await _apply_transition(conn, turn_id, target, extra_values)
        return dbe_to_turn(
            await fetch_one(conn, select(TurnDBE).where(TurnDBE.id == turn_id), TurnDBE)
        )


async def _terminal(
    factory: async_sessionmaker[AsyncSession],
    *,
    turn_id: str,
    target: TurnStatus,
    error: str | None,
) -> Turn:
    values: dict[str, object] = {"finished_at": utc_now()}
    if error is not None:
        values["error_json"] = error
    return await _transition(
        factory, turn_id=turn_id, target=target, extra_values=values
    )


async def _apply_transition(
    conn: AsyncConnection,
    turn_id: str,
    target: TurnStatus,
    extra_values: dict[str, object] | None = None,
) -> None:
    dbe = await _require_turn(conn, turn_id)
    current = TurnStatus(dbe.status)
    if target not in ALLOWED_TURN_TRANSITIONS.get(current, frozenset()):
        raise TurnNotActive(f"turn {turn_id} cannot move from {current} to {target}")
    values: dict[str, object] = {"status": target}
    if extra_values:
        values.update(extra_values)
    await conn.execute(update(TurnDBE).where(TurnDBE.id == turn_id).values(**values))


async def _insert_message(
    conn: AsyncConnection,
    *,
    session_id: str,
    turn_id: str,
    role: MessageRole,
    content: dict,
) -> Message:
    next_sequence = (
        await conn.execute(
            select(func.coalesce(func.max(MessageDBE.sequence), -1)).where(
                MessageDBE.session_id == session_id
            )
        )
    ).scalar_one()
    message_id = new_id("msg")
    # Allocation and insert share the transaction, so failure rolls back together
    # and consumes no sequence number.
    await conn.execute(
        insert(MessageDBE).values(
            id=message_id,
            session_id=session_id,
            turn_id=turn_id,
            sequence=next_sequence + 1,
            role=role,
            content_json=json.dumps(content),
        )
    )
    return dbe_to_message(
        await fetch_one(
            conn, select(MessageDBE).where(MessageDBE.id == message_id), MessageDBE
        )
    )


async def _require_turn(conn: AsyncConnection, turn_id: str) -> TurnDBE:
    dbe = await fetch_one(conn, select(TurnDBE).where(TurnDBE.id == turn_id), TurnDBE)
    if dbe is None:
        raise TurnNotFound(f"turn {turn_id} does not exist")
    return dbe


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
