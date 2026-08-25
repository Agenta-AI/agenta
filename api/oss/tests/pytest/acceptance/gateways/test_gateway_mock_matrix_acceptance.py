"""One real-socket acceptance suite for every local gateway mock route.

The old gateway proxy tests intentionally remain focused custom-endpoint regression
tests.  This module is the matrix proof: it invokes each generated or persisted
entry through its public route. Generated mock entries use the in-process mock
adapter; custom entries additionally prove the configured mock server works.

The suite skips when the required mock routes are unavailable.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

import pytest

from oss.tests.pytest.acceptance.gateways.mock_matrix import (
    CredentialOwner,
    GATEWAY_MOCK_CASES,
    GatewayMockCase,
    GatewayPlane,
    LLM_MOCK_CASES,
    MCP_MOCK_CASES,
    unique_slug,
)


_MOCKS_ENABLED = os.getenv("AGENTA_GATEWAYS_MOCKS_ENABLED", "").lower() == "true"
_UPSTREAM_TOKEN = os.getenv("AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN")
_LLM_MOCK_URL = os.getenv(
    "AGENTA_MOCK_LLM_GATEWAY_URL", "http://mock-llm-gateway:9091/v1"
)
_MCP_MOCK_URL = os.getenv(
    "AGENTA_MOCK_MCP_GATEWAY_URL", "http://mock-mcp-gateway:9092/"
)
_PROFILE_HEADER = "x-agenta-mock-profile"

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.skipif(
        not _MOCKS_ENABLED,
        reason=(
            "gateway mock matrix is disabled "
            "(set AGENTA_GATEWAYS_MOCKS_ENABLED=true in an OSS/EE dev compose stack)"
        ),
    ),
]


def _assert_ok(response) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    return response.json()


def _provider_secret(authed_api) -> str:
    """Create the project-owned credential selected by standard mock entries.

    ``mock`` is a development-only standard provider introduced by WP28.  Its
    token is deliberately read from the environment, never rendered in an
    assertion or failure message.
    """
    if not _UPSTREAM_TOKEN:
        pytest.skip("AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN is not configured")

    response = authed_api(
        "POST",
        "/secrets/",
        json={
            "header": {"name": "mock"},
            "secret": {
                "kind": "provider_key",
                "data": {"kind": "mock", "provider": {"key": _UPSTREAM_TOKEN}},
            },
        },
    )
    body = _assert_ok(response)
    return body["id"]


def _direct_secret(authed_api) -> str:
    """Create a test-project-only direct credential for custom mock endpoints.

    A custom-provider secret is the existing direct API-key representation for a
    stored endpoint. The value is never kept in a fixture result, so pytest cannot
    expose it in assertion rendering.
    """
    if not _UPSTREAM_TOKEN:
        pytest.skip("AGENTA_GATEWAYS_MOCKS_UPSTREAM_TOKEN is not configured")

    response = authed_api(
        "POST",
        "/secrets/",
        json={
            "header": {"name": unique_slug("gateway-mock-key")},
            "secret": {
                "kind": "custom_provider",
                "data": {
                    "kind": "custom",
                    "provider": {"key": _UPSTREAM_TOKEN},
                    "models": [],
                },
            },
        },
    )
    body = _assert_ok(response)
    return body["id"]


def _create_custom_llm_endpoint(authed_api, *, secret_id: str) -> dict[str, Any]:
    slug = unique_slug("gateway-mock-llm")
    body = _assert_ok(
        authed_api(
            "POST",
            "/gateways/llms/endpoints/",
            json={
                "endpoint": {
                    "slug": slug,
                    "provider_key": "mock",
                    "deployment_kind": "custom",
                    "secret_id": secret_id,
                    "data": {
                        "route": {
                            "base_url": _LLM_MOCK_URL,
                            "headers": {"X-Agenta-Mock-Profile": "llm-custom-mock"},
                        },
                        "models": {
                            "allowlist": [
                                "mock/echo",
                                "mock/error",
                                "mock/slow-30",
                            ]
                        },
                    },
                }
            },
        )
    )
    return body["endpoint"]


def _create_custom_mcp_endpoint(authed_api, *, secret_id: str) -> dict[str, Any]:
    slug = unique_slug("gateway-mock-mcp")
    body = _assert_ok(
        authed_api(
            "POST",
            "/gateways/mcps/endpoints/",
            json={
                "endpoint": {
                    "slug": slug,
                    "auth_mode": "api_key",
                    "secret_id": secret_id,
                    "data": {
                        "route": {
                            "base_url": _MCP_MOCK_URL,
                            "headers": {"X-Agenta-Mock-Profile": "mcp-custom-mock"},
                        }
                    },
                }
            },
        )
    )
    return body["endpoint"]


@pytest.fixture
def gateway_mock_case(request) -> GatewayMockCase:
    return request.param


@pytest.fixture
def provisioned_gateway_mock_case(
    authed_api, gateway_mock_case: GatewayMockCase
) -> Iterator[tuple[GatewayMockCase, str]]:
    """Provision only normal project-owned resources needed by a matrix row."""
    case = gateway_mock_case
    cleanup: list[tuple[str, str]] = []
    name: str | None = None
    try:
        if case.credential_owner is CredentialOwner.PROJECT:
            secret_id = _provider_secret(authed_api)
            cleanup.append(("/secrets", secret_id))

        if case.requires_custom_endpoint:
            secret_id = _direct_secret(authed_api)
            cleanup.append(("/secrets", secret_id))
            endpoint = (
                _create_custom_llm_endpoint(authed_api, secret_id=secret_id)
                if case.plane is GatewayPlane.LLM
                else _create_custom_mcp_endpoint(authed_api, secret_id=secret_id)
            )
            endpoint_route = (
                "/gateways/llms/endpoints"
                if case.plane is GatewayPlane.LLM
                else "/gateways/mcps/endpoints"
            )
            cleanup.append((endpoint_route, endpoint["id"]))
            name = endpoint["slug"]
        yield case, case.route(name=name)
    finally:
        # Endpoints refer to secrets, so delete resources in reverse creation order.
        for collection, resource_id in reversed(cleanup):
            authed_api("DELETE", f"{collection}/{resource_id}")


def _assert_profile(response, *, case: GatewayMockCase) -> None:
    # The profile is public, non-secret diagnostic metadata owned by the mock;
    # do not include request headers or the upstream credential in a failure.
    assert case.upstream_profile is not None
    assert response.headers.get(_PROFILE_HEADER) == case.upstream_profile


def _llm_payload(*, stream: bool = False, model: str = "mock/echo") -> dict[str, Any]:
    return {
        "model": model,
        "stream": stream,
        "messages": [{"role": "user", "content": "matrix"}],
    }


def _mcp_call(gateway_api, route: str, payload: dict[str, Any]):
    headers = {"MCP-Method": payload["method"]}
    name = (payload.get("params") or {}).get("name")
    if name:
        headers["MCP-Name"] = name
    return gateway_api("POST", route, json=payload, headers=headers)


@pytest.mark.parametrize("gateway_mock_case", GATEWAY_MOCK_CASES, indirect=True)
def test_every_dev_mock_case_reaches_its_selected_profile(
    gateway_api, provisioned_gateway_mock_case
):
    case, route = provisioned_gateway_mock_case

    if case.plane is GatewayPlane.LLM:
        response = gateway_api("POST", f"{route}/chat/completions", json=_llm_payload())
        body = _assert_ok(response)
        assert body["object"] == "chat.completion"
    else:
        response = _mcp_call(
            gateway_api,
            route,
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
        body = _assert_ok(response)
        assert {tool["name"] for tool in body["result"]["tools"]} >= {"echo"}

    if case.requires_custom_endpoint:
        _assert_profile(response, case=case)


@pytest.mark.parametrize("gateway_mock_case", GATEWAY_MOCK_CASES, indirect=True)
def test_every_dev_mock_case_rejects_an_unauthenticated_caller(
    unauthed_api, provisioned_gateway_mock_case
):
    case, route = provisioned_gateway_mock_case
    if case.plane is GatewayPlane.LLM:
        response = unauthed_api(
            "POST", f"{route}/chat/completions", json=_llm_payload()
        )
    else:
        response = unauthed_api(
            "POST",
            route,
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            headers={"MCP-Method": "tools/list"},
        )
    assert response.status_code in (401, 403), response.text


@pytest.mark.parametrize("gateway_mock_case", LLM_MOCK_CASES, indirect=True)
def test_every_llm_mock_case_preserves_streaming_framing(
    gateway_api, provisioned_gateway_mock_case
):
    case, route = provisioned_gateway_mock_case
    response = gateway_api(
        "POST", f"{route}/chat/completions", json=_llm_payload(stream=True)
    )

    assert response.status_code == 200, response.text
    assert response.content.endswith(b"data: [DONE]\n\n")
    if case.requires_custom_endpoint:
        _assert_profile(response, case=case)


@pytest.mark.parametrize("gateway_mock_case", MCP_MOCK_CASES, indirect=True)
def test_every_mcp_mock_case_relays_a_tool_call(
    gateway_api, provisioned_gateway_mock_case
):
    case, route = provisioned_gateway_mock_case
    response = _mcp_call(
        gateway_api,
        route,
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": "echo", "arguments": {"text": "matrix"}},
        },
    )

    body = _assert_ok(response)
    assert body["id"] == 2
    if case.requires_custom_endpoint:
        _assert_profile(response, case=case)
