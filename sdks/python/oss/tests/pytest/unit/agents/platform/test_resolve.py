"""The platform composition entrypoints and their public compatibility exports."""

from __future__ import annotations

from typing import Mapping, Sequence

import pytest
from agenta.sdk.agents.connections import (
    ModelRef,
    ResolvedConnection,
    RuntimeAuthContext,
)
from agenta.sdk.agents.platform import (
    PlatformConnection,
    resolve_connection,
    resolve_mcp,
    resolve_secrets,
    resolve_tools,
)
from agenta.sdk.agents.platform import connection as platform_connection
from agenta.sdk.agents.platform.resolve import resolve_secrets as module_resolve_secrets

from .conftest import GATEWAY_CREDENTIALS_VALUE


@pytest.fixture(name="gateway_exchange")
def _gateway_exchange(monkeypatch):
    """Answer the credential exchange `resolve_mcp` makes before it routes a server.

    Returns the calls it saw, so a test can prove the exchange happened at all rather than
    the caller's own credential being passed through.
    """
    calls: list[dict] = []

    class _Response:
        status_code = 200

        @staticmethod
        def json():
            return {"credentials": GATEWAY_CREDENTIALS_VALUE}

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json=None, headers=None):
            calls.append({"url": url, "headers": headers})
            return _Response()

    monkeypatch.setattr(platform_connection.httpx, "AsyncClient", _Client)
    return calls


class _EmptySecrets:
    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return {}


class _ExplodingGateway:
    async def resolve(self, tools):
        raise AssertionError(
            "gateway resolver must not be called without gateway tools"
        )


async def test_resolve_secrets_is_a_deprecated_connection_alias():
    calls: dict[str, object] = {}
    expected = ResolvedConnection(
        provider="openai",
        model="gpt-5.5",
        credential_mode="none",
    )
    model = ModelRef(provider="openai", model="gpt-5.5")
    context = RuntimeAuthContext(harness="pi_core", backend="local")

    class _Resolver:
        async def resolve(self, *, model, context):
            calls.update(model=model, context=context)
            return expected

    assert resolve_secrets is module_resolve_secrets
    with pytest.warns(DeprecationWarning, match="resolve_secrets.*resolve_connection"):
        resolved = await resolve_secrets(
            model=model,
            context=context,
            resolver=_Resolver(),
        )

    assert resolved is expected
    assert calls == {"model": model, "context": context}


async def test_resolve_connection_remains_the_canonical_entrypoint():
    expected = ResolvedConnection(
        provider="openai",
        model="gpt-5.5",
        credential_mode="none",
    )

    class _Resolver:
        async def resolve(self, *, model, context):
            return expected

    resolved = await resolve_connection(
        model=ModelRef(provider="openai", model="gpt-5.5"),
        context=RuntimeAuthContext(harness="pi_core", backend="local"),
        resolver=_Resolver(),
    )

    assert resolved is expected


async def test_resolve_tools_skips_gateway_without_gateway_tools():
    # No gateway tool ⇒ the gateway resolver (and its HTTP) is never touched. An exploding
    # resolver proves the short-circuit: resolution completes without invoking it.
    resolved = await resolve_tools(
        ["read", {"type": "client", "name": "pick"}],
        secret_provider=_EmptySecrets(),
        gateway_resolver=_ExplodingGateway(),
    )
    assert {spec.name for spec in resolved.tool_specs} == {"pick"}


async def test_resolve_mcp_empty_returns_empty():
    assert await resolve_mcp([], secret_provider=_EmptySecrets()) == []


async def test_resolve_mcp_routes_through_the_gateway_when_configured(gateway_exchange):
    # `resolve_mcp` is the connected default: with a backend configured, every
    # server routes through `custom/{name}` with our credentials rather than dialling the
    # author's own URL with a named secret — `_EmptySecrets` proves no vault lookup happens.
    connection = PlatformConnection(
        base_url="https://api.x/api", authorization="Access tok"
    )
    resolved = await resolve_mcp(
        [
            {
                "name": "notion",
                "connection": {"type": "http", "url": "https://93.184.216.34/mcp"},
            }
        ],
        secret_provider=_EmptySecrets(),
        connection=connection,
    )
    assert len(resolved) == 1
    assert resolved[0].url == "https://api.x/api/gateways/mcps/custom/notion"
    assert [c.binding.name for c in resolved[0].credentials] == ["X-AG-Credentials"]
    # OD24: the sandbox carries a gateway-audience credential obtained in exchange for the
    # caller's, never the caller's own value, which reads the vault in plaintext.
    assert [c.value for c in resolved[0].credentials] == [GATEWAY_CREDENTIALS_VALUE]
    assert [call["url"] for call in gateway_exchange] == [
        "https://api.x/api/gateways/credentials"
    ]


async def test_resolve_mcp_selects_a_platform_mcp_route_when_declared(gateway_exchange):
    connection = PlatformConnection(
        base_url="https://api.x/api", authorization="Access tok"
    )
    resolved = await resolve_mcp(
        [
            {
                "name": "mock-tools",
                "connection": {
                    "type": "gateway",
                    "namespace": "standard",
                    "provider": "mock",
                },
            }
        ],
        secret_provider=_EmptySecrets(),
        connection=connection,
    )
    assert resolved[0].url == "https://api.x/api/gateways/mcps/standard/mock"
    assert [c.binding.name for c in resolved[0].credentials] == ["X-AG-Credentials"]
    assert [c.value for c in resolved[0].credentials] == [GATEWAY_CREDENTIALS_VALUE]
