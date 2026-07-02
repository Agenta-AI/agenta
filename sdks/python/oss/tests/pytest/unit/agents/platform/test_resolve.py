"""The composition entrypoints: resolve_tools / resolve_mcp / resolve_secrets."""

from __future__ import annotations

from typing import Mapping, Sequence

from agenta.sdk.agents.platform import (
    resolve_provider_keys,
    resolve_secrets,
    resolve_tools,
)
from agenta.sdk.agents.platform import resolve_mcp


class _EmptySecrets:
    async def get_many(self, names: Sequence[str]) -> Mapping[str, str]:
        return {}


class _ExplodingGateway:
    async def resolve(self, tools):
        raise AssertionError(
            "gateway resolver must not be called without gateway tools"
        )


async def test_resolve_tools_skips_gateway_without_gateway_tools():
    # No gateway tool ⇒ the gateway resolver (and its HTTP) is never touched. An exploding
    # resolver proves the short-circuit: resolution completes without invoking it.
    resolved = await resolve_tools(
        ["read", {"type": "client", "name": "pick"}],
        secret_provider=_EmptySecrets(),
        gateway_resolver=_ExplodingGateway(),
    )
    assert resolved.builtin_names == ["read"]
    assert {spec.name for spec in resolved.tool_specs} == {"pick"}


async def test_resolve_mcp_empty_returns_empty():
    assert await resolve_mcp([], secret_provider=_EmptySecrets()) == []


def test_resolve_secrets_is_the_provider_key_entrypoint():
    # The third entrypoint is the provider-key fetch (harness/model keys), not named secrets.
    assert resolve_secrets is resolve_provider_keys
