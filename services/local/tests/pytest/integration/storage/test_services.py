"""Core services over real DAOs: validation at the service edge, typed failures."""

import pytest
from agenta_local.core.agents.service import AgentsService
from agenta_local.core.agents.types import ImmutableRevision
from agenta_local.core.sessions.service import SessionsService
from agenta_local.core.sessions.types import TurnNotActive
from agenta_local.dbs.sqlite.agents.dao import AgentsDAO
from agenta_local.dbs.sqlite.sessions.dao import SessionsDAO

MODEL_JSON = '{"provider": "openai", "name": "gpt-5-mini", "parameters": {}}'
EXECUTION_JSON = '{"harness": "pi_core", "sandbox": "local"}'


@pytest.fixture
def agents_service(storage):
    return AgentsService(AgentsDAO(storage.factory))


@pytest.fixture
def sessions_service(storage):
    return SessionsService(SessionsDAO(storage.factory))


async def make_agent(agents_service, name="agent"):
    return await agents_service.create_agent(
        name=name,
        instructions="do things",
        model_json=MODEL_JSON,
        execution_json=EXECUTION_JSON,
    )


async def test_create_agent_trims_name(agents_service):
    agent = await make_agent(agents_service, name="  spaced  ")
    assert agent.name == "spaced"


@pytest.mark.parametrize("name", ["", "   ", "\t"])
async def test_create_agent_rejects_blank_name(agents_service, name):
    with pytest.raises(ValueError, match="non-empty"):
        await agents_service.create_agent(
            name=name,
            instructions="i",
            model_json=MODEL_JSON,
            execution_json=EXECUTION_JSON,
        )


async def test_rename_rejects_blank_name(agents_service):
    agent = await make_agent(agents_service)
    with pytest.raises(ValueError, match="non-empty"):
        await agents_service.rename_agent(agent_id=agent.id, name="  ")


@pytest.mark.parametrize("payload", ["not json", "[1, 2]", '"str"', "42"])
async def test_create_revision_rejects_non_object_json(agents_service, payload):
    agent = await make_agent(agents_service)
    with pytest.raises(ValueError, match="JSON"):
        await agents_service.create_revision(
            agent_id=agent.id,
            instructions="i",
            model_json=payload,
            execution_json=EXECUTION_JSON,
        )


async def test_update_revision_is_rejected_as_immutable(agents_service):
    agent = await make_agent(agents_service)
    with pytest.raises(ImmutableRevision):
        agents_service.update_revision(revision_id=agent.current_revision.id)


async def test_begin_turn_requires_client_turn_id(sessions_service, agents_service):
    agent = await make_agent(agents_service)
    session = await sessions_service.create_session(
        agent_revision_id=agent.current_revision.id
    )
    with pytest.raises(ValueError, match="client_turn_id"):
        await sessions_service.begin_turn(
            session_id=session.id, client_turn_id="  ", input_hash="h"
        )


async def test_append_message_validates_role_and_content(
    sessions_service, agents_service
):
    agent = await make_agent(agents_service)
    session = await sessions_service.create_session(
        agent_revision_id=agent.current_revision.id
    )
    turn = await sessions_service.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    with pytest.raises(ValueError):
        await sessions_service.append_message(
            session_id=session.id,
            turn_id=turn.id,
            role="developer",
            content_json='{"text": "hi"}',
        )
    with pytest.raises(ValueError, match="content_json"):
        await sessions_service.append_message(
            session_id=session.id, turn_id=turn.id, role="user", content_json="nope"
        )
    message = await sessions_service.append_message(
        session_id=session.id,
        turn_id=turn.id,
        role="user",
        content_json='{"type": "text", "text": "hi"}',
    )
    assert message.role == "user"


async def test_finish_turn_validates_status_and_error_payload(
    sessions_service, agents_service
):
    agent = await make_agent(agents_service)
    session = await sessions_service.create_session(
        agent_revision_id=agent.current_revision.id
    )
    turn = await sessions_service.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    with pytest.raises(ValueError):
        await sessions_service.finish_turn(turn_id=turn.id, status="exploded")
    failed = await sessions_service.finish_turn(
        turn_id=turn.id, status="failed", error_json='{"kind": "provider"}'
    )
    assert failed.status == "failed"

    with pytest.raises(TurnNotActive):
        await sessions_service.append_message(
            session_id=session.id,
            turn_id=turn.id,
            role="assistant",
            content_json='{"text": "late"}',
        )


async def test_finish_turn_accepts_plain_string_status(
    sessions_service, agents_service
):
    agent = await make_agent(agents_service)
    session = await sessions_service.create_session(
        agent_revision_id=agent.current_revision.id
    )
    turn = await sessions_service.begin_turn(
        session_id=session.id, client_turn_id="c1", input_hash="h1"
    )
    running = await sessions_service.finish_turn(turn_id=turn.id, status="running")
    assert running.status == "running"
