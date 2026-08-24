"""SessionsDAO integration tests: turns, transitions, messages, recovery."""

import pytest
from agenta_local.core.agents.types import RevisionNotFound
from agenta_local.core.sessions.types import (
    ALLOWED_TURN_TRANSITIONS,
    IdempotencyConflict,
    SessionBusy,
    SessionNotFound,
    TurnNotActive,
    TurnNotFound,
)
from agenta_local.dbs.sqlite.agents.dao import AgentsDAO
from agenta_local.dbs.sqlite.sessions.dao import SessionsDAO

MODEL_JSON = '{"provider": "openai", "name": "gpt-5-mini", "parameters": {}}'
EXECUTION_JSON = '{"harness": "pi_core", "sandbox": "local"}'

CONTENT = '{"type": "text", "text": "hi"}'


async def make_session(storage):
    agents = AgentsDAO(storage.factory)
    dao = SessionsDAO(storage.factory)
    agent = await agents.create_agent(
        name="agent",
        instructions="do things",
        model_json=MODEL_JSON,
        execution_json=EXECUTION_JSON,
    )
    session = await dao.create_session(agent_revision_id=agent.current_revision.id)
    return agent, session


async def test_create_session_binds_revision(storage):
    _, session = await make_session(storage)
    assert session.status == "active"
    assert session.title is None
    fetched = await SessionsDAO(storage.factory).get_session(session_id=session.id)
    assert fetched == session


async def test_create_session_unknown_revision_raises(storage):
    with pytest.raises(RevisionNotFound):
        await SessionsDAO(storage.factory).create_session(agent_revision_id="rev_nope")


async def test_list_sessions_filters_by_status(storage):
    dao = SessionsDAO(storage.factory)
    _, active = await make_session(storage)
    _, other = await make_session(storage)

    await dao.archive_session(session_id=other.id)
    listed = await dao.list_sessions()
    assert [s.id for s in listed] == [active.id]
    archived = await dao.list_sessions(status="archived")
    assert [s.id for s in archived] == [other.id]


