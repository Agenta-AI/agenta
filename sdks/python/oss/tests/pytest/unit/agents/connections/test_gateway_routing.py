"""The gateway-route builders in ``connections/endpoints.py`` (WP12).

``resolve_connection``'s connected path answers "the gateway, and our credentials for it"
instead of "which provider, which key" (specs-wp12.md). These are the pieces that make that
route: the D30 ``(namespace, name)`` grammar, the D33/D34 front-door gate, and the builder
that assembles a :class:`ResolvedConnection` carrying no provider secret.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents.connections.endpoints import (
    build_gateway_resolved_connection,
    gateway_route,
    gateway_target,
)

# --------------------------------------------------------------------- gateway_target (D30)


def test_provider_key_routes_through_standard():
    assert gateway_target(kind="provider_key", provider="OpenAI", slug="whatever") == (
        "standard",
        "openai",
    )


def test_custom_provider_routes_through_custom_by_slug():
    assert gateway_target(kind="custom_provider", provider="openai", slug="my-gw") == (
        "custom",
        "my-gw",
    )


# ---------------------------------------------------------------------------- gateway_route


def test_gateway_route_has_no_protocol_suffix():
    route = gateway_route(
        namespace="standard", name="openai", gateway_base_url="https://gw.example/api"
    )
    assert route == "https://gw.example/api/gateways/llms/standard/openai"
    assert "/v1/" not in route


def test_gateway_route_strips_a_trailing_slash_on_the_base():
    route = gateway_route(
        namespace="custom", name="my-gw", gateway_base_url="https://gw.example/api/"
    )
    assert route == "https://gw.example/api/gateways/llms/custom/my-gw"


# --------------------------------------------------------- build_gateway_resolved_connection


def test_build_gateway_resolved_connection_carries_no_provider_secret():
    resolved = build_gateway_resolved_connection(
        provider="openai",
        model="gpt-5.5",
        deployment="direct",
        namespace="standard",
        name="openai",
        gateway_base_url="https://gw.example/api",
        gateway_credentials_value="Secret token",
    )
    assert resolved.credential_mode == "none"
    assert resolved.credentials == []
    assert resolved.endpoint.base_url == (
        "https://gw.example/api/gateways/llms/standard/openai"
    )
    assert resolved.gateway_credentials is not None
    assert resolved.gateway_credentials.value == "Secret token"
    # Structural guard (F-SDK-DUMP): no upstream secret leaves through a dump either, and
    # there is none to leave here in the first place.
    assert "sk-" not in resolved.model_dump_json()


def test_build_gateway_resolved_connection_requires_an_effective_https_route():
    with pytest.raises(ValueError):
        build_gateway_resolved_connection(
            provider="openai",
            model="gpt-5.5",
            deployment="direct",
            namespace="standard",
            name="openai",
            gateway_base_url="http://gateway.example.com",
            gateway_credentials_value="Secret token",
        )


@pytest.mark.parametrize(
    "gateway_base_url",
    ["http://localhost:8000", "http://127.0.0.1:8000"],
)
def test_build_gateway_resolved_connection_allows_loopback_http(gateway_base_url):
    # W2: the https requirement is loopback-exempt, and the gateway route is no exception.
    resolved = build_gateway_resolved_connection(
        provider="openai",
        model="gpt-5.5",
        deployment="direct",
        namespace="standard",
        name="openai",
        gateway_base_url=gateway_base_url,
        gateway_credentials_value="Secret token",
    )
    assert resolved.plaintext_headers() == {"X-AG-Credentials": "Secret token"}
