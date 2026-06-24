"""The Agenta gateway tool resolver against a mocked ``POST /tools/resolve``."""

from __future__ import annotations

import httpx
import pytest

from agenta.sdk.agents import (
    GatewayToolConfig,
    GatewayToolResolutionError,
    ToolCallback,
)
from agenta.sdk.agents.platform import AgentaGatewayToolResolver, PlatformConnection
from agenta.sdk.agents.platform import gateway


def _resolver(connection):
    return AgentaGatewayToolResolver(connection=connection)


def _gateway(**overrides) -> GatewayToolConfig:
    base = dict(integration="github", action="GET_USER", connection="c1")
    base.update(overrides)
    return GatewayToolConfig(**base)


async def test_missing_api_base_raises_typed_error():
    resolver = _resolver(PlatformConnection())  # no base URL configured
    with pytest.raises(GatewayToolResolutionError, match="API base URL"):
        await resolver.resolve([_gateway()])


async def test_gateway_metadata_and_description_fallback_are_preserved(
    fake_http, connection
):
    capture = fake_http(
        gateway,
        payload={
            "custom": [
                {
                    "name": "get_user",
                    "description": None,
                    "input_schema": {"type": "object"},
                    "call_ref": "tools.composio.github.GET_USER.c1",
                    "read_only": True,
                }
            ]
        },
    )
    resolved = await _resolver(connection).resolve(
        [
            _gateway(
                needs_approval=True,
                render={"kind": "component", "component": "User"},
            )
        ]
    )
    spec = resolved.tool_specs[0]
    assert spec.description == "get_user"  # falls back to name when null
    assert spec.needs_approval is True
    assert spec.render == {"kind": "component", "component": "User"}
    assert spec.read_only is True  # the catalog read-only hint reaches the spec
    assert spec.to_wire()["needsApproval"] is True
    assert spec.to_wire()["readOnly"] is True
    # needs_approval beats the read-only auto-allow: the gateway resolver's effective
    # disposition is "ask" (pins the real precedence end to end, not just the model helper).
    assert spec.to_wire()["disposition"] == "ask"
    assert isinstance(resolved.tool_callback, ToolCallback)
    assert resolved.tool_callback.endpoint == "https://api.x/api/tools/call"
    assert resolved.tool_callback.authorization == "Access tok"
    assert capture["url"] == "https://api.x/api/tools/resolve"
    assert capture["json"]["tools"][0]["type"] == "gateway"
    assert capture["headers"]["Authorization"] == "Access tok"


async def test_gateway_specs_are_joined_by_call_ref_not_position(fake_http, connection):
    fake_http(
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
    resolved = await _resolver(connection).resolve(
        [
            _gateway(action="FIRST", connection="c1", needs_approval=True),
            _gateway(
                action="SECOND",
                connection="c2",
                render={"kind": "component", "component": "Second"},
            ),
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
    fake_http, connection, monkeypatch
):
    warnings: list = []
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
    fake_http(gateway, raises=httpx.ConnectError("offline", request=request))
    with pytest.raises(GatewayToolResolutionError) as caught:
        await _resolver(connection).resolve([_gateway()])
    assert isinstance(caught.value.__cause__, httpx.ConnectError)
    assert warnings
    assert "gateway tool resolution request failed" in warnings[0][0].lower()


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"custom": []}, "expected one per ref"),
        (
            {"custom": [{"name": "get_user", "description": "x", "input_schema": {}}]},
            "incomplete spec",
        ),
    ],
)
async def test_invalid_gateway_response_fails_fast(
    fake_http, connection, payload, message
):
    fake_http(gateway, payload=payload)
    with pytest.raises(GatewayToolResolutionError, match=message):
        await _resolver(connection).resolve([_gateway()])


async def test_http_status_failure_is_typed(fake_http, connection):
    fake_http(gateway, status=400, text="bad request")
    with pytest.raises(GatewayToolResolutionError) as caught:
        await _resolver(connection).resolve([_gateway()])
    assert caught.value.status == 400
