from copy import deepcopy

import pytest
from agenta.sdk.agents.dtos import AgentTemplate
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS
from agenta.sdk.agents.tools import (
    CallbackToolSpec,
    GatewayToolResolution,
    ToolCallback,
    ToolResolver,
)
from agenta.sdk.agents.tools.models import effective_permission
from agenta.sdk.utils.types import build_agent_v0_default
from oss.src.apis.fastapi.agent_templates.models import TemplateLoadRequest
from oss.src.core.workflows.build_kit import (
    DEFAULT_BUILD_KIT_OPS,
    apply_ui_build_kit,
    build_agent_template_overlay,
    build_kit_op_access,
)
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog
from pydantic import ValidationError


def test_every_default_tool_is_allowed_even_under_allow_reads():
    for tool in build_agent_template_overlay()["tools"]:
        if tool.get("type") == "platform":
            assert (
                effective_permission(tool["permission"], False, "allow_reads")
                == "allow"
            )


def test_access_metadata_comes_from_catalog_and_is_not_agent_config():
    access = build_kit_op_access()
    assert set(access) == set(DEFAULT_BUILD_KIT_OPS)
    assert access == {
        op: "read" if PLATFORM_OPS[op].read_only else "write"
        for op in DEFAULT_BUILD_KIT_OPS
    }
    revision = StaticWorkflowCatalog().retrieve_revision(slug="__ag__build_kit")
    assert revision.data.parameters["op_access"] == access
    assert "op_access" not in revision.data.parameters["agent"]
    assert access["test_subscription"] == "write"
    assert access["list_schedules"] == "read"


@pytest.mark.parametrize("wrapped", [True, False])
def test_permission_map_removes_disabled_shadow_and_does_not_mutate_base(wrapped):
    agent = {
        "tools": [
            {"type": "platform", "op": "remove_schedule", "permission": "allow"},
            {"type": "code", "name": "custom"},
        ]
    }
    base = {"agent": agent} if wrapped else agent
    original = deepcopy(base)
    result = apply_ui_build_kit(
        base, ["remove_schedule"], {"create_schedule": "ask", "unknown": "allow"}
    )
    tools = (result["agent"] if wrapped else result)["tools"]
    by_op = {t["op"]: t for t in tools if t.get("type") == "platform"}
    assert "remove_schedule" not in by_op
    assert "unknown" not in by_op
    assert (
        effective_permission(by_op["create_schedule"]["permission"], False, "allow")
        == "ask"
    )
    assert by_op["apply_skill_update"]["permission"] == "allow"
    assert {"type": "code", "name": "custom"} in tools
    assert base == original


@pytest.mark.parametrize(
    "permissions",
    [
        {"create_schedule": "deny"},
        {"create_schedule": "invalid"},
        {str(i): "ask" for i in range(129)},
    ],
)
def test_load_request_rejects_invalid_permissions(permissions):
    with pytest.raises(ValidationError):
        TemplateLoadRequest(
            source={"kind": "internal", "key": "pr-reviewer"},
            base_revision={},
            initial_message="Review",
            ui_op_permissions=permissions,
        )


def test_shared_frontend_resolution_fixtures_apply_identically():
    import json
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[6]
        / "web/packages/agenta-entities/tests/fixtures/buildKitPermissions.json"
    )
    for case in json.loads(path.read_text()):
        result = apply_ui_build_kit({}, case["state"]["disabledOps"], case["expected"])
        actual = {
            t["op"]: t["permission"]
            for t in result["tools"]
            if t.get("op") in {"read_config", "create_schedule"}
        }
        assert actual == case["expected"]


class _Platform:
    """One spec per platform tool, so the test reads the final tool list of the run."""

    async def resolve(self, tools, *, permission_default="allow_reads"):
        return GatewayToolResolution(
            tool_specs=[
                CallbackToolSpec(
                    name=tool.op,
                    description=tool.op,
                    call={"method": "POST", "path": f"/api/{tool.op}"},
                    permission=tool.permission,
                )
                for tool in tools
            ],
            tool_callback=ToolCallback(endpoint="https://example/tools/call"),
        )


@pytest.mark.asyncio
async def test_a_switched_off_kit_tool_is_gone_from_the_run_even_when_saved():
    """Codex review #1: the saved `agenta_tools` map brought the tools back.

    The resolver expands every tool the saved map lists, so the kit's off switch has to
    reach that map too. The default saved map holds the four agent tools; `read_config` and
    `commit_revision` show the same switch works for the self-edit pair.
    """
    agent = build_agent_v0_default()
    agent["tools"][0]["tools"].update(read_config="allow", commit_revision="ask")
    saved = deepcopy(agent)
    switched_off = [
        "read_agent_config",
        "create_agent",
        "edit_agent_config",
        "read_config",
        "commit_revision",
    ]

    run = apply_ui_build_kit({"agent": agent}, switched_off)["agent"]
    # The kit's embeds resolve server-side before a run; they carry no platform tool.
    run["tools"] = [tool for tool in run["tools"] if "@ag.embed" not in tool]
    run["skills"] = []
    template = AgentTemplate.from_params({"agent": run})
    resolved = await ToolResolver(platform_resolver=_Platform()).resolve(
        template.tools, session_id="s-1"
    )

    names = {spec.name for spec in resolved.tool_specs}
    assert names.isdisjoint(switched_off)
    assert {"list_agents", "rename_session", "test_run"} <= names
    # Only the run copy changes.
    assert agent == saved