async def test_archive_session_flips_status(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    archived = await dao.archive_session(session_id=session.id)
    assert archived.status == "archived"
    fetched = await dao.get_session(session_id=session.id)
    assert fetched.status == "archived"


async def test_begin_turn_inserts_pending_turn(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    turn = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    assert turn.status == "pending"
    assert turn.started_at is None and turn.finished_at is None


async def test_begin_turn_replays_exact_duplicate(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    first = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    replay = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    assert replay.id == first.id
    assert replay.status == first.status


async def test_begin_turn_replays_terminal_duplicate_without_new_run(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    turn = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    await dao.finish_turn(turn_id=turn.id, status="running")
    await dao.finish_turn(turn_id=turn.id, status="failed", error_json='{"e": 1}')

    replay = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    assert replay.id == turn.id
    assert replay.status == "failed"


async def test_begin_turn_conflicts_on_same_client_id_different_hash(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    await dao.begin_turn(session_id=session.id, client_turn_id="c1", input_hash="h1")
    with pytest.raises(IdempotencyConflict):
        await dao.begin_turn(
            session_id=session.id, client_turn_id="c1", input_hash="h2"
        )


async def test_begin_turn_rejects_second_active_turn(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    active = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    with pytest.raises(SessionBusy):
        await dao.begin_turn(
            session_id=session.id, client_turn_id="c2", input_hash="h2"
        )

    # After the active turn reaches a terminal state a new turn is admitted.
    await dao.finish_turn(turn_id=active.id, status="cancelled")
    next_turn = await dao.begin_turn(
        session_id=session.id, client_turn_id="c2", input_hash="h2"
    )
    assert next_turn.status == "pending"


async def test_begin_turn_unknown_session_raises(storage):
    with pytest.raises(SessionNotFound):
        await SessionsDAO(storage.factory).begin_turn(
            session_id="ses_nope", client_turn_id="c1", input_hash="h1"
        )


def _seeded_status_cases():
    statuses = [
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
    ]
    return [
        (frm, to, to in ALLOWED_TURN_TRANSITIONS.get(frm, frozenset()))
        for frm in statuses
        for to in statuses
    ]


@pytest.mark.parametrize(
    ("from_status", "to_status", "allowed"), _seeded_status_cases()
)
async def test_transition_matrix(storage, from_status, to_status, allowed):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    turn_id = await _seed_turn(storage, session.id, status=from_status)

    if allowed:
        result = await dao.finish_turn(turn_id=turn_id, status=to_status)
        assert result.status == to_status
        if to_status == "running":
            assert result.started_at is not None
        if to_status in ("completed", "failed", "cancelled", "interrupted"):
            assert result.finished_at is not None
    else:
        with pytest.raises(TurnNotActive):
            await dao.finish_turn(turn_id=turn_id, status=to_status)


async def test_finish_turn_error_json_is_stored_and_parsed(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    turn = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    failed = await dao.finish_turn(
        turn_id=turn.id, status="failed", error_json='{"kind": "provider"}'
    )
    assert failed.error == {"kind": "provider"}
    fetched = await dao.get_session(session_id=session.id)
    assert fetched is not None


async def test_finish_turn_unknown_turn_raises(storage):
    with pytest.raises(TurnNotFound):
        await SessionsDAO(storage.factory).finish_turn(
            turn_id="trn_nope", status="running"
        )


async def test_append_message_allocates_sequence_per_session(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    turn = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    m0 = await dao.append_message(
        session_id=session.id, turn_id=turn.id, role="user", content_json=CONTENT
    )
    m1 = await dao.append_message(
        session_id=session.id, turn_id=turn.id, role="assistant", content_json=CONTENT
    )
    assert (m0.sequence, m1.sequence) == (0, 1)
    assert m0.role == "user"

    messages = await dao.list_messages(session_id=session.id)
    assert [m.sequence for m in messages] == [0, 1]


async def test_append_rejected_once_turn_is_terminal(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    completed = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    await dao.finish_turn(turn_id=completed.id, status="running")
    await dao.finish_turn(turn_id=completed.id, status="completed")

    with pytest.raises(TurnNotActive):
        await dao.append_message(
            session_id=session.id,
            turn_id=completed.id,
            role="assistant",
            content_json=CONTENT,
        )


async def test_failed_append_consumes_no_sequence_number(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    done = await _seed_turn(storage, session.id, status="completed")
    active = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )

    first = await dao.append_message(
        session_id=session.id, turn_id=active.id, role="user", content_json=CONTENT
    )
    with pytest.raises(TurnNotActive):
        await dao.append_message(
            session_id=session.id, turn_id=done, role="user", content_json=CONTENT
        )
    second = await dao.append_message(
        session_id=session.id, turn_id=active.id, role="assistant", content_json=CONTENT
    )
    assert second.sequence == first.sequence + 1


async def test_append_rejects_turn_from_another_session(storage):
    dao = SessionsDAO(storage.factory)
    _, session_a = await make_session(storage)
    _, session_b = await make_session(storage)
    turn_b = await dao.begin_turn(
        session_id=session_b.id, client_turn_id="c1", input_hash="h1"
    )
    with pytest.raises(TurnNotFound):
        await dao.append_message(
            session_id=session_a.id,
            turn_id=turn_b.id,
            role="user",
            content_json=CONTENT,
        )


async def test_list_messages_unknown_session_raises(storage):
    with pytest.raises(SessionNotFound):
        await SessionsDAO(storage.factory).list_messages(session_id="ses_nope")


async def test_interrupt_incomplete_turns_touches_only_active_rows(storage):
    dao = SessionsDAO(storage.factory)
    _, first = await make_session(storage)
    _, second = await make_session(storage)
    # One active turn per session (partial index), so spread states across sessions.
    pending = await _seed_turn(storage, first.id, status="pending")
    completed = await _seed_turn(storage, first.id, status="completed")
    running = await _seed_turn(storage, second.id, status="running")

    changed = await dao.interrupt_incomplete_turns()

    assert changed == 2
    for turn_id, expected_status in (
        (pending, "interrupted"),
        (running, "interrupted"),
        (completed, "completed"),
    ):
        _, status, finished_at = await _raw_turn(storage, turn_id)
        assert status == expected_status
        if expected_status == "interrupted":
            assert finished_at is not None


async def _seed_turn(storage, session_id, *, status) -> str:
    """Insert one turn directly so tests can start from any state."""
    from uuid import uuid4

    from agenta_local.dbs.sqlite.sessions.dbes import TurnDBE
    from agenta_local.dbs.sqlite.shared.engine import immediate_transaction

    turn_id = f"trn_{uuid4().hex}"
    async with immediate_transaction(storage.factory) as conn:
        await conn.execute(
            TurnDBE.__table__.insert().values(
                id=turn_id,
                session_id=session_id,
                client_turn_id=f"seed-{turn_id}",
                input_hash="seed-hash",
                status=status,
            )
        )
    return turn_id


async def _raw_turn(storage, turn_id):
    import sqlalchemy as sa

    async with storage.engine.connect() as conn:
        row = (
            await conn.execute(
                sa.text("SELECT id, status, finished_at FROM turns WHERE id = :id"),
                {"id": turn_id},
            )
        ).one()
    return row[0], row[1], row[2]
