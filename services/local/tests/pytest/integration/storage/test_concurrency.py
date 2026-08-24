"""Concurrency tests: two asyncio tasks racing against one file-backed engine.

Every write path runs inside immediate_transaction (BEGIN IMMEDIATE), so the
second task blocks in SQLite's busy_timeout until the first commits and then
re-evaluates its invariants against the committed state.
"""

import asyncio

from agenta_local.core.sessions.types import SessionBusy, TurnAlreadyExists
from agenta_local.dbs.sqlite.agents.dao import AgentsDAO
from agenta_local.dbs.sqlite.sessions.dao import SessionsDAO

MODEL_JSON = '{"provider": "openai", "name": "gpt-5-mini", "parameters": {}}'
EXECUTION_JSON = '{"harness": "pi_core", "sandbox": "local"}'


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
        dao.begin_turn(
            session_id=session.id, client_turn_id="c1", input="hi", input_hash="h"
        ),
        dao.begin_turn(
            session_id=session.id, client_turn_id="c2", input="hi", input_hash="h"
        ),
        return_exceptions=True,
    )

    turns = [r for r in results if not isinstance(r, BaseException)]
    busy = [r for r in results if isinstance(r, SessionBusy)]
    assert len(turns) == 1
    assert len(busy) == 1
    assert turns[0].status == "pending"


async def test_concurrent_same_client_id_single_row(storage):
    dao, _, session = await make_sessions_dao(storage)

    results = await asyncio.gather(
        dao.begin_turn(
            session_id=session.id, client_turn_id="c1", input="hi", input_hash="h"
        ),
        dao.begin_turn(
            session_id=session.id, client_turn_id="c1", input="hi", input_hash="h"
        ),
        return_exceptions=True,
    )

    turns = [r for r in results if not isinstance(r, BaseException)]
    duplicates = [r for r in results if isinstance(r, TurnAlreadyExists)]
    assert len(turns) == 1
    assert len(duplicates) == 1
    assert duplicates[0].details["turn_id"] == turns[0].id


async def test_concurrent_begins_across_two_sessions_interleave(storage):
    dao, _, first_session = await make_sessions_dao(storage)
    _, _, other_session = await make_sessions_dao(storage)

    await asyncio.gather(
        dao.begin_turn(
            session_id=first_session.id,
            client_turn_id="a",
            input="one",
            input_hash="ha",
        ),
        dao.begin_turn(
            session_id=other_session.id,
            client_turn_id="b",
            input="two",
            input_hash="hb",
        ),
    )

    for session_id, text in ((first_session.id, "one"), (other_session.id, "two")):
        messages = await dao.list_messages(session_id=session_id)
        assert [(m.sequence, m.content["text"]) for m in messages] == [(0, text)]


async def test_concurrent_complete_races_resolve_to_one_terminal_state(storage):
    dao, _, session = await make_sessions_dao(storage)
    turn = await dao.begin_turn(
        session_id=session.id, client_turn_id="c1", input="hi", input_hash="h"
    )
    await dao.mark_turn_running(turn_id=turn.id)

    results = await asyncio.gather(
        dao.complete_turn(turn_id=turn.id, assistant_message="first"),
        dao.cancel_turn(turn_id=turn.id),
        return_exceptions=True,
    )

    succeeded = [r for r in results if not isinstance(r, BaseException)]
    rejected = [
        r
        for r in results
        if isinstance(r, Exception) and not isinstance(r, asyncio.CancelledError)
    ]
    assert len(succeeded) == 1
    assert len(rejected) == 1

    from agenta_local.core.sessions.types import TurnStatus

    final = await dao.get_session(session_id=session.id)
    assert final is not None
    messages = await dao.list_messages(session_id=session.id)
    if isinstance(succeeded[0], object) and succeeded[0].status == TurnStatus.COMPLETED:
        assert [m.role.value for m in messages] == ["user", "assistant"]
    else:
        assert [m.role.value for m in messages] == ["user"]


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
