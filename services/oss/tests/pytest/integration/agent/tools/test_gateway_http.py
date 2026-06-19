from __future__ import annotations

import httpx
import pytest

from agenta.sdk.agents import (
    GatewayToolResolutionError,
    ToolCallback,
)

from oss.src.agent.tools import resolve_tools
from oss.src.agent.tools import gateway

pytestmark = pytest.mark.integration

_GATEWAY = {
    "type": "gateway",
    "provider": "composio",
    "integration": "github",
    "action": "GET_USER",
    "connection": "c1",
}


async def test_no_gateway_short_circuits_without_http(install_http):
    capture = install_http(gateway, raises=AssertionError("must not call HTTP"))
    resolved = await resolve_tools(["read"])
    assert resolved.builtin_names == ["read"]
    assert capture == {}


async def test_missing_api_base_raises_typed_error(install_http):
    install_http(gateway, api_base=None)
    with pytest.raises(GatewayToolResolutionError, match="API base URL"):
        await resolve_tools([_GATEWAY])


async def test_gateway_metadata_and_description_fallback_are_preserved(install_http):
    capture = install_http(
        gateway,
        payload={
            "custom": [
                {
                    "name": "get_user",
                    "description": None,
                    "input_schema": {"type": "object"},
                    "call_ref": "tools.composio.github.GET_USER.c1",
                }
            ]
        },
    )
    resolved = await resolve_tools(
        [
            {
                **_GATEWAY,
                "needs_approval": True,
                "render": {"kind": "component", "component": "User"},
            }
        ]
    )
    spec = resolved.tool_specs[0]
    assert spec.description == "get_user"
    assert spec.needs_approval is True
    assert spec.render == {"kind": "component", "component": "User"}
    assert spec.to_wire()["needsApproval"] is True
    assert isinstance(resolved.tool_callback, ToolCallback)
    assert capture["json"]["tools"][0]["type"] == "gateway"


async def test_gateway_specs_are_joined_by_call_ref_not_position(install_http):
    install_http(
        gateway,
        payload={
            "custom": [
                {
                    "name": "second",
                    "description": "Second",
                    "input_schema": {},
                    "call_ref": "tools.composio.github.SECOND.c2",
                },
                {
                    "name": "first",
                    "description": "First",
                    "input_schema": {},
                    "call_ref": "tools.composio.github.FIRST.c1",
                },
            ]
        },
    )
    resolved = await resolve_tools(
        [
            {
                **_GATEWAY,
                "action": "FIRST",
                "connection": "c1",
                "needs_approval": True,
            },
            {
                **_GATEWAY,
                "action": "SECOND",
                "connection": "c2",
                "render": {"kind": "component", "component": "Second"},
            },
        ]
    )
    first, second = resolved.tool_specs
    assert first.name == "first"
    assert first.needs_approval is True
    assert first.render is None
    assert second.name == "second"
    assert second.needs_approval is False
    assert second.render == {"kind": "component", "component": "Second"}


async def test_transport_failure_is_logged_and_normalized(
    install_http,
    monkeypatch,
):
    warnings = []
    monkeypatch.setattr(
        gateway,
        "log",
        type(
            "Log",
            (),
            {"warning": lambda self, *args, **kwargs: warnings.append(args)},
        )(),
    )
    request = httpx.Request("POST", "https://api.x/api/tools/resolve")
    install_http(gateway, raises=httpx.ConnectError("offline", request=request))
    with pytest.raises(GatewayToolResolutionError) as caught:
        await resolve_tools([_GATEWAY])
    assert isinstance(caught.value.__cause__, httpx.ConnectError)
    assert warnings
    assert "gateway tool resolution request failed" in warnings[0][0].lower()


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"custom": []}, "expected one per ref"),
        (
            {
                "custom": [
                    {
                        "name": "get_user",
                        "description": "x",
                        "input_schema": {},
                    }
                ]
            },
            "incomplete spec",
        ),
    ],
)
async def test_invalid_gateway_response_fails_fast(
    install_http,
    payload,
    message,
):
    install_http(gateway, payload=payload)
    with pytest.raises(GatewayToolResolutionError, match=message):
        await resolve_tools([_GATEWAY])


async def test_http_status_failure_is_typed(install_http):
    install_http(gateway, status=400, text="bad request")
    with pytest.raises(GatewayToolResolutionError) as caught:
        await resolve_tools([_GATEWAY])
    assert caught.value.status == 400
