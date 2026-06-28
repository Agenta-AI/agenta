from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from agenta.sdk.agents.adapters.agenta_builtins import GETTING_STARTED_WITH_AGENTA_SLUG
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS

from oss.src.apis.fastapi.applications import router as applications_router_module
from oss.src.apis.fastapi.applications.overlay import build_agent_template_overlay
from oss.src.apis.fastapi.applications.router import SimpleApplicationsRouter
from oss.src.core.applications.dtos import SimpleApplication
from oss.src.core.workflows.static_catalog import (
    STATIC_SLUG_PREFIX,
    StaticWorkflowCatalog,
    _STATIC_WORKFLOWS,
)


def _embed_slug(entry: dict) -> str | None:
    refs = entry.get("@ag.embed", {}).get("@ag.references", {})
    workflow = refs.get("workflow") or refs.get("workflow_revision") or {}
    return workflow.get("slug")


def test_agent_template_overlay_contains_platform_ops_authoring_skill_and_permissions():
    overlay = build_agent_template_overlay()

    platform_tools = [
        tool
        for tool in overlay["tools"]
        if isinstance(tool, dict) and tool.get("type") == "platform"
    ]
    assert platform_tools == [
        {"type": "platform", "op": op_name} for op_name in PLATFORM_OPS
    ]

    assert overlay["skills"] == [
        {
            "@ag.embed": {
                "@ag.references": {
                    "workflow": {"slug": GETTING_STARTED_WITH_AGENTA_SLUG}
                }
            }
        }
    ]
    assert overlay["sandbox"] == {
        "permissions": {"write_files": "allow", "execute_code": "allow"}
    }


def test_agent_template_overlay_includes_reserved_static_workflow_tool_embeds():
    overlay = build_agent_template_overlay()
    tool_embed_slugs = {
        _embed_slug(tool)
        for tool in overlay["tools"]
        if isinstance(tool, dict) and "@ag.embed" in tool
    }
    catalog = StaticWorkflowCatalog()

    expected_slugs = set()
    for slug in _STATIC_WORKFLOWS:
        revision = catalog.retrieve_revision(slug=slug)
        if (
            slug.startswith(STATIC_SLUG_PREFIX)
            and revision
            and revision.flags
            and not revision.flags.is_skill
        ):
            expected_slugs.add(slug)

    assert tool_embed_slugs == expected_slugs


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
    assert overlay == build_agent_template_overlay()
