"""A revision of an agent must parse the way the runtime parses it before every run.

A skill saved without `body` answered 200, and every later run of the agent failed with a
500: `Invalid skill configuration ... 'body' Field required`. The revision build now runs the
runtime's own `AgentTemplate.from_params` on every agent revision, whoever writes it, and
refuses with the field to correct. The agent tools are covered in
test_agent_config_handlers.py.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from starlette.responses import JSONResponse

from oss.src.apis.fastapi.workflows.exceptions import handle_workflow_exceptions
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
    _reject_unrunnable_agent,
)
from oss.src.core.workflows.types import InvalidAgentConfigurationError

AGENT_URI = "agenta:builtin:agent:v0"
SKILL = {"name": "invoice-lookup", "description": "Find invoices.", "body": "Look."}
NO_BODY = {"name": "invoice-lookup", "description": "Find invoices."}
SKILL_EMBED = {
    "@ag.embed": {"@ag.references": {"workflow": {"slug": "invoice-lookup"}}}
}
NO_BODY_ISSUE = "parameters.agent.skills[0].body is required"


def _agent(**agent):
    return {
        "uri": AGENT_URI,
        "parameters": {"agent": {"instructions": {"agents_md": "Help."}, **agent}},
    }


def _issues(data):
    with pytest.raises(InvalidAgentConfigurationError) as caught:
        _reject_unrunnable_agent(data)
    return caught.value.issues


class TestTheRuleNamesTheField:
    def test_a_skill_without_body(self):
        assert _issues(_agent(skills=[NO_BODY])) == [NO_BODY_ISSUE]

    def test_every_problem_in_the_entry_is_named(self):
        assert _issues(_agent(skills=[SKILL, {"name": "x"}])) == [
            "parameters.agent.skills[1].description is required",
            "parameters.agent.skills[1].body is required",
        ]

    def test_a_tool_is_named_without_its_union_tag(self):
        assert _issues(_agent(tools=[{"type": "builtin"}])) == [
            "parameters.agent.tools[0].name is required"
        ]

    def test_an_mcp_server(self):
        assert _issues(_agent(mcps=[{"name": "files"}])) == [
            "parameters.agent.mcps[0].connection is required"
        ]

    def test_an_entry_refused_for_its_shape_carries_the_parsers_reason(self):
        assert _issues(_agent(tools=[42])) == [
            "parameters.agent.tools[0] is invalid: Tool configuration must be a "
            "string or mapping"
        ]

    def test_a_problem_outside_the_lists_carries_the_parsers_reason(self):
        (issue,) = _issues(_agent(model="gpt-5.5"))
        assert "pre-migration flat key 'model'" in issue

    def test_the_envelope(self):
        with pytest.raises(InvalidAgentConfigurationError) as caught:
            _reject_unrunnable_agent(_agent(skills=[NO_BODY]))

        detail = caught.value.to_detail()
        assert detail["code"] == "invalid_agent_configuration"
        assert detail["retryable"] is False
        assert detail["next_step"]
        assert detail["details"] == {"issues": [NO_BODY_ISSUE]}
        assert NO_BODY_ISSUE in detail["message"]
        JSONResponse(detail)


class TestWhatTheRuleLeavesAlone:
    def test_an_embedded_entry_resolves_before_a_run_and_keeps_its_position(self):
        # The embed is skipped, and the entry after it is still named by its own index.
        assert _issues(_agent(skills=[SKILL_EMBED, NO_BODY])) == [
            "parameters.agent.skills[1].body is required"
        ]

    def test_a_skill_whose_body_is_a_snippet_passes(self):
        _reject_unrunnable_agent(
            _agent(skills=[{**SKILL, "body": "@{{environment.slug=prod, key=x}}"}])
        )

    def test_an_embedded_field_outside_the_lists_passes(self):
        _reject_unrunnable_agent(_agent(sandbox=SKILL_EMBED))

    @pytest.mark.parametrize(
        "data",
        [
            None,
            {},
            {"uri": AGENT_URI},
            {"uri": AGENT_URI, "parameters": {}},
            _agent(),
            _agent(skills=[SKILL], tools=[{"type": "builtin", "name": "read"}]),
            # Not an agent: the runtime never parses `parameters.agent` on it.
            {
                "uri": "agenta:builtin:chat:v0",
                "parameters": {"agent": {"skills": [NO_BODY]}},
            },
        ],
    )
    def test_a_runnable_or_non_agent_configuration_passes(self, data):
        _reject_unrunnable_agent(data)


def _service(head=None):
    dao = AsyncMock()
    dao.fetch_revision.return_value = None
    dao.fetch_variant.return_value = None
    service = WorkflowsService(workflows_dao=dao)
    if head is not None:
        service.fetch_workflow_revision = AsyncMock(return_value=head)
    return service, dao


def _commit(data, **fields):
    return WorkflowRevisionCommit(
        slug="agent-check", workflow_variant_id=uuid4(), data=data, **fields
    )


class TestEveryCommitPathRefusesBeforeTheWrite:
    @pytest.mark.asyncio
    async def test_a_full_data_commit_from_the_playground_or_the_sdk(self):
        # Both save through the commit endpoint, which routes through the checked commit.
        service, dao = _service()

        with pytest.raises(InvalidAgentConfigurationError):
            await service.commit_workflow_revision_checked(
                project_id=uuid4(),
                user_id=uuid4(),
                workflow_revision_commit=_commit(_agent(skills=[NO_BODY])),
            )

        dao.commit_revision.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_delta_commit_is_checked_on_its_result(self):
        head = WorkflowRevision(
            id=uuid4(), slug="head", workflow_id=uuid4(), data=_agent(skills=[])
        )
        service, dao = _service(head)

        with pytest.raises(InvalidAgentConfigurationError) as caught:
            await service.commit_workflow_revision_checked(
                project_id=uuid4(),
                user_id=uuid4(),
                workflow_revision_commit=_commit(
                    None,
                    base_revision_id=head.id,
                    delta={
                        "operations": [
                            {
                                "operation": "add_item",
                                "target": ["parameters", "agent", "skills"],
                                "value": NO_BODY,
                            }
                        ]
                    },
                ),
            )

        assert caught.value.issues == [NO_BODY_ISSUE]
        dao.commit_revision.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_the_plain_commit(self):
        # The revision create route, the application revision routes and the final commit
        # of a simple create reach the store through this method.
        service, dao = _service()

        with pytest.raises(InvalidAgentConfigurationError):
            await service.commit_workflow_revision(
                project_id=uuid4(),
                user_id=uuid4(),
                workflow_revision_commit=_commit(_agent(skills=[NO_BODY])),
            )

        dao.commit_revision.assert_not_awaited()


class TestAnAgentStoredBrokenMustBeCorrectedFirst:
    """The rule reads the result. An agent stored before it existed refuses any change that
    leaves the field as it is, and names the field, so the caller can correct it."""

    HEAD = WorkflowRevision(
        id=uuid4(), slug="head", workflow_id=uuid4(), data=_agent(skills=[NO_BODY])
    )

    def _set(self, target, value):
        return _commit(
            None,
            base_revision_id=self.HEAD.id,
            delta={
                "operations": [{"operation": "set", "target": target, "value": value}]
            },
        )

    @pytest.mark.asyncio
    async def test_an_unrelated_change_is_refused_and_names_the_stored_field(self):
        service, dao = _service(self.HEAD)

        with pytest.raises(InvalidAgentConfigurationError) as caught:
            await service.commit_workflow_revision_checked(
                project_id=uuid4(),
                user_id=uuid4(),
                workflow_revision_commit=self._set(
                    ["parameters", "agent", "instructions", "agents_md"], "Be brief."
                ),
            )

        assert caught.value.issues == [NO_BODY_ISSUE]
        dao.commit_revision.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_a_change_that_corrects_the_field_is_accepted(self):
        service, _ = _service(self.HEAD)
        service.commit_workflow_revision = AsyncMock(return_value=None)

        await service.commit_workflow_revision_checked(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=self._set(
                [
                    "parameters",
                    "agent",
                    {"list": "skills", "key": "invoice-lookup"},
                    "body",
                ],
                "Look.",
            ),
        )

        service.commit_workflow_revision.assert_awaited_once()


class TestSimpleCreateAndEditLeaveNothingBehind:
    """Simple create writes the artifact, the variant and a blank revision before the
    revision that carries the data. The refusal must come before the first of those."""

    @pytest.mark.asyncio
    async def test_simple_workflow_create(self):
        workflows_service = AsyncMock()

        with pytest.raises(InvalidAgentConfigurationError):
            await SimpleWorkflowsService(workflows_service=workflows_service).create(
                project_id=uuid4(),
                user_id=uuid4(),
                simple_workflow_create=SimpleWorkflowCreate(
                    slug="agent-check", data=_agent(skills=[NO_BODY])
                ),
            )

        workflows_service.create_workflow.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_idempotent_create(self):
        # The agent template loader and create_agent create through this method.
        workflows_service = AsyncMock()

        with pytest.raises(InvalidAgentConfigurationError):
            await SimpleWorkflowsService(
                workflows_service=workflows_service
            ).create_idempotent(
                project_id=uuid4(),
                user_id=uuid4(),
                namespace="ns",
                request_key="key",
                request_fingerprint="fp",
                component="agent",
                simple_workflow_create=SimpleWorkflowCreate(
                    slug="agent-check", data=_agent(skills=[NO_BODY])
                ),
            )

        workflows_service.create_workflow.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_simple_workflow_edit(self):
        workflows_service = AsyncMock()

        with pytest.raises(InvalidAgentConfigurationError):
            await SimpleWorkflowsService(workflows_service=workflows_service).edit(
                project_id=uuid4(),
                user_id=uuid4(),
                simple_workflow_edit=SimpleWorkflowEdit(
                    id=uuid4(), data=_agent(skills=[NO_BODY])
                ),
            )

        workflows_service.fetch_workflow.assert_not_awaited()
        workflows_service.edit_workflow.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_simple_application_create(self):
        applications_service = AsyncMock()

        with pytest.raises(InvalidAgentConfigurationError):
            await SimpleApplicationsService(
                applications_service=applications_service
            ).create(
                project_id=uuid4(),
                user_id=uuid4(),
                simple_application_create=SimpleApplicationCreate(
                    slug="agent-check", data=_agent(skills=[NO_BODY])
                ),
            )

        applications_service.create_application.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_simple_application_edit(self):
        applications_service = AsyncMock()

        with pytest.raises(InvalidAgentConfigurationError):
            await SimpleApplicationsService(
                applications_service=applications_service
            ).edit(
                project_id=uuid4(),
                user_id=uuid4(),
                simple_application_edit=SimpleApplicationEdit(
                    id=uuid4(), data=_agent(skills=[NO_BODY])
                ),
            )

        applications_service.fetch_application.assert_not_awaited()
        applications_service.edit_application.assert_not_awaited()


class TestTheRoutesAnswer422:
    @pytest.mark.asyncio
    async def test_with_the_envelope(self):
        @handle_workflow_exceptions()
        async def route():
            _reject_unrunnable_agent(_agent(skills=[NO_BODY]))

        with pytest.raises(HTTPException) as caught:
            await route()

        assert caught.value.status_code == 422
        assert caught.value.detail["code"] == "invalid_agent_configuration"
        assert caught.value.detail["details"]["issues"] == [NO_BODY_ISSUE]

    @pytest.mark.asyncio
    async def test_a_harness_refusal_from_a_simple_route_is_422_too(self):
        # The harness rule used to run on the checked commit only, so only the commit
        # route mapped it. It now runs on every writer.
        @handle_workflow_exceptions()
        async def route():
            _reject_unrunnable_agent(_agent(harness={"kind": "not_a_real_harness"}))

        with pytest.raises(HTTPException) as caught:
            await route()

        assert caught.value.status_code == 422
        assert caught.value.detail["code"] == "invalid_harness_kind"
