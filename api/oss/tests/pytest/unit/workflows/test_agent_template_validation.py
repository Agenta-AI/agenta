"""Strict server-side validation of a committed ``parameters.agent`` value.

Covers the validator directly (schema, embeds tolerance, malformed skill, claude/provider rule)
and its two hook points via faked DAOs: the workflows commit path and the env kill switch. See
``oss.src.core.workflows.agent_validation``.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.workflows.agent_validation import (
    validate_agent_template,
    is_agent_template_data,
)
from oss.src.core.workflows.dtos import (
    Workflow,
    WorkflowArtifactFlags,
    WorkflowRevision,
    WorkflowRevisionCommit,
    WorkflowRevisionData,
    WorkflowRevisionFlags,
)
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.types import AgentTemplateInvalid
from oss.src.utils.env import env


AGENT_URI = "agenta:builtin:agent:v0"


def _valid_agent() -> dict:
    return {
        "instructions": {"agents_md": "Be helpful."},
        "llm": {"provider": "openai", "model": "gpt-5.5"},
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": "pi_core"},
        "runner": {"kind": "sidecar", "permissions": {"default": "allow_reads"}},
        "sandbox": {"kind": "local"},
    }


def _agent_data(agent: dict) -> WorkflowRevisionData:
    return WorkflowRevisionData(uri=AGENT_URI, parameters={"agent": agent})


# validator -------------------------------------------------------------------


def test_valid_agent_template_passes():
    validate_agent_template(_agent_data(_valid_agent()))


def test_embeds_in_tools_and_skills_are_tolerated():
    agent = _valid_agent()
    agent["skills"] = [
        {
            "@ag.embed": {
                "@ag.references": {"workflow": {"slug": "__ag__build_an_agent"}},
                "@ag.selector": {"path": "parameters.skill"},
            },
            "name": "Build an agent",
        }
    ]
    agent["tools"] = [
        {"type": "builtin", "name": "read"},
        {"type": "platform", "op": "test_run"},
        {
            "@ag.embed": {
                "@ag.references": {"workflow": {"slug": "__ag__some_tool"}},
                "@ag.selector": {"path": "parameters.tool"},
            }
        },
    ]
    validate_agent_template(_agent_data(agent))


def test_malformed_skill_entry_raises_with_field_paths():
    agent = _valid_agent()
    # A skill written with a workflow-ish shape (top-level slug/content) instead of the
    # skill-template shape (name/description/body).
    agent["skills"] = [{"slug": "my-skill", "content": "do things"}]

    with pytest.raises(AgentTemplateInvalid) as exc_info:
        validate_agent_template(_agent_data(agent))

    locs = {error["loc"] for error in exc_info.value.errors}
    assert any(loc.startswith("parameters.agent.skills.0") for loc in locs)
    # The unknown keys are named; missing-field errors are draft-tolerated and not raised.
    assert "parameters.agent.skills.0.slug" in locs
    assert "parameters.agent.skills.0.content" in locs


def test_blank_skill_draft_is_tolerated():
    # The playground commits a freshly-added skill (blank name/description/body) verbatim and
    # only drops it at run time; commit must stay possible.
    agent = _valid_agent()
    agent["skills"] = [{"name": "", "description": "", "body": ""}]
    validate_agent_template(_agent_data(agent))


def test_half_filled_skill_draft_is_tolerated():
    agent = _valid_agent()
    agent["skills"] = [{"name": "my-skill", "description": "", "body": ""}]
    validate_agent_template(_agent_data(agent))


def test_openai_function_tool_shape_is_tolerated():
    # The shared tool form commits tools in the OpenAI shape; the run path rewrites them to
    # typed client configs, but the committed revision carries them verbatim.
    agent = _valid_agent()
    agent["tools"] = [
        {
            "type": "function",
            "function": {"name": "lookup", "description": "d", "parameters": {}},
        },
        {"type": "web_search"},
        {"name": "flat-legacy-tool", "parameters": {}},
    ]
    validate_agent_template(_agent_data(agent))


def test_typed_tool_with_bad_shape_raises():
    agent = _valid_agent()
    agent["tools"] = [{"type": "builtin"}]

    with pytest.raises(AgentTemplateInvalid) as exc_info:
        validate_agent_template(_agent_data(agent))

    joined = " ".join(error["loc"] for error in exc_info.value.errors)
    assert "parameters.agent.tools.0" in joined


def test_unrecognized_tool_shape_raises():
    agent = _valid_agent()
    agent["tools"] = [{"foo": "bar"}]

    with pytest.raises(AgentTemplateInvalid) as exc_info:
        validate_agent_template(_agent_data(agent))

    locs = {error["loc"] for error in exc_info.value.errors}
    assert "parameters.agent.tools.0" in locs


def test_blank_mcp_draft_is_tolerated_and_wrong_mcp_shape_raises():
    agent = _valid_agent()
    agent["mcps"] = [{"name": "", "transport": "stdio"}]
    validate_agent_template(_agent_data(agent))

    agent["mcps"] = [{"name": "srv", "transport": "carrier-pigeon"}]
    with pytest.raises(AgentTemplateInvalid) as exc_info:
        validate_agent_template(_agent_data(agent))
    joined = " ".join(error["loc"] for error in exc_info.value.errors)
    assert "parameters.agent.mcps.0" in joined


def test_claude_harness_non_anthropic_provider_raises():
    agent = _valid_agent()
    agent["harness"] = {"kind": "claude"}
    agent["llm"] = {"provider": "openai", "model": "gpt-4o"}

    with pytest.raises(AgentTemplateInvalid) as exc_info:
        validate_agent_template(_agent_data(agent))

    locs = {error["loc"] for error in exc_info.value.errors}
    assert "parameters.agent.llm.provider" in locs


def test_claude_harness_anthropic_provider_passes():
    agent = _valid_agent()
    agent["harness"] = {"kind": "claude"}
    agent["llm"] = {"provider": "anthropic", "model": "sonnet"}

    validate_agent_template(_agent_data(agent))


def test_claude_harness_provider_inferred_from_model_prefix_raises():
    agent = _valid_agent()
    agent["harness"] = {"kind": "claude"}
    agent["llm"] = {"model": "openai/gpt-4o"}

    with pytest.raises(AgentTemplateInvalid):
        validate_agent_template(_agent_data(agent))


def test_unknown_top_level_agent_key_raises():
    agent = _valid_agent()
    agent["surprise"] = True

    with pytest.raises(AgentTemplateInvalid) as exc_info:
        validate_agent_template(_agent_data(agent))

    joined = " ".join(error["loc"] for error in exc_info.value.errors)
    assert "surprise" in joined


def test_default_template_with_overlay_shape_is_committable():
    # The shipped default (build_agent_v0_default) merged with the playground overlay's tool /
    # skill / sandbox additions must always pass — this is the shape the playground commits.
    from agenta.sdk.utils.types import build_agent_v0_default

    agent = build_agent_v0_default(
        skill_slug="__ag__build_an_agent",
        include_sandbox_permission=True,
    )
    agent["tools"] = [
        {"type": "builtin", "name": "read"},
        {"type": "platform", "op": "test_run"},
        {
            "@ag.embed": {
                "@ag.references": {"workflow": {"slug": "__ag__telegram"}},
                "@ag.selector": {"path": "parameters.tool"},
            },
            "name": "Telegram",
        },
    ]
    agent["sandbox"]["permissions"] = {
        **agent["sandbox"].get("permissions", {}),
        "write_files": "allow",
        "execute_code": "allow",
    }
    validate_agent_template(_agent_data(agent))


def test_non_agent_data_is_noop():
    # A normal (non-agent) revision has no parameters.agent — nothing to validate.
    assert (
        is_agent_template_data(WorkflowRevisionData(uri="agenta:builtin:chat:v0"))
        is False
    )
    validate_agent_template(WorkflowRevisionData(uri="agenta:builtin:chat:v0"))
    validate_agent_template(WorkflowRevisionData(parameters={"prompt": {}}))


# router translation ----------------------------------------------------------


@pytest.mark.asyncio
async def test_handle_workflow_exceptions_translates_to_structured_400():
    from fastapi import HTTPException

    from oss.src.apis.fastapi.workflows.exceptions import handle_workflow_exceptions

    @handle_workflow_exceptions()
    async def _boom():
        raise AgentTemplateInvalid(
            errors=[
                {
                    "loc": "parameters.agent.skills.0.slug",
                    "msg": "Extra inputs are not permitted",
                    "type": "extra_forbidden",
                }
            ]
        )

    with pytest.raises(HTTPException) as exc_info:
        await _boom()

    assert exc_info.value.status_code == 400
    detail = exc_info.value.detail
    assert detail["errors"][0]["loc"] == "parameters.agent.skills.0.slug"
    assert detail["message"]


# service commit hook ---------------------------------------------------------


def _commit(service: WorkflowsService, *, agent: dict, artifact_id, variant_id):
    return service.commit_workflow_revision(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_revision_commit=WorkflowRevisionCommit(
            workflow_id=artifact_id,
            workflow_variant_id=variant_id,
            slug="rev",
            data=_agent_data(agent),
        ),
    )


def _seed_dao() -> tuple[AsyncMock, object, object]:
    workflows_dao = AsyncMock()
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    workflows_dao.commit_revision.return_value = WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="rev",
        flags=WorkflowRevisionFlags(is_agent=True),
        data=_agent_data(_valid_agent()),
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )
    return workflows_dao, artifact_id, variant_id


@pytest.mark.asyncio
async def test_commit_valid_agent_template_persists():
    workflows_dao, artifact_id, variant_id = _seed_dao()
    service = WorkflowsService(workflows_dao=workflows_dao)

    revision = await _commit(
        service, agent=_valid_agent(), artifact_id=artifact_id, variant_id=variant_id
    )

    assert revision is not None
    workflows_dao.commit_revision.assert_awaited_once()


@pytest.mark.asyncio
async def test_commit_malformed_agent_template_rejected_before_persist():
    workflows_dao, artifact_id, variant_id = _seed_dao()
    service = WorkflowsService(workflows_dao=workflows_dao)

    agent = _valid_agent()
    agent["skills"] = [{"slug": "my-skill", "content": "do things"}]

    with pytest.raises(AgentTemplateInvalid):
        await _commit(
            service, agent=agent, artifact_id=artifact_id, variant_id=variant_id
        )

    workflows_dao.commit_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_commit_claude_non_anthropic_rejected_before_persist():
    workflows_dao, artifact_id, variant_id = _seed_dao()
    service = WorkflowsService(workflows_dao=workflows_dao)

    agent = _valid_agent()
    agent["harness"] = {"kind": "claude"}
    agent["llm"] = {"provider": "openai", "model": "gpt-4o"}

    with pytest.raises(AgentTemplateInvalid):
        await _commit(
            service, agent=agent, artifact_id=artifact_id, variant_id=variant_id
        )

    workflows_dao.commit_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_kill_switch_bypasses_validation(monkeypatch):
    workflows_dao, artifact_id, variant_id = _seed_dao()
    service = WorkflowsService(workflows_dao=workflows_dao)

    monkeypatch.setattr(env.agenta.agent_template, "commit_validation", False)

    agent = _valid_agent()
    agent["skills"] = [{"slug": "my-skill", "content": "do things"}]

    revision = await _commit(
        service, agent=agent, artifact_id=artifact_id, variant_id=variant_id
    )

    assert revision is not None
    workflows_dao.commit_revision.assert_awaited_once()


@pytest.mark.asyncio
async def test_non_agent_workflow_commit_unaffected():
    workflows_dao = AsyncMock()
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    workflows_dao.commit_revision.return_value = WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="rev",
        flags=WorkflowRevisionFlags(is_chat=True, has_url=True),
        data=WorkflowRevisionData(uri="agenta:builtin:chat:v0"),
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )
    service = WorkflowsService(workflows_dao=workflows_dao)

    revision = await service.commit_workflow_revision(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_revision_commit=WorkflowRevisionCommit(
            workflow_id=artifact_id,
            workflow_variant_id=variant_id,
            slug="rev",
            data=WorkflowRevisionData(uri="agenta:builtin:chat:v0"),
        ),
    )

    assert revision is not None
    workflows_dao.commit_revision.assert_awaited_once()
