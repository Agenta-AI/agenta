"""AgentsDAO integration tests against a migrated file-backed database."""

import pytest
from agenta_local.core.agents.types import (
    AgentInUse,
    AgentNotFound,
    RevisionNotFound,
)
from agenta_local.dbs.sqlite.agents.dao import AgentsDAO
from agenta_local.dbs.sqlite.sessions.dao import SessionsDAO

MODEL_JSON = '{"provider": "openai", "name": "gpt-5-mini", "parameters": {}}'
EXECUTION_JSON = '{"harness": "pi_core", "sandbox": "local"}'


def make_agents_dao(storage) -> AgentsDAO:
    return AgentsDAO(storage.factory)


async def make_agent(storage, name="agent"):
    dao = AgentsDAO(storage.factory)
    return await dao.create_agent(
        name=name,
        instructions="do things",
        model_json=MODEL_JSON,
        execution_json=EXECUTION_JSON,
    )


async def test_create_agent_inserts_agent_and_first_revision_atomically(storage):
    agent = await make_agent(storage)

    assert agent.name == "agent"
    assert agent.current_revision.version == 1
    assert agent.current_revision.instructions == "do things"
    assert agent.current_revision.model.provider == "openai"
    assert agent.current_revision.execution.harness == "pi_core"
    assert agent.created_at.tzinfo is not None


async def test_get_agent_round_trips_current_revision(storage):
    dao = AgentsDAO(storage.factory)
    agent = await make_agent(storage)
    fetched = await dao.get_agent(agent_id=agent.id)
    assert fetched == agent


async def test_get_agent_missing_returns_none(storage):
    assert await AgentsDAO(storage.factory).get_agent(agent_id="agt_nope") is None


async def test_list_agents_orders_by_updated_at_desc(storage):
    dao = AgentsDAO(storage.factory)
    first = await make_agent(storage, name="first")
    second = await make_agent(storage, name="second")

    listed = await dao.list_agents()
    assert [a.name for a in listed] == ["second", "first"]

    await dao.rename_agent(agent_id=first.id, name="renamed")
    listed = await dao.list_agents()
    assert [a.name for a in listed] == ["renamed", "second"]
    assert listed[0].id == first.id
    assert listed[1].id == second.id


async def test_rename_changes_metadata_only(storage):
    dao = AgentsDAO(storage.factory)
    agent = await make_agent(storage)

    renamed = await dao.rename_agent(agent_id=agent.id, name="new name")
    assert renamed.current_revision == agent.current_revision

    revisions = await dao.list_revisions(agent_id=agent.id)
    assert len(revisions) == 1


async def test_create_revision_allocates_max_plus_one_and_moves_current(storage):
    dao = AgentsDAO(storage.factory)
    agent = await make_agent(storage)

    rev2 = await dao.create_revision(
        agent_id=agent.id,
        instructions="v2",
        model_json=MODEL_JSON,
        execution_json=EXECUTION_JSON,
    )
    rev3 = await dao.create_revision(
        agent_id=agent.id,
        instructions="v3",
        model_json=MODEL_JSON,
        execution_json=EXECUTION_JSON,
    )
    assert (rev2.version, rev3.version) == (2, 3)

    fetched = await dao.get_agent(agent_id=agent.id)
    assert fetched.current_revision.id == rev3.id

    await dao.set_current_revision(agent_id=agent.id, revision_id=rev2.id)
    fetched = await dao.get_agent(agent_id=agent.id)
    assert fetched.current_revision.id == rev2.id


async def test_set_current_revision_rejects_foreign_revision(storage):
    dao = AgentsDAO(storage.factory)
    agent_a = await make_agent(storage, name="a")
    agent_b = await make_agent(storage, name="b")

    with pytest.raises(RevisionNotFound):
        await dao.set_current_revision(
            agent_id=agent_a.id, revision_id=agent_b.current_revision.id
        )


async def test_list_revisions_ordered_latest_first(storage):
    dao = AgentsDAO(storage.factory)
    agent = await make_agent(storage)
    rev2 = await dao.create_revision(
        agent_id=agent.id,
        instructions="v2",
        model_json=MODEL_JSON,
        execution_json=EXECUTION_JSON,
    )
    revisions = await dao.list_revisions(agent_id=agent.id)
    assert [r.version for r in revisions] == [2, 1]
    assert revisions[0].id == rev2.id


async def test_get_revision_missing_returns_none(storage):
    assert await AgentsDAO(storage.factory).get_revision(revision_id="rev_nope") is None


async def test_delete_removes_agent_and_revisions_without_sessions(storage):
    dao = AgentsDAO(storage.factory)
    agent = await make_agent(storage)

    await dao.delete_agent(agent_id=agent.id)

    assert await dao.get_agent(agent_id=agent.id) is None
    assert await dao.get_revision(revision_id=agent.current_revision.id) is None


async def test_delete_blocked_while_sessions_reference_revisions(storage):
    agents = AgentsDAO(storage.factory)
    sessions = SessionsDAO(storage.factory)
    agent = await make_agent(storage)
    await sessions.create_session(agent_revision_id=agent.current_revision.id)

    with pytest.raises(AgentInUse):
        await agents.delete_agent(agent_id=agent.id)

    assert await agents.get_agent(agent_id=agent.id) is not None


async def test_missing_agent_raises_typed_errors(storage):
    dao = AgentsDAO(storage.factory)
    with pytest.raises(AgentNotFound):
        await dao.rename_agent(agent_id="agt_nope", name="x")
    with pytest.raises(AgentNotFound):
        await dao.create_revision(
            agent_id="agt_nope",
            instructions="i",
            model_json=MODEL_JSON,
            execution_json=EXECUTION_JSON,
        )
    with pytest.raises(AgentNotFound):
        await dao.set_current_revision(agent_id="agt_nope", revision_id="rev_x")
