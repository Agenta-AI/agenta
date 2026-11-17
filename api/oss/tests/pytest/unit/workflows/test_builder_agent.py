"""The builder agent's static catalogue entry (`__ag__builder`).

Pins that the entry resolves in any project without a database read, that its tool approvals
are the platform defaults, that it lists exactly its own learning drive and no home drive, that
the runtime parses it, and that its text carries no secret or host.
"""

import json
import re
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from agenta.sdk.agents.adapters.agenta_builtins import AGENT_CONFIG_FIELDS_REFERENCE
from agenta.sdk.agents.dtos import AgentTemplate
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS

from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.builder_agent import (
    BUILDER_AGENT_SLUG,
    BUILDER_LEARNING_DRIVE_SLUG,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog


def _agent() -> dict:
    revision = StaticWorkflowCatalog().retrieve_revision(slug=BUILDER_AGENT_SLUG)
    return revision.data.parameters["agent"]


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
    tools = {tool["op"]: tool for tool in _agent()["tools"]}

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


def test_runtime_parses_the_entry():
    template = AgentTemplate.from_params(
        StaticWorkflowCatalog()
        .retrieve_revision(slug=BUILDER_AGENT_SLUG)
        .data.parameters
    )

    assert template.instructions
    assert [skill.name for skill in template.skills] == [
        "manage-project-agents",
        "builder-learning",
    ]
    assert {tool.op for tool in template.tools} == {
        tool["op"] for tool in _agent()["tools"]
    }


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
