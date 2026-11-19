"""The builder agent's static catalogue entry (`__ag__builder`).

Pins that the entry resolves in any project without a database read, that its tool approvals
are the platform defaults, that it holds the client tools that ask the person for input or a
connection, that it lists exactly its own learning drive and no home drive, that
the runtime parses it, and that its text carries no secret or host.
"""

import json
import re
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from agenta.sdk.agents.adapters.agenta_builtins import AGENT_CONFIG_FIELDS_REFERENCE
from agenta.sdk.agents.dtos import AgentTemplate
from agenta.sdk.agents.platform import AgentaPlatformToolResolver, PlatformConnection
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS
from agenta.sdk.agents.platform.workflow import REQUEST_CONNECTION_WORKFLOW_SLUG
from agenta.sdk.agents.tools import ToolResolver
from agenta.sdk.agents.tools.models import ClientToolConfig

from oss.src.core.embeds.service import EmbedsService
from oss.src.core.sharing.dtos import AgentReadScope
from oss.src.core.shared.dtos import Reference
from oss.src.core.tools import platform_handlers
from oss.src.core.workflows.build_kit import REQUEST_INPUT_WORKFLOW_SLUG
from oss.src.core.workflows.builder_agent import (
    BUILDER_AGENT_SLUG,
    BUILDER_AGENT_TOOLS,
    BUILDER_LEARNING_DRIVE_SLUG,
)
from oss.src.core.workflows.dtos import WorkflowServiceRequest
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog


_CLIENT_TOOLS = ["request_connection", "request_input"]


def _agent() -> dict:
    revision = StaticWorkflowCatalog().retrieve_revision(slug=BUILDER_AGENT_SLUG)
    return revision.data.parameters["agent"]


async def _resolved_template() -> AgentTemplate:
    """The entry as a run sees it: embeds resolved from the static catalogue, no database."""
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao, static_catalog=StaticWorkflowCatalog()
    )
    service.embeds_service = EmbedsService(workflows_service=service)

    resolved, _ = await service.resolve_workflow_revision(
        project_id=uuid4(),
        workflow_ref=Reference(slug=BUILDER_AGENT_SLUG),
    )

    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()
    return AgentTemplate.from_params(resolved.data.parameters)


def test_entry_is_a_static_agent():
    catalog = StaticWorkflowCatalog()
    revision = catalog.retrieve_revision(slug=BUILDER_AGENT_SLUG)

    assert revision is not None
    assert revision.slug == BUILDER_AGENT_SLUG
    assert revision.version == "v1"
    assert revision.flags.is_static is True
    assert revision.flags.is_agent is True
    assert catalog.is_embeddable(slug=BUILDER_AGENT_SLUG) is False


def test_entry_resolves_by_each_of_its_ids():
    catalog = StaticWorkflowCatalog()
    revision = catalog.retrieve_revision(slug=BUILDER_AGENT_SLUG)

    for entity_id in (
        revision.id,
        revision.workflow_id,
        revision.workflow_variant_id,
    ):
        assert catalog.retrieve_revision(id=entity_id).id == revision.id


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ref",
    ["slug", "id"],
)
async def test_entry_resolves_in_any_project_without_a_database_read(ref):
    revision = StaticWorkflowCatalog().retrieve_revision(slug=BUILDER_AGENT_SLUG)
    reference = (
        Reference(slug=BUILDER_AGENT_SLUG)
        if ref == "slug"
        else Reference(id=revision.workflow_id)
    )
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
    )

    for project_id in (uuid4(), uuid4()):
        resolved = await service.fetch_workflow_revision(
            project_id=project_id,
            workflow_ref=reference,
        )
        assert resolved is not None
        assert resolved.id == revision.id

    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()


