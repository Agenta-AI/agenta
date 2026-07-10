from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from agenta.sdk.agents.adapters.agenta_builtins import (
    AGENTA_FORCED_TOOLS,
    BUILD_AN_AGENT_SLUG,
    GETTING_STARTED_WITH_AGENTA_SLUG,
)
from agenta.sdk.agents.platform.workflow import REQUEST_CONNECTION_WORKFLOW_SLUG
from agenta.sdk.agents.dtos import AgentTemplate
from agenta.sdk.agents.platform import AgentaPlatformToolResolver, PlatformConnection
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS
from agenta.sdk.agents.tools.models import ClientToolConfig, PlatformToolConfig

from oss.src.apis.fastapi.applications import router as applications_router_module
from oss.src.apis.fastapi.applications.overlay import (
    DEFAULT_BUILD_KIT_OPS,
    build_agent_template_overlay,
)
from oss.src.core.workflows.build_kit import (
    BUILD_KIT_WORKFLOW_SLUG,
    REQUEST_INPUT_WORKFLOW_SLUG,
    build_agent_template_overlay as build_core_agent_template_overlay,
)
from oss.src.apis.fastapi.applications.router import SimpleApplicationsRouter
from oss.src.core.applications.dtos import SimpleApplication
from oss.src.core.embeds.service import EmbedsService
from oss.src.core.workflows.dtos import WorkflowRevision, WorkflowRevisionData
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog

EXPECTED_DEFAULT_BUILD_KIT_OPS = (
    "discover_tools",
    "commit_revision",
    "annotate_trace",
    "query_spans",
    "test_run",
    "discover_triggers",
    "create_schedule",
    "create_subscription",
    "list_schedules",
    "list_deliveries",
    "test_subscription",
    "remove_schedule",
    "remove_subscription",
)

CUT_BUILD_KIT_OPS = (
    "pause_schedule",
    "resume_schedule",
    "pause_subscription",
    "resume_subscription",
    "query_workflows",
    "list_connections",
    "list_subscriptions",
)


def _embed_slug(entry: dict) -> str | None:
    refs = entry.get("@ag.embed", {}).get("@ag.references", {})
    workflow = refs.get("workflow") or refs.get("workflow_revision") or {}
    return workflow.get("slug")


def test_agent_template_overlay_tools_list_is_pinned_with_builtin_grants_first():
    """Pin the exact overlay tools list: builtin grants, then platform ops, then embeds.

    The leading builtin grants (``{"type": "builtin", "name": "read"/"bash"}`` from
    ``AGENTA_FORCED_TOOLS``) are load-bearing: any custom tool on the wire flips Pi's
    builtin gating from "Pi defaults" to granted-only, so without an explicit ``read``
    grant the playbook skill is announced but unloadable (live-QA finding 2026-07-05).
    ``bash`` keeps skill helper scripts runnable.
    """
    overlay = build_agent_template_overlay()

    catalog = StaticWorkflowCatalog()
    request_connection = catalog.retrieve_revision(
        slug=REQUEST_CONNECTION_WORKFLOW_SLUG
    )
    request_input = catalog.retrieve_revision(slug=REQUEST_INPUT_WORKFLOW_SLUG)

    assert AGENTA_FORCED_TOOLS == ["read", "bash"]
    assert overlay["tools"] == [
        {"type": "builtin", "name": "read"},
        {"type": "builtin", "name": "bash"},
        *[{"type": "platform", "op": op_name} for op_name in DEFAULT_BUILD_KIT_OPS],
        {
            "@ag.embed": {
                "@ag.references": {
                    "workflow": {"slug": REQUEST_CONNECTION_WORKFLOW_SLUG}
                },
                "@ag.selector": {"path": "parameters.tool"},
            },
            "name": request_connection.name,
        },
        {
            "@ag.embed": {
                "@ag.references": {"workflow": {"slug": REQUEST_INPUT_WORKFLOW_SLUG}},
                "@ag.selector": {"path": "parameters.tool"},
            },
            "name": request_input.name,
        },
    ]


