"""SessionsDAO integration tests: turns, transitions, context, recovery."""

import pytest
from agenta_local.core.agents.types import RevisionNotFound
from agenta_local.core.sessions.types import (
    ALLOWED_TURN_TRANSITIONS,
    IdempotencyConflict,
    SessionBusy,
    SessionNotFound,
    TurnAlreadyExists,
    TurnNotActive,
    TurnNotFound,
)
from agenta_local.dbs.sqlite.agents.dao import AgentsDAO
from agenta_local.dbs.sqlite.sessions.dao import SessionsDAO

MODEL_JSON = '{"provider": "openai", "name": "gpt-5-mini", "parameters": {}}'
EXECUTION_JSON = '{"harness": "pi_core", "sandbox": "local"}'


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


async def test_begin_turn_inserts_pending_turn_and_user_message(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    turn = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input="hi there", input_hash="h1"
    )
    assert turn.status == "pending"
    assert turn.started_at is None and turn.finished_at is None

    messages = await dao.list_messages(session_id=session.id)
    assert [m.sequence for m in messages] == [0]
    assert messages[0].turn_id == turn.id
    assert messages[0].role == "user"
    assert messages[0].content == {"text": "hi there"}


async def test_begin_turn_exact_duplicate_raises_with_existing_identity(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    first = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input="hi", input_hash="h1"
    )
    with pytest.raises(TurnAlreadyExists) as exc_info:
        await dao.begin_turn(
            session_id=session.id, client_turn_id="c1", input="hi", input_hash="h1"
        )
    assert exc_info.value.details["turn_id"] == first.id
    assert exc_info.value.details["status"] == "pending"

    # Terminal duplicates behave identically: never a second run.
    await dao.cancel_turn(turn_id=first.id)
    with pytest.raises(TurnAlreadyExists) as exc_info:
        await dao.begin_turn(
            session_id=session.id, client_turn_id="c1", input="hi", input_hash="h1"
        )
    assert exc_info.value.details["status"] == "cancelled"


async def test_begin_turn_conflicts_on_same_client_id_different_hash(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input="hi", input_hash="h1"
    )
    with pytest.raises(IdempotencyConflict):
        await dao.begin_turn(
            session_id=session.id, client_turn_id="c1", input="bye", input_hash="h2"
        )


async def test_begin_turn_rejects_second_active_turn(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    active = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input="hi", input_hash="h1"
    )
    with pytest.raises(SessionBusy):
        await dao.begin_turn(
            session_id=session.id, client_turn_id="c2", input="bye", input_hash="h2"
        )

    # After the active turn reaches a terminal state a new turn is admitted.
    await dao.cancel_turn(turn_id=active.id)
    next_turn = await dao.begin_turn(
        session_id=session.id, client_turn_id="c2", input="bye", input_hash="h2"
    )
    assert next_turn.status == "pending"


async def test_begin_turn_unknown_session_raises(storage):
    with pytest.raises(SessionNotFound):
        await SessionsDAO(storage.factory).begin_turn(
            session_id="ses_nope", client_turn_id="c1", input="hi", input_hash="h1"
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


def _apply_target(dao, *, turn_id, to_status):
    if to_status == "pending":
        raise TurnNotActive("pending is never a target")
    if to_status == "running":
        return dao.mark_turn_running(turn_id=turn_id)
    if to_status == "completed":
        return dao.complete_turn(turn_id=turn_id, assistant_message="done")
    if to_status == "failed":
        return dao.fail_turn(turn_id=turn_id, error='{"kind": "x"}')
    if to_status == "cancelled":
        return dao.cancel_turn(turn_id=turn_id)
    return dao.interrupt_turn(turn_id=turn_id, error='{"kind": "y"}')


@pytest.mark.parametrize(
    ("from_status", "to_status", "allowed"), _seeded_status_cases()
)
async def test_transition_matrix(storage, from_status, to_status, allowed):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    turn_id = await _seed_turn(storage, session.id, status=from_status)

    if allowed:
        result = await _apply_target(dao, turn_id=turn_id, to_status=to_status)
        assert result.status == to_status
        if to_status == "running":
            assert result.started_at is not None
        if to_status != "running" and to_status != "pending":
            assert result.finished_at is not None
    else:
        with pytest.raises(TurnNotActive):
            await _apply_target(dao, turn_id=turn_id, to_status=to_status)


async def test_complete_turn_inserts_assistant_message_atomically(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    turn = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input="q", input_hash="h1"
    )
    await dao.mark_turn_running(turn_id=turn.id)
    completed = await dao.complete_turn(turn_id=turn.id, assistant_message="answer")

    assert completed.status == "completed"
    messages = await dao.list_messages(session_id=session.id)
    assert [(m.sequence, m.role, m.content) for m in messages] == [
        (0, "user", {"text": "q"}),
        (1, "assistant", {"text": "answer"}),
    ]


async def test_fail_turn_error_json_is_stored_and_parsed(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    turn = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input="hi", input_hash="h1"
    )
    failed = await dao.fail_turn(turn_id=turn.id, error='{"kind": "provider"}')
    assert failed.error == {"kind": "provider"}
    assert failed.finished_at is not None


async def test_terminal_ops_unknown_turn_raises(storage):
    dao = SessionsDAO(storage.factory)
    for operation in (
        lambda: dao.mark_turn_running(turn_id="trn_nope"),
        lambda: dao.complete_turn(turn_id="trn_nope", assistant_message="x"),
        lambda: dao.fail_turn(turn_id="trn_nope", error="{}"),
        lambda: dao.cancel_turn(turn_id="trn_nope"),
        lambda: dao.interrupt_turn(turn_id="trn_nope", error="{}"),
    ):
        with pytest.raises(TurnNotFound):
            await operation()


async def test_load_completed_context_excludes_failed_and_includes_current_user(
    storage,
):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)

    done = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input="q1", input_hash="h1"
    )
    await dao.mark_turn_running(turn_id=done.id)
    await dao.complete_turn(turn_id=done.id, assistant_message="a1")

    doomed = await dao.begin_turn(
        session_id=session.id, client_turn_id="c2", input="q2", input_hash="h2"
    )
    await dao.fail_turn(turn_id=doomed.id, error="{}")

    current = await dao.begin_turn(
        session_id=session.id, client_turn_id="c3", input="q3", input_hash="h3"
    )

    context = await dao.load_completed_context(
        session_id=session.id, current_turn_id=current.id
    )
    assert [(m.sequence, m.role.value, m.content["text"]) for m in context] == [
        (0, "user", "q1"),
        (1, "assistant", "a1"),
        (3, "user", "q3"),
    ]


async def test_list_messages_returns_rows_from_all_turn_states(storage):
    dao = SessionsDAO(storage.factory)
    _, session = await make_session(storage)
    ok = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input="kept", input_hash="h1"
    )
    await dao.cancel_turn(turn_id=ok.id)
    bad = await dao.begin_turn(
        session_id=session.id, client_turn_id="c2", input="also kept", input_hash="h2"
    )
    await dao.fail_turn(turn_id=bad.id, error="{}")

    messages = await dao.list_messages(session_id=session.id)
    assert [m.content["text"] for m in messages] == ["kept", "also kept"]


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
