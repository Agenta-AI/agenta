import uuid

import pytest
import sqlalchemy as sa
from agenta_local.dbs.sqlite.agents.dbes import AgentDBE, AgentRevisionDBE
from agenta_local.dbs.sqlite.sessions.dbes import MessageDBE, SessionDBE, TurnDBE
from agenta_local.dbs.sqlite.shared.engine import (
    build_engine,
    connection_pragmas,
    immediate_transaction,
)
from agenta_local.dbs.sqlite.shared.types import utc_now
from sqlalchemy.exc import IntegrityError


@pytest.fixture
async def engine(tmp_path, migration_runner):
    db = tmp_path / "local.db"
    migration_runner.upgrade_database(db)
    eng, _factory = build_engine(db)
    yield eng
    await eng.dispose()


@pytest.fixture
async def session_factory(tmp_path, migration_runner):
    db = tmp_path / "local.db"
    migration_runner.upgrade_database(db)
    eng, factory = build_engine(db)
    yield factory
    await eng.dispose()


async def test_immediate_transaction_accepts_sessionmaker(session_factory):
    await _seed_agent(session_factory)
    async with immediate_transaction(session_factory) as conn:
        count = (await conn.execute(sa.text("SELECT COUNT(*) FROM agents"))).scalar()
    assert count == 1


def _uid() -> str:
    return uuid.uuid4().hex


async def _seed_agent(engine):
    agent_id, rev_id = _uid(), _uid()
    async with immediate_transaction(engine) as conn:
        await conn.execute(
            AgentRevisionDBE.__table__.insert().values(
                id=rev_id,
                agent_id=agent_id,
                version=1,
                instructions="do things",
                model_json="{}",
                execution_json="{}",
                created_at=utc_now(),
            )
        )
        await conn.execute(
            AgentDBE.__table__.insert().values(
                id=agent_id,
                name="agent",
                current_revision_id=rev_id,
                created_at=utc_now(),
                updated_at=utc_now(),
            )
        )
    return agent_id, rev_id


async def _seed_revision(engine, agent_id, version=2):
    rev_id = _uid()
    async with immediate_transaction(engine) as conn:
        await conn.execute(
            AgentRevisionDBE.__table__.insert().values(
                id=rev_id,
                agent_id=agent_id,
                version=version,
                instructions="v2",
                model_json="{}",
                execution_json="{}",
                created_at=utc_now(),
            )
        )
    return rev_id


async def _seed_session(engine):
    _, rev_id = await _seed_agent(engine)
    session_id = _uid()
    async with immediate_transaction(engine) as conn:
        await conn.execute(
            SessionDBE.__table__.insert().values(
                id=session_id,
                agent_revision_id=rev_id,
                title=None,
                status="active",
                created_at=utc_now(),
                updated_at=utc_now(),
            )
        )
    return session_id


async def _seed_turn(engine, session_id, status="pending", client_turn_id=None):
    turn_id = _uid()
    async with immediate_transaction(engine) as conn:
        await conn.execute(
            TurnDBE.__table__.insert().values(
                id=turn_id,
                session_id=session_id,
                client_turn_id=client_turn_id or _uid(),
                input_hash="hash",
                status=status,
                error_json=None,
                started_at=utc_now() if status != "pending" else None,
                finished_at=utc_now() if status == "completed" else None,
            )
        )
    return turn_id


async def test_pragmas_active_on_new_connections(engine):
    async with engine.connect() as conn:
        pragmas = await connection_pragmas(conn)
        assert pragmas["foreign_keys"] == 1
        assert pragmas["journal_mode"] == "wal"
        assert pragmas["busy_timeout"] == 5000


async def test_agent_revision_cycle_commits_in_one_deferred_transaction(engine):
    agent_id, rev_id = _uid(), _uid()
    async with immediate_transaction(engine) as conn:
        await conn.execute(
            AgentRevisionDBE.__table__.insert().values(
                id=rev_id,
                agent_id=agent_id,
                version=1,
                instructions="i",
                model_json="{}",
                execution_json="{}",
                created_at=utc_now(),
            )
        )
        await conn.execute(
            AgentDBE.__table__.insert().values(
                id=agent_id,
                name="agent",
                current_revision_id=rev_id,
                created_at=utc_now(),
                updated_at=utc_now(),
            )
        )
    async with engine.connect() as conn:
        count = (await conn.execute(sa.text("SELECT COUNT(*) FROM agents"))).scalar()
    assert count == 1


async def test_revision_referencing_missing_agent_fails_fk(engine):
    with pytest.raises(IntegrityError, match="FOREIGN KEY"):
        async with immediate_transaction(engine) as conn:
            await conn.execute(
                AgentRevisionDBE.__table__.insert().values(
                    id=_uid(),
                    agent_id=_uid(),
                    version=1,
                    instructions="i",
                    model_json="{}",
                    execution_json="{}",
                    created_at=utc_now(),
                )
            )