def test_agent_template_overlay_contains_platform_ops_playbook_skill_and_permissions():
    overlay = build_agent_template_overlay()

    platform_tools = [
        tool
        for tool in overlay["tools"]
        if isinstance(tool, dict) and tool.get("type") == "platform"
    ]
    assert DEFAULT_BUILD_KIT_OPS == EXPECTED_DEFAULT_BUILD_KIT_OPS
    assert set(DEFAULT_BUILD_KIT_OPS) <= set(PLATFORM_OPS)
    assert set(DEFAULT_BUILD_KIT_OPS).isdisjoint(CUT_BUILD_KIT_OPS)
    assert platform_tools == [
        {"type": "platform", "op": op_name} for op_name in DEFAULT_BUILD_KIT_OPS
    ]

    authoring_skill = StaticWorkflowCatalog().retrieve_revision(
        slug=BUILD_AN_AGENT_SLUG
    )
    assert overlay["skills"] == [
        {
            "name": authoring_skill.name,
            "@ag.embed": {
                "@ag.references": {"workflow": {"slug": BUILD_AN_AGENT_SLUG}},
                "@ag.selector": {"path": "parameters.skill"},
            },
        }
    ]
    assert GETTING_STARTED_WITH_AGENTA_SLUG not in {
        _embed_slug(skill) for skill in overlay["skills"]
    }
    assert overlay["sandbox"] == {
        "permissions": {"write_files": "allow", "execute_code": "allow"}
    }


def test_api_overlay_adapter_matches_core_build_kit_builder():
    assert build_agent_template_overlay() == build_core_agent_template_overlay()


def test_agent_template_overlay_includes_only_allowlisted_static_tool_embeds():
    overlay = build_agent_template_overlay()
    tool_embeds = [
        tool
        for tool in overlay["tools"]
        if isinstance(tool, dict) and "@ag.embed" in tool
    ]
    tool_embed_slugs = {_embed_slug(tool) for tool in tool_embeds}
    # Each tool embed must carry the canonical ``parameters.tool`` selector so it resolves to the
    # flat inline tool config the SDK coercer accepts (regression: missing selector -> HTTP 500
    # "Unsupported tool configuration shape").
    assert all(
        tool["@ag.embed"].get("@ag.selector") == {"path": "parameters.tool"}
        for tool in tool_embeds
    )
    catalog = StaticWorkflowCatalog()

    # Each tool embed carries the workflow's display name so the playground renders that instead of
    # the raw ``__ag__*`` slug.
    for tool in tool_embeds:
        revision = catalog.retrieve_revision(slug=_embed_slug(tool))
        assert tool.get("name") == revision.name

    assert tool_embed_slugs == {
        REQUEST_CONNECTION_WORKFLOW_SLUG,
        REQUEST_INPUT_WORKFLOW_SLUG,
    }


def test_agent_template_overlay_does_not_embed_build_kit():
    overlay = build_agent_template_overlay()

    embedded_slugs = {
        _embed_slug(entry)
        for section in ("tools", "skills")
        for entry in overlay[section]
        if isinstance(entry, dict) and "@ag.embed" in entry
    }

    assert BUILD_KIT_WORKFLOW_SLUG not in embedded_slugs


