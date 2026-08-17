from __future__ import annotations

import httpx
import pytest

from agenta.sdk.agents import (
    GatewayToolResolutionError,
    ToolCallback,
)

from oss.src.agent.tools import resolve_tools
from agenta.sdk.agents.platform import gateway

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
    # A bare built-in name is a legacy entry: accepted, ignored, and never a resolved spec.
    assert resolved.tool_specs == []
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
                "permission": "ask",
                "render": {"kind": "component", "component": "User"},
            }
        ]
    )
    spec = resolved.tool_specs[0]
    assert spec.description == "get_user"
    assert spec.permission == "ask"
    assert spec.render == {"kind": "component", "component": "User"}
    assert spec.to_wire()["permission"] == "ask"
    assert isinstance(resolved.tool_callback, ToolCallback)
    assert capture["json"]["tools"][0]["type"] == "gateway"


async def test_each_gateway_tool_resolves_on_its_own_call_carrying_its_metadata(
    install_http,
):
    # Gateway tools now resolve one per HTTP call (so one dead action can be dropped without
    # bricking the rest). Each returned spec is matched to its requesting ref by call_ref, and
    # each tool's authored metadata (permission, render) lands on its own resulting spec.
    specs_by_ref = {
        "FIRST": {
            "name": "first",
            "description": "First",
            "input_schema": {},
            "call_ref": "tools.composio.github.FIRST.c1",
        },
        "SECOND": {
            "name": "second",
            "description": "Second",
            "input_schema": {},
            "call_ref": "tools.composio.github.SECOND.c2",
        },
    }

    def responder(request_json):
        # The resolver posts one ref per call; echo back the single matching spec.
        action = request_json["tools"][0]["action"]
        return {"custom": [specs_by_ref[action]]}

    install_http(gateway, responder=responder)
    resolved = await resolve_tools(
        [
            {
                **_GATEWAY,
                "action": "FIRST",
                "connection": "c1",
                "permission": "ask",
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
    assert first.permission == "ask"
    assert first.render is None
    assert second.name == "second"
    assert second.permission is None  # unset inherits: rules, then the policy default
    assert second.render == {"kind": "component", "component": "Second"}
    assert resolved.warnings == []


async def test_one_dead_action_is_dropped_and_the_rest_resolve(install_http):
    # The F-019 fix, end to end through the real gateway HTTP path: when the backend answers
    # one tool's /tools/resolve with a 404 (the action left the catalog), that tool is dropped
    # with a warning that names it, and the sibling tool still resolves and runs.
    def responder(request_json):
        action = request_json["tools"][0]["action"]
        if action == "COMMIT_MULTIPLE_FILES":
            return (
                404,
                {"detail": "Action not found: composio/github/COMMIT_MULTIPLE_FILES"},
            )
        return {
            "custom": [
                {
                    "name": "get_user",
                    "description": "Get user",
                    "input_schema": {},
                    "call_ref": "tools.composio.github.GET_USER.c1",
                }
            ]
        }

    install_http(gateway, responder=responder)
    resolved = await resolve_tools(
        [
            {**_GATEWAY, "action": "GET_USER", "connection": "c1"},
            {**_GATEWAY, "action": "COMMIT_MULTIPLE_FILES", "connection": "c1"},
        ]
    )

    assert [spec.name for spec in resolved.tool_specs] == ["get_user"]
    assert len(resolved.warnings) == 1
    warning = resolved.warnings[0]
    assert "tools.composio.github.COMMIT_MULTIPLE_FILES.c1" in warning
    assert "Action not found: composio/github/COMMIT_MULTIPLE_FILES" in warning
    assert isinstance(resolved.tool_callback, ToolCallback)


async def test_a_non_404_gateway_failure_still_fails_the_run(install_http):
    # Only a per-tool 404 is tolerated. A systemic failure (here HTTP 400) would hit every tool,
    # so it must fail the whole resolution loudly rather than silently drop tools.
    def responder(request_json):
        action = request_json["tools"][0]["action"]
        if action == "COMMIT_MULTIPLE_FILES":
            return (400, {"detail": "Connection is inactive"})
        return {
            "custom": [
                {
                    "name": "get_user",
                    "description": "Get user",
                    "input_schema": {},
                    "call_ref": "tools.composio.github.GET_USER.c1",
                }
            ]
        }

    install_http(gateway, responder=responder)
    with pytest.raises(GatewayToolResolutionError) as caught:
        await resolve_tools(
            [
                {**_GATEWAY, "action": "GET_USER", "connection": "c1"},
                {**_GATEWAY, "action": "COMMIT_MULTIPLE_FILES", "connection": "c1"},
            ]
        )
    assert caught.value.status == 400


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
