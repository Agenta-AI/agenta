"""Concurrency tests: two asyncio tasks racing against one file-backed engine.

Every write path runs inside immediate_transaction (BEGIN IMMEDIATE), so the
second task blocks in SQLite's busy_timeout until the first commits and then
re-evaluates its invariants against the committed state.
"""

import asyncio

from agenta_local.core.sessions.types import SessionBusy
from agenta_local.dbs.sqlite.agents.dao import AgentsDAO
from agenta_local.dbs.sqlite.sessions.dao import SessionsDAO

MODEL_JSON = '{"provider": "openai", "name": "gpt-5-mini", "parameters": {}}'
EXECUTION_JSON = '{"harness": "pi_core", "sandbox": "local"}'
CONTENT = '{"type": "text", "text": "hi"}'


async def make_sessions_dao(storage):
    agents = AgentsDAO(storage.factory)
    agent = await agents.create_agent(
        name="agent",
        instructions="do things",
        model_json=MODEL_JSON,
        execution_json=EXECUTION_JSON,
    )
    dao = SessionsDAO(storage.factory)
    session = await dao.create_session(agent_revision_id=agent.current_revision.id)
    return dao, agent, session


async def test_concurrent_begin_turns_single_winner(storage):
    dao, _, session = await make_sessions_dao(storage)

    results = await asyncio.gather(
        dao.begin_turn(session_id=session.id, client_turn_id="c1", input_hash="h"),
        dao.begin_turn(session_id=session.id, client_turn_id="c2", input_hash="h"),
        return_exceptions=True,
    )

    turns = [r for r in results if not isinstance(r, BaseException)]
    busy = [r for r in results if isinstance(r, SessionBusy)]
    assert len(turns) == 1
    assert len(busy) == 1
    assert turns[0].status == "pending"


async def test_concurrent_same_client_id_is_idempotent(storage):
    dao, _, session = await make_sessions_dao(storage)

    first, second = await asyncio.gather(
        dao.begin_turn(session_id=session.id, client_turn_id="c1", input_hash="h"),
        dao.begin_turn(session_id=session.id, client_turn_id="c1", input_hash="h"),
    )

    assert first.id == second.id


async def test_concurrent_appends_to_two_sessions_interleave(storage):
    dao, _, first_session = await make_sessions_dao(storage)
    _, _, other_session = await make_sessions_dao(storage)
    turn_a = await dao.begin_turn(
        session_id=first_session.id, client_turn_id="a", input_hash="h"
    )
    turn_b = await dao.begin_turn(
        session_id=other_session.id, client_turn_id="b", input_hash="h"
    )

    async def append_five(session_id, turn_id):
        for _ in range(5):
            await dao.append_message(
                session_id=session_id,
                turn_id=turn_id,
                role="user",
                content_json=CONTENT,
            )

    await asyncio.gather(
        append_five(first_session.id, turn_a.id),
        append_five(other_session.id, turn_b.id),
    )

    for session_id in (first_session.id, other_session.id):
        messages = await dao.list_messages(session_id=session_id)
        assert [m.sequence for m in messages] == list(range(5))


async def test_concurrent_revision_allocation_gets_distinct_versions(storage):
    agents = AgentsDAO(storage.factory)
    agent = await agents.create_agent(
        name="agent",
        instructions="v1",
        model_json=MODEL_JSON,
        execution_json=EXECUTION_JSON,
    )

    revisions = await asyncio.gather(
        agents.create_revision(
            agent_id=agent.id,
            instructions="v2",
            model_json=MODEL_JSON,
            execution_json=EXECUTION_JSON,
        ),
        agents.create_revision(
            agent_id=agent.id,
            instructions="v3",
            model_json=MODEL_JSON,
            execution_json=EXECUTION_JSON,
        ),
    )

    versions = sorted(r.version for r in revisions)
    assert versions == [2, 3]
    listed = await agents.list_revisions(agent_id=agent.id)
    assert sorted(r.version for r in listed) == [1, 2, 3]
