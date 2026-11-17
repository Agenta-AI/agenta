from copy import deepcopy

import pytest
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS
from agenta.sdk.agents.tools.models import effective_permission
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