async def test_agent_revisions_update_aborts(engine):
    _, rev_id = await _seed_agent(engine)
    with pytest.raises(IntegrityError, match="immutable"):
        async with immediate_transaction(engine) as conn:
            await conn.execute(
                sa.text("UPDATE agent_revisions SET instructions = 'x' WHERE id = :id"),
                {"id": rev_id},
            )


async def test_session_rebind_aborts(engine):
    agent_id, rev_id = await _seed_agent(engine)
    other_rev_id = await _seed_revision(engine, agent_id, version=2)
    session_id = _uid()
    async with immediate_transaction(engine) as conn:
        await conn.execute(
            SessionDBE.__table__.insert().values(
                id=session_id,
                agent_revision_id=rev_id,
                title=None,
                status="active",
                created_at=utc_now(),
                updated_at=utc_now(),
            )
        )

    with pytest.raises(IntegrityError, match="permanently bound"):
        async with immediate_transaction(engine) as conn:
            await conn.execute(
                sa.text("UPDATE sessions SET agent_revision_id = :rid WHERE id = :sid"),
                {"rid": other_rev_id, "sid": session_id},
            )


async def test_duplicate_client_turn_id_rejected(engine):
    session_id = await _seed_session(engine)
    await _seed_turn(engine, session_id, client_turn_id="t1")
    with pytest.raises(IntegrityError, match="UNIQUE"):
        await _seed_turn(engine, session_id, client_turn_id="t1")


async def test_duplicate_message_sequence_rejected(engine):
    session_id = await _seed_session(engine)
    turn_id = await _seed_turn(engine, session_id, status="completed")

    async def insert_message(sequence):
        async with immediate_transaction(engine) as conn:
            await conn.execute(
                MessageDBE.__table__.insert().values(
                    id=_uid(),
                    session_id=session_id,
                    turn_id=turn_id,
                    sequence=sequence,
                    role="user",
                    content_json="{}",
                    created_at=utc_now(),
                )
            )

    await insert_message(0)
    with pytest.raises(IntegrityError, match="UNIQUE"):
        await insert_message(0)


async def test_second_pending_turn_rejected_completed_coexists(engine):
    session_id = await _seed_session(engine)
    await _seed_turn(engine, session_id, status="completed")
    await _seed_turn(engine, session_id, status="pending")

    with pytest.raises(IntegrityError, match="UNIQUE"):
        await _seed_turn(engine, session_id, status="running")

    async with engine.connect() as conn:
        statuses = (
            (await conn.execute(sa.text("SELECT status FROM turns"))).scalars().all()
        )
    assert sorted(statuses) == ["completed", "pending"]


async def test_invalid_turn_status_rejected(engine):
    session_id = await _seed_session(engine)
    with pytest.raises(IntegrityError, match="ck_turns_status_valid"):
        await _seed_turn(engine, session_id, status="weird")


async def test_invalid_message_role_rejected(engine):
    session_id = await _seed_session(engine)
    turn_id = await _seed_turn(engine, session_id, status="completed")
    with pytest.raises(IntegrityError, match="ck_messages_role_valid"):
        async with immediate_transaction(engine) as conn:
            await conn.execute(
                MessageDBE.__table__.insert().values(
                    id=_uid(),
                    session_id=session_id,
                    turn_id=turn_id,
                    sequence=0,
                    role="developer",
                    content_json="{}",
                    created_at=utc_now(),
                )
            )


async def test_deleting_referenced_rows_restricted(engine):
    agent_id, rev_id = await _seed_agent(engine)
    session_id = await _seed_session(engine)
    turn_id = await _seed_turn(engine, session_id, status="completed")
    async with immediate_transaction(engine) as conn:
        await conn.execute(
            MessageDBE.__table__.insert().values(
                id=_uid(),
                session_id=session_id,
                turn_id=turn_id,
                sequence=0,
                role="user",
                content_json="{}",
                created_at=utc_now(),
            )
        )

    with pytest.raises(IntegrityError, match="FOREIGN KEY"):
        async with immediate_transaction(engine) as conn:
            await conn.execute(
                sa.text("DELETE FROM agents WHERE id = :id"), {"id": agent_id}
            )
    with pytest.raises(IntegrityError, match="FOREIGN KEY"):
        async with immediate_transaction(engine) as conn:
            await conn.execute(
                sa.text("DELETE FROM turns WHERE id = :id"), {"id": turn_id}
            )
    with pytest.raises(IntegrityError, match="FOREIGN KEY"):
        async with immediate_transaction(engine) as conn:
            await conn.execute(
                sa.text("DELETE FROM agent_revisions WHERE id = :id"), {"id": rev_id}
            )
