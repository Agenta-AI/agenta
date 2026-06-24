from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from agenta.sdk.agents.tools import BuiltinToolConfig, GatewayToolConfig

from oss.src.apis.fastapi.tools.models import ToolResolveRequest
from oss.src.core.tools.dtos import AgentBuiltinTool, AgentComposioTool
from oss.src.core.tools.providers.composio.catalog import _derive_read_only
from oss.src.core.tools.service import ToolsService


def test_api_reuses_sdk_tool_config_classes():
    assert AgentBuiltinTool is BuiltinToolConfig
    assert AgentComposioTool is GatewayToolConfig


def test_resolve_request_coerces_legacy_composio_shape():
    request = ToolResolveRequest(
        tools=[
            "read",
            {
                "type": "composio",
                "integration": "github",
                "action": "GET_USER",
                "connection": "c1",
            },
        ]
    )
    assert isinstance(request.tools[0], BuiltinToolConfig)
    assert isinstance(request.tools[1], GatewayToolConfig)


def test_resolve_request_rejects_non_gateway_runtime_tools():
    with pytest.raises(ValidationError, match="only builtin and gateway"):
        ToolResolveRequest(
            tools=[
                {
                    "type": "code",
                    "name": "calc",
                    "script": "...",
                }
            ]
        )


async def test_api_resolution_returns_stable_call_reference(monkeypatch):
    service = object.__new__(ToolsService)

    async def _connection(**_kwargs):
        return object()

    async def _action(**_kwargs):
        return SimpleNamespace(
            description="Get user",
            schemas=SimpleNamespace(
                inputs={"type": "object", "properties": {}},
            ),
            read_only=True,
        )

    monkeypatch.setattr(service, "resolve_connection_by_slug", _connection)
    monkeypatch.setattr(service, "get_action", _action)

    result = await service.resolve_agent_tools(
        project_id=uuid4(),
        tools=[
            BuiltinToolConfig(name="read"),
            GatewayToolConfig(
                integration="github",
                action="GET_USER",
                connection="c1",
            ),
        ],
    )
    assert result.builtins == ["read"]
    assert result.custom[0].call_ref == "tools.composio.github.GET_USER.c1"
    assert result.custom[0].read_only is True


@pytest.mark.parametrize(
    "tags, expected",
    [
        (["readOnlyHint"], True),
        (["updateHint"], False),
        (["destructiveHint"], False),
        # A mutating hint wins even when readOnlyHint is also present.
        (["destructiveHint", "readOnlyHint"], False),
        (["updateHint", "readOnlyHint"], False),
        # Unknown == None (never guess), not False.
        ([], None),
        (None, None),
        (["unrelatedHint"], None),
        # Non-list input is ignored.
        ("readOnlyHint", None),
    ],
)
def test_derive_read_only_tag_matrix(tags, expected):
    assert _derive_read_only(tags) is expected
