"""The naming facts the invoke prelude puts on ``request.meta``.

The platform prompt tells the agent to rename itself only while its name is a placeholder, and
to name the session once at the start. Neither rule was followable, because the run carried none
of the facts. ``WorkflowsService._stamp_session_context`` supplies them once, in the prelude both
``invoke_workflow`` and ``invoke_workflow_detached`` share, so a UI turn, a HITL resume, and a
trigger fire all get the same answer.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

from oss.src.core.workflows.dtos import WorkflowRevisionData
from oss.src.core.workflows.service import WorkflowsService
from agenta.sdk.models.workflows import (
    WorkflowServiceRequest,
    WorkflowServiceRequestData,
)


AGENT_URI = "agenta:custom:agent:v0"
LLM_URI = "agenta:custom:llm:v0"


def _service(*, agent_name=None, session=None) -> WorkflowsService:
    """A service whose artifact fetch and session read are both stubbed.

    ``session`` is the ``(session_name, first_turn)`` the injected resolver returns; ``None``
    leaves no resolver injected at all, which is the standalone/worker wiring.
    """
    service = WorkflowsService(workflows_dao=AsyncMock())
    service.fetch_workflow = AsyncMock(  # type: ignore[method-assign]
        return_value=(
            None if agent_name is None else type("W", (), {"name": agent_name})()
        )
    )
    if session is not None:
        service.set_session_context_resolver(AsyncMock(return_value=session))
    return service


def _request(*, session_id=None, workflow_id=None, meta=None) -> WorkflowServiceRequest:
    return WorkflowServiceRequest(
        session_id=session_id,
        references=({"workflow": {"id": str(workflow_id)}} if workflow_id else None),
        data=WorkflowServiceRequestData(inputs={}),
        meta=meta,
    )


async def test_an_agent_turn_gets_all_three_facts():
    workflow_id = uuid4()
    service = _service(agent_name="Changelog writer", session=("Q3 notes", False))
    request = _request(session_id="sess-1", workflow_id=workflow_id)

    await service._stamp_session_context(
        project_id=uuid4(),
        request=request,
        revision_data=WorkflowRevisionData(uri=AGENT_URI),
    )

    assert request.meta["session_context"] == {
        "agent_name": "Changelog writer",
        "session_name": "Q3 notes",
        "first_turn": False,
    }


async def test_a_fresh_session_reads_as_unnamed_and_first():
    service = _service(agent_name="New agent", session=(None, True))
    request = _request(session_id="sess-1", workflow_id=uuid4())

    await service._stamp_session_context(
        project_id=uuid4(),
        request=request,
        revision_data=WorkflowRevisionData(uri=AGENT_URI),
    )

    assert request.meta["session_context"]["session_name"] is None
    assert request.meta["session_context"]["first_turn"] is True


async def test_a_trigger_run_is_first_without_reading_a_session():
    # A trigger fire mints a session id and never writes a stream row, so there is nothing to
    # read. It is always the first turn and always unnamed.
    service = _service(agent_name="Daily digest", session=(None, True))
    request = _request(session_id=None, workflow_id=uuid4())

    await service._stamp_session_context(
        project_id=uuid4(),
        request=request,
        revision_data=WorkflowRevisionData(uri=AGENT_URI),
    )

    assert request.meta["session_context"] == {
        "agent_name": "Daily digest",
        "session_name": None,
        "first_turn": True,
    }


async def test_a_non_agent_workflow_is_never_stamped_and_never_read():
    # An evaluation batch runs an LLM workflow per row. Stamping it would buy two session reads
    # per row for text no agent renders.
    service = _service(agent_name="An evaluator", session=("named", False))
    request = _request(session_id="sess-1", workflow_id=uuid4())

    await service._stamp_session_context(
        project_id=uuid4(),
        request=request,
        revision_data=WorkflowRevisionData(uri=LLM_URI),
    )

    assert request.meta is None
    service.fetch_workflow.assert_not_awaited()


async def test_a_caller_supplied_session_context_is_overwritten():
    # Server-owned: a client must not be able to tell the agent it is already named.
    service = _service(agent_name="Changelog writer", session=(None, True))
    request = _request(
        session_id="sess-1",
        workflow_id=uuid4(),
        meta={
            "run_id": "run-1",
            "session_context": {"agent_name": "Root", "session_name": "forged"},
        },
    )

    await service._stamp_session_context(
        project_id=uuid4(),
        request=request,
        revision_data=WorkflowRevisionData(uri=AGENT_URI),
    )

    assert request.meta["session_context"]["agent_name"] == "Changelog writer"
    assert request.meta["session_context"]["session_name"] is None
    # The merge keeps the coordination ids that ride the same carrier.
    assert request.meta["run_id"] == "run-1"


async def test_a_failing_session_read_costs_the_prompt_a_section_not_the_run():
    service = _service(agent_name="Changelog writer")
    service.set_session_context_resolver(AsyncMock(side_effect=RuntimeError("db down")))
    request = _request(session_id="sess-1", workflow_id=uuid4())

    await service._stamp_session_context(
        project_id=uuid4(),
        request=request,
        revision_data=WorkflowRevisionData(uri=AGENT_URI),
    )

    assert request.meta is None


async def test_no_revision_data_is_a_no_op():
    service = _service(agent_name="Changelog writer", session=(None, True))
    request = _request(session_id="sess-1", workflow_id=uuid4())

    await service._stamp_session_context(
        project_id=uuid4(),
        request=request,
        revision_data=None,
    )

    assert request.meta is None