def test_tool_approvals():
    tools = {tool["op"]: tool for tool in _agent()["tools"] if "op" in tool}

    assert tools["create_agent"]["permission"] == "ask"
    assert tools["edit_agent_config"]["permission"] == "ask"
    assert tools["list_agents"]["permission"] == "allow"
    assert tools["read_agent_config"]["permission"] == "allow"

    for op, tool in tools.items():
        assert tool["type"] == "platform"
        assert op in PLATFORM_OPS
        # Every other tool only reads, apart from naming this conversation.
        if op not in ("create_agent", "edit_agent_config", "rename_session"):
            assert PLATFORM_OPS[op].read_only, op


def test_entry_lists_its_own_learning_drive_and_no_home_drive():
    agent = _agent()

    assert BUILDER_LEARNING_DRIVE_SLUG == "__ag__builder__learning"
    assert agent["drives"] == [{"slug": BUILDER_LEARNING_DRIVE_SLUG}]
    assert "home_drive" in agent
    assert agent["home_drive"] is None


def test_learning_skill_names_the_drive_path():
    skills = {skill["name"]: skill for skill in _agent()["skills"]}

    assert set(skills) == {"manage-project-agents", "builder-learning"}
    assert (
        f"drives/{BUILDER_LEARNING_DRIVE_SLUG}/" in skills["builder-learning"]["body"]
    )


def test_instructions_ask_who_a_new_agent_is_for():
    instructions = _agent()["instructions"]["agents_md"]

    assert "visibility: private" in instructions
    assert "visibility: project" in instructions


def test_entry_embeds_the_two_client_tools():
    embeds = [tool["@ag.embed"] for tool in _agent()["tools"] if "@ag.embed" in tool]

    assert [embed["@ag.references"]["workflow"]["slug"] for embed in embeds] == [
        REQUEST_CONNECTION_WORKFLOW_SLUG,
        REQUEST_INPUT_WORKFLOW_SLUG,
    ]
    for embed in embeds:
        assert embed["@ag.selector"] == {"path": "parameters.tool"}


@pytest.mark.asyncio
async def test_runtime_parses_the_entry():
    template = await _resolved_template()

    assert template.instructions
    assert [skill.name for skill in template.skills] == [
        "manage-project-agents",
        "builder-learning",
    ]
    assert [
        tool.op for tool in template.tools if not isinstance(tool, ClientToolConfig)
    ] == list(BUILDER_AGENT_TOOLS)
    assert [
        tool.name for tool in template.tools if isinstance(tool, ClientToolConfig)
    ] == _CLIENT_TOOLS


_FORBIDDEN = [
    re.compile(r"https?://", re.IGNORECASE),
    re.compile(r"\b\d{1,3}(\.\d{1,3}){3}\b"),
    re.compile(r"\b[\w-]+\.(dev|com|ai|io|net|org)\b", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9]"),
    re.compile(r"\bApiKey\s", re.IGNORECASE),
    re.compile(r"\b[A-Z][A-Z0-9_]*_(API_KEY|TOKEN|SECRET)\b"),
    re.compile(r"\bscripts?/", re.IGNORECASE),
]


def test_text_has_no_secret_host_or_script():
    agent = _agent()
    text = json.dumps(
        {"instructions": agent["instructions"], "skills": agent["skills"]}
    )

    for pattern in _FORBIDDEN:
        assert not pattern.search(text), pattern.pattern


def test_manage_skill_bundles_the_config_field_reference():
    skills = {skill["name"]: skill for skill in _agent()["skills"]}
    files = {f["path"]: f["content"] for f in skills["manage-project-agents"]["files"]}

    assert files["references/config-fields.md"].endswith(AGENT_CONFIG_FIELDS_REFERENCE)
    assert files["references/playbooks.md"].startswith("# Playbooks")


def test_a_run_by_slug_carries_the_builder_artifact_id():
    """The agent tools bind the caller from the run's resolved workflow reference."""
    revision = StaticWorkflowCatalog().retrieve_revision(slug=BUILDER_AGENT_SLUG)

    assert revision.artifact_id == revision.workflow_id
    assert revision.variant_id == revision.workflow_variant_id
    assert revision.artifact_slug == BUILDER_AGENT_SLUG


