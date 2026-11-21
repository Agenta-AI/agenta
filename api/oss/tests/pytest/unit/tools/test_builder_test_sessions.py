"""The builder tests an agent in a child session (design D12, D13, D18, D23).

The builder is a static workflow with no database row. These tests take its identity and
the references of its turn from the real static catalog, and run the real `may_start`,
`start_revision` and `session_scope_for`, so that a change to the catalog ids or to the
turn references that a builder run writes fails here.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

from oss.src.core.access.dtos import RunOrigin
from oss.src.core.sessions.types import SessionReference
from oss.src.core.shared.dtos import Reference
from oss.src.core.tools.platform_handlers import SessionCaller, session_scope_for
from oss.src.core.workflows.builder_agent import BUILDER_AGENT_SLUG
from oss.src.core.workflows.dtos import WorkflowServiceRequest
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.static_catalog import (
    BUILDER_AGENT_ID,
    StaticWorkflowCatalog,
    is_builder_agent,
)
from oss.tests.pytest.unit.tools.test_session_write_handlers import (
    _World,
    _call,
    _error,
    _lines,
)

CATALOG = StaticWorkflowCatalog()
BUILDER = CATALOG.retrieve_revision(slug=BUILDER_AGENT_SLUG)


@pytest.fixture
def world(monkeypatch) -> _World:
    import oss.src.core.access.service as access_module
    import oss.src.core.sharing.service as sharing_module

    world = _World()
    monkeypatch.setattr(access_module, "_access_service", world.access)
    monkeypatch.setattr(sharing_module, "_sharing_service", world.sharing.service)
    return world


async def _builder_turn_references() -> list:
    """The references that a builder run resolves, as its turn row stores them: the
    request references after `_ensure_request_revision`, for a project that never
    committed the builder's editable fields."""
    workflows_dao = AsyncMock()
    workflows_dao.fetch_revision.return_value = None
    service = WorkflowsService(workflows_dao=workflows_dao, static_catalog=CATALOG)
    request = WorkflowServiceRequest(
        references={"workflow": {"slug": BUILDER_AGENT_SLUG}}
    )
    await service._ensure_request_revision(project_id=uuid4(), request=request)
    return [
        SessionReference(key=key, id=reference.id, slug=reference.slug)
        for key, reference in request.references.items()
    ]


def _builder_caller(world):
    """Ana's private builder session, running a turn whose row holds the references of a
    builder run. The run credential names the builder by its catalog artifact id."""
    caller, execution_id = world.calling(agent=None, with_turn=False)
    caller = SessionCaller(
        envelope=caller.envelope,
        run_session_id=caller.run_session_id,
        run_agent_id=BUILDER.artifact_id,
    )
    return caller, execution_id


async def _add_builder_turn(world, caller, execution_id):
    world.store.turns[(caller.run_session_id, execution_id)] = SimpleNamespace(
        turn_id=UUID(execution_id),
        turn_index=0,
        references=await _builder_turn_references(),
        context=SimpleNamespace(origin=RunOrigin.WEB, origin_id=None),
    )


def test_the_run_credential_of_a_builder_run_names_the_builder():
    """`is_builder_agent` matches the id that a builder run carries as `run_agent_id`."""
    assert BUILDER.artifact_id == BUILDER_AGENT_ID
    assert is_builder_agent(BUILDER.artifact_id)
    assert not is_builder_agent(uuid4())
    assert not is_builder_agent(None)


@pytest.mark.asyncio
async def test_a_builder_turn_names_its_static_revision():
    references = {ref.key: ref for ref in await _builder_turn_references()}

    assert references["workflow"].id == BUILDER.workflow_id
    assert references["workflow_revision"].id == BUILDER.id


@pytest.mark.asyncio
async def test_the_builder_starts_a_test_session_of_email_writer(world):
    """The main use: the builder's start is admitted, with no Subagent entries, and the
    child records the builder and its static revision as the calling session."""
    email = world.workflows.add("email-writer")
    caller, execution_id = _builder_caller(world)
    await _add_builder_turn(world, caller, execution_id)

    result = await _call(
        world,
        "start_session",
        caller,
        agent="email-writer",
        text="Write a welcome email to Dana",
        wait_ms=0,
        tool_call_id="call-1",
    )

    assert result.ok, result.content
    start = world.starts.starts[0]
    assert start["workflow_id"] == email.id
    assert start["calling_session"].agent_id == BUILDER_AGENT_ID
    assert start["calling_session"].revision_id == BUILDER.id
    assert start["calling_session"].id == caller.run_session_id
    assert start["message"] == "Write a welcome email to Dana"
    assert _lines(result.content)["status"] == "running"


@pytest.mark.asyncio
async def test_a_child_session_of_the_builder_runs_the_latest_revision(world):
    """The builder has no Subagent entries, so it never pins: the child runs the latest
    revision of the agent, and the result names that version."""
    email = world.workflows.add("email-writer")
    world.workflows.pin(email, ("version", "3"), "3")
    caller, execution_id = _builder_caller(world)
    await _add_builder_turn(world, caller, execution_id)

    result = await _call(
        world,
        "start_session",
        caller,
        agent="email-writer",
        text="Go",
        wait_ms=0,
        tool_call_id="call-1",
    )

    assert result.ok, result.content
    assert world.workflows.resolved == [{"workflow": Reference(id=email.id)}]
    assert world.starts.starts[0]["revision_id"] == email.latest
    assert _lines(result.content)["revision"].startswith("9 ")


@pytest.mark.asyncio
async def test_the_builder_cannot_start_itself(world):
    world.workflows.add(BUILDER_AGENT_SLUG, is_static=True)
    caller, execution_id = _builder_caller(world)
    await _add_builder_turn(world, caller, execution_id)

    result = await _call(
        world,
        "start_session",
        caller,
        agent=BUILDER_AGENT_SLUG,
        text="Go",
        tool_call_id="call-1",
    )

    assert _error(result)["code"] == "agent_is_static"
    assert world.starts.starts == []


def test_the_builder_reads_every_session_the_person_can_see():
    """`session_scope_for` gives the builder no agent bound (design D23); any other agent
    is bound to the sessions it created."""
    envelope = SimpleNamespace()
    builder = SessionCaller(
        envelope=envelope, run_session_id="s-1", run_agent_id=BUILDER.artifact_id
    )
    other_id = uuid4()
    other = SessionCaller(
        envelope=envelope, run_session_id="s-1", run_agent_id=other_id
    )

    assert session_scope_for(builder).calling_agent_ids is None
    assert session_scope_for(other).calling_agent_ids == frozenset({other_id})
