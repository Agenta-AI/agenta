"""A commit must not store agent instructions the runtime reads as "no prompt".

The runtime takes the prompt only from `parameters.agent.instructions.agents_md`. Revisions
written by scripts stored `instructions` as a bare string; every commit answered 200 and the
agent then ran with an empty prompt, silently. The rule now refuses any present
`instructions` that is not an object with a string `agents_md`, on every commit path, and
leaves agents that carry no instructions alone.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.responses import JSONResponse

from oss.src.apis.fastapi.workflows.exceptions import handle_workflow_exceptions
from oss.src.core.tools.platform_handlers import handle_commit_revision
from oss.src.core.applications.dtos import (
    SimpleApplicationCreate,
    SimpleApplicationEdit,
)
from oss.src.core.applications.service import SimpleApplicationsService
from oss.src.core.workflows.dtos import (
    SimpleWorkflowCreate,
    SimpleWorkflowEdit,
    WorkflowRevision,
    WorkflowRevisionCommit,
)
from oss.src.core.workflows.service import (
    SimpleWorkflowsService,
    WorkflowsService,
    _reject_unreadable_agent_instructions,
)
from oss.src.core.workflows.types import InvalidAgentInstructionsError


def _data(instructions):
    return {"parameters": {"agent": {"instructions": instructions}}}


REFUSED = [
    pytest.param("You are a QA bot.", "str", id="string"),
    pytest.param("", "str", id="empty-string"),
    pytest.param(42, "int", id="number"),
    pytest.param(["You are a QA bot."], "list", id="list"),
    pytest.param({}, "dict", id="empty-object"),
    pytest.param(
        {"system": "You are a QA bot."}, "dict", id="object-without-agents_md"
    ),
    pytest.param({"agents_md": None}, "dict", id="agents_md-null"),
    pytest.param({"agents_md": 42}, "dict", id="agents_md-number"),
    pytest.param({"agents_md": ["x"]}, "dict", id="agents_md-list"),
]


class TestValuesItRefuses:
    @pytest.mark.parametrize("instructions,received_type", REFUSED)
    def test_a_shape_without_a_string_agents_md_is_refused(
        self, instructions, received_type
    ):
        with pytest.raises(InvalidAgentInstructionsError) as caught:
            _reject_unreadable_agent_instructions(_data(instructions))

        detail = caught.value.to_detail()
        assert detail["code"] == "invalid_agent_instructions"
        assert detail["retryable"] is False
        assert detail["details"]["field"] == "parameters.agent.instructions"
        assert detail["details"]["received_type"] == received_type
        assert "instructions.agents_md" in detail["message"]
        assert '{"agents_md": "..."}' in detail["message"]
        assert detail["next_step"]
        # The prompt itself is never echoed back.
        assert "You are a QA bot." not in str(detail)
        JSONResponse(detail)


class TestCommitsItLeavesAlone:
    @pytest.mark.parametrize(
        "data",
        [
            None,
            {},
            {"parameters": None},
            {"parameters": {}},
            {"parameters": {"agent": None}},
            # An agent with no instructions is a valid configuration.
            {"parameters": {"agent": {}}},
            {"parameters": {"agent": {"llm": {"model": "gpt-5.5"}}}},
            {"parameters": {"agent": {"instructions": None}}},
            _data({"agents_md": "# Agent\n\nAnswer briefly."}),
            _data({"agents_md": ""}),
            _data({"agents_md": "x", "extra": 1}),
            # Not an agent: a top-level `instructions` elsewhere is not this field.
            {"parameters": {"prompt": {"instructions": "hi"}}},
        ],
    )
    def test_a_readable_or_absent_value_passes(self, data):
        _reject_unreadable_agent_instructions(data)


def _service():
    workflows_dao = AsyncMock()
    workflows_dao.fetch_revision.return_value = None
    workflows_dao.fetch_variant.return_value = None
    return WorkflowsService(workflows_dao=workflows_dao), workflows_dao


def _commit(instructions):
    return WorkflowRevisionCommit(
        slug="instr-check",
        workflow_variant_id=uuid4(),
        data={"uri": "agenta:builtin:agent:v0", **_data(instructions)},
    )


class TestNothingIsPersisted:
    @pytest.mark.asyncio
    async def test_the_checked_commit_refuses_before_the_dao(self):
        service, dao = _service()

        with pytest.raises(InvalidAgentInstructionsError):
            await service.commit_workflow_revision_checked(
                project_id=uuid4(),
                user_id=uuid4(),
                workflow_revision_commit=_commit("You are a QA bot."),
            )

        dao.commit_revision.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_the_plain_commit_refuses_too(self):
        # Simple application/workflow create and edit, and the application revision
        # routes, reach the store through this method, not the checked one.
        service, dao = _service()

        with pytest.raises(InvalidAgentInstructionsError):
            await service.commit_workflow_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                workflow_revision_commit=_commit("You are a QA bot."),
            )

        dao.commit_revision.assert_not_awaited()


class TestTheRefusalReachesTheCaller:
    @pytest.mark.asyncio
    async def test_the_routes_answer_422_with_the_envelope(self):
        @handle_workflow_exceptions()
        async def route():
            _reject_unreadable_agent_instructions(_data("You are a QA bot."))

        with pytest.raises(HTTPException) as caught:
            await route()

        assert caught.value.status_code == 422
        assert caught.value.detail["code"] == "invalid_agent_instructions"

    @pytest.mark.asyncio
    async def test_the_builder_tool_gets_an_error_result_it_can_act_on(self):
        # The agent's commit_revision tool: the refusal must come back as the canonical
        # envelope in the tool result, not as an exception the runner turns into a 500.
        service, dao = _service()
        variant_id = uuid4()
        head = WorkflowRevision(
            id=uuid4(),
            slug="head",
            workflow_id=uuid4(),
            workflow_variant_id=variant_id,
            data={
                "uri": "agenta:builtin:agent:v0",
                "parameters": {"agent": {"instructions": {"agents_md": "old"}}},
            },
        )
        service.fetch_workflow_revision = AsyncMock(return_value=head)

        result = await handle_commit_revision(
            arguments={
                "workflow_revision": {
                    "workflow_variant_id": str(variant_id),
                    "delta": {
                        "set": {
                            "parameters": {
                                "agent": {"instructions": "You are a QA bot."}
                            }
                        }
                    },
                }
            },
            project_id=uuid4(),
            user_id=uuid4(),
            workflows_service=service,
            headers={"x-agenta-workflow-variant-id": str(variant_id)},
        )

        assert result.ok is False
        assert result.content.code == "invalid_agent_instructions"
        assert "instructions.agents_md" in result.content.message
        dao.commit_revision.assert_not_awaited()


class TestSimpleCreateLeavesNothingBehind:
    """Simple create writes the artifact, variant, and a blank revision before the revision
    that carries the data. The refusal must come before the first of those writes."""

    @pytest.mark.asyncio
    async def test_simple_workflow_create_refuses_before_any_write(self):
        workflows_service = AsyncMock()
        service = SimpleWorkflowsService(workflows_service=workflows_service)

        with pytest.raises(InvalidAgentInstructionsError):
            await service.create(
                project_id=uuid4(),
                user_id=uuid4(),
                simple_workflow_create=SimpleWorkflowCreate(
                    slug="instr-check",
                    data={
                        "uri": "agenta:builtin:agent:v0",
                        **_data("You are a QA bot."),
                    },
                ),
            )

        workflows_service.create_workflow.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_simple_application_create_refuses_before_any_write(self):
        applications_service = AsyncMock()
        service = SimpleApplicationsService(applications_service=applications_service)

        with pytest.raises(InvalidAgentInstructionsError):
            await service.create(
                project_id=uuid4(),
                user_id=uuid4(),
                simple_application_create=SimpleApplicationCreate(
                    slug="instr-check",
                    data={
                        "uri": "agenta:builtin:agent:v0",
                        **_data("You are a QA bot."),
                    },
                ),
            )

        applications_service.create_application.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_idempotent_create_refuses_before_any_write(self):
        workflows_service = AsyncMock()
        service = SimpleWorkflowsService(workflows_service=workflows_service)

        with pytest.raises(InvalidAgentInstructionsError):
            await service.create_idempotent(
                project_id=uuid4(),
                user_id=uuid4(),
                namespace="ns",
                request_key="key",
                request_fingerprint="fp",
                component="agent",
                simple_workflow_create=SimpleWorkflowCreate(
                    slug="instr-check",
                    data={
                        "uri": "agenta:builtin:agent:v0",
                        **_data("You are a QA bot."),
                    },
                ),
            )

        workflows_service.create_workflow.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_simple_workflow_edit_refuses_before_any_write(self):
        workflows_service = AsyncMock()
        service = SimpleWorkflowsService(workflows_service=workflows_service)

        with pytest.raises(InvalidAgentInstructionsError):
            await service.edit(
                project_id=uuid4(),
                user_id=uuid4(),
                simple_workflow_edit=SimpleWorkflowEdit(
                    id=uuid4(),
                    data={"uri": "agenta:builtin:agent:v0", **_data(42)},
                ),
            )

        workflows_service.fetch_workflow.assert_not_awaited()
        workflows_service.edit_workflow.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_simple_application_edit_refuses_before_any_write(self):
        applications_service = AsyncMock()
        service = SimpleApplicationsService(applications_service=applications_service)

        with pytest.raises(InvalidAgentInstructionsError):
            await service.edit(
                project_id=uuid4(),
                user_id=uuid4(),
                simple_application_edit=SimpleApplicationEdit(
                    id=uuid4(),
                    data={"uri": "agenta:builtin:agent:v0", **_data(["x"])},
                ),
            )

        applications_service.fetch_application.assert_not_awaited()
        applications_service.edit_application.assert_not_awaited()