@pytest.mark.asyncio
async def test_fetch_simple_application_includes_build_kit_context(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    application_id = uuid4()

    class DummySimpleApplicationsService:
        applications_service = object()

        async def fetch(self, **kwargs):
            assert kwargs["project_id"] == project_id
            assert kwargs["application_id"] == application_id
            return SimpleApplication(id=application_id, slug="agent")

    monkeypatch.setattr(
        applications_router_module,
        "check_action_access",
        AsyncMock(return_value=True),
        raising=False,
    )

    router = SimpleApplicationsRouter(
        simple_applications_service=DummySimpleApplicationsService()
    )
    request = SimpleNamespace(
        state=SimpleNamespace(project_id=str(project_id), user_id=str(user_id))
    )

    response = await router.fetch_simple_application(
        request,
        application_id=application_id,
    )

    overlay = (
        response.additional_context.playground_build_kit.agent_template_overlay
        if response.additional_context
        and response.additional_context.playground_build_kit
        else None
    )
    assert response.application is not None
    # The overlay is now a typed `AgentTemplateOverlay`; its JSON projection is the wire payload and
    # must match the platform-built overlay dict byte for byte.
    assert overlay is not None
    overlay_payload = overlay.model_dump(mode="json")
    response_platform_ops = [
        tool["op"]
        for tool in overlay_payload["tools"]
        if isinstance(tool, dict) and tool.get("type") == "platform"
    ]
    assert set(response_platform_ops) == set(DEFAULT_BUILD_KIT_OPS)
    assert response_platform_ops == list(DEFAULT_BUILD_KIT_OPS)
    assert overlay_payload == build_agent_template_overlay()


@pytest.mark.asyncio
async def test_resolved_build_kit_overlay_parses_through_from_params():
    """The overlay must survive embed resolution and parse with no error.

    Regression: each ``@ag.embed`` reference dropped its ``@ag.selector``, so the resolver inlined
    the whole ``revision.data`` and ``AgentTemplate.from_params`` raised HTTP 500
    ``Unsupported tool configuration shape``. Exercises overlay -> embed resolution (static
    catalogue, no DB) -> ``from_params`` end to end.
    """
    workflows_dao = AsyncMock()
    workflows_service = WorkflowsService(
        workflows_dao=workflows_dao,
        static_catalog=StaticWorkflowCatalog(),
    )
    workflows_service.embeds_service = EmbedsService(
        workflows_service=workflows_service
    )

    revision = WorkflowRevision(
        id=uuid4(),
        workflow_id=uuid4(),
        workflow_variant_id=uuid4(),
        slug="agent-default-config",
        data=WorkflowRevisionData(parameters={"agent": build_agent_template_overlay()}),
    )

    resolved, _ = await workflows_service.resolve_workflow_revision(
        project_id=uuid4(),
        workflow_revision=revision,
    )
    # No reserved embed may touch Postgres.
    workflows_dao.fetch_revision.assert_not_awaited()
    workflows_dao.fetch_artifact.assert_not_awaited()

    template = AgentTemplate.from_params({"agent": resolved.data.parameters["agent"]})

    platform_ops = [
        tool for tool in template.tools if isinstance(tool, PlatformToolConfig)
    ]
    client_tools = [
        tool for tool in template.tools if isinstance(tool, ClientToolConfig)
    ]
    assert [tool.op for tool in platform_ops] == list(DEFAULT_BUILD_KIT_OPS)
    # The reserved static embeds must coerce to client tools, not builtins.
    assert [tool.name for tool in client_tools] == [
        "request_connection",
        "request_input",
    ]
    assert client_tools[0].render == {"kind": "connect"}
    # The elicitation tool (interaction kinds M1) carries its REQUIRED render.kind.
    assert client_tools[1].render == {"kind": "elicitation"}
    assert [skill.name for skill in template.skills] == ["build-an-agent"]


@pytest.mark.asyncio
async def test_cut_overlay_ops_still_resolve_when_authored_explicitly():
    resolver = AgentaPlatformToolResolver(
        connection=PlatformConnection(
            base_url="https://api.example/api",
            authorization="Access tok",
        )
    )

    resolution = await resolver.resolve(
        [PlatformToolConfig(op=op) for op in CUT_BUILD_KIT_OPS]
    )

    assert {spec.name for spec in resolution.tool_specs} == set(CUT_BUILD_KIT_OPS)