@pytest.mark.asyncio
async def test_resolved_references_name_the_builder_by_id():
    service = WorkflowsService(
        workflows_dao=AsyncMock(), static_catalog=StaticWorkflowCatalog()
    )
    request = WorkflowServiceRequest(
        references={"workflow": {"slug": BUILDER_AGENT_SLUG}}
    )

    await service._ensure_request_revision(project_id=uuid4(), request=request)

    revision = StaticWorkflowCatalog().retrieve_revision(slug=BUILDER_AGENT_SLUG)
    assert request.references["workflow"].id == revision.workflow_id
    assert request.references["workflow_variant"].id == revision.workflow_variant_id


@pytest.mark.asyncio
async def test_writes_by_the_builder_are_attributed_to_it_by_name():
    revision = StaticWorkflowCatalog().retrieve_revision(slug=BUILDER_AGENT_SLUG)
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao, static_catalog=StaticWorkflowCatalog()
    )

    clause = await platform_handlers._attribution(
        workflows_service=service,
        project_id=uuid4(),
        read_scope=AgentReadScope(owner_user_id=None),
        caller_id=revision.workflow_id,
        session_id="s-1",
    )

    assert clause == f'by agent "Builder" {revision.workflow_id}, session s-1'
    workflows_dao.fetch_artifact.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("by", ["slug", "id"])
@pytest.mark.parametrize(
    "handler",
    [
        platform_handlers.handle_read_agent_config,
        platform_handlers.handle_edit_agent_config,
    ],
)
async def test_the_builder_cannot_read_or_edit_itself(handler, by):
    revision = StaticWorkflowCatalog().retrieve_revision(slug=BUILDER_AGENT_SLUG)
    workflows_dao = AsyncMock()
    service = WorkflowsService(
        workflows_dao=workflows_dao, static_catalog=StaticWorkflowCatalog()
    )

    result = await handler(
        arguments={
            "agent": BUILDER_AGENT_SLUG if by == "slug" else str(revision.workflow_id),
            "base_revision_id": str(revision.id),
            "operations": [
                {
                    "operation": "set",
                    "target": ["parameters", "agent", "instructions", "agents_md"],
                    "value": "x",
                }
            ],
            "caller_agent_id": str(revision.workflow_id),
            "caller_session_id": "s-1",
        },
        project_id=uuid4(),
        user_id=uuid4(),
        workflows_service=service,
    )

    assert not result.ok
    assert result.content.code == "agent_is_static"
    workflows_dao.commit_revision.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["allow", "allow_reads", "ask"])
async def test_the_four_agent_tools_resolve_for_a_run(mode):
    """The agent tools are not Agenta tools, so the builder holds them as platform
    entries; a run's resolver must still give it all four, with their approvals, and the
    two client tools beside them."""
    template = await _resolved_template()
    resolver = ToolResolver(
        platform_resolver=AgentaPlatformToolResolver(
            connection=PlatformConnection(
                base_url="https://api.example/api", authorization="Access tok"
            )
        )
    )

    resolved = await resolver.resolve(
        template.tools, permission_default=mode, session_id="s-1"
    )

    permissions = {spec.name: spec.permission for spec in resolved.tool_specs}
    assert permissions["create_agent"] == "ask"
    assert permissions["edit_agent_config"] == "ask"
    assert permissions["list_agents"] == "allow"
    assert permissions["read_agent_config"] == "allow"
    assert set(permissions) == set(BUILDER_AGENT_TOOLS) | set(_CLIENT_TOOLS)


def test_learning_skill_keeps_private_content_out_of_the_shared_drive():
    skills = {skill["name"]: skill for skill in _agent()["skills"]}
    body = skills["builder-learning"]["body"]

    assert "Content from a private agent or a private conversation" in body
    assert "agrees" in body
