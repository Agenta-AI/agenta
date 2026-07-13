"""The offline SDK-default resolvers: ``EnvConnectionResolver`` / ``StaticConnectionResolver``.

Locks the least-privilege contract: managed resolvers return exactly the requested credential or
fail closed. Only an explicit self-managed connection yields ``runtime_provided`` with no env.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents.connections import (
    Connection,
    EnvConnectionResolver,
    MissingCredentialError,
    ModelRef,
    RuntimeAuthContext,
    StaticConnectionResolver,
    UnsupportedProviderError,
)


def _credential_environment(resolved) -> dict[str, str]:
    return {item.binding.name: item.value for item in resolved.credentials}


_CTX = RuntimeAuthContext(harness="pi_core")


# -------------------------------------------------------------- EnvConnectionResolver


async def test_env_resolver_returns_only_the_requested_provider_var():
    resolver = EnvConnectionResolver(
        env={"OPENAI_API_KEY": "sk-openai", "ANTHROPIC_API_KEY": "sk-anthropic"}
    )
    resolved = await resolver.resolve(
        model=ModelRef(provider="openai", model="gpt-5.5"),
        context=_CTX,
    )
    assert resolved.credential_mode == "env"
    # Least privilege: exactly the one var, never the other provider's key.
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-openai"}
    assert resolved.model == "gpt-5.5"
    assert resolved.provider == "openai"
    assert resolved.endpoint.base_url == "https://api.openai.com/v1"
    assert [item.usage for item in resolved.credentials] == ["opaque_http"]


async def test_env_resolver_reads_the_live_process_env(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-from-env")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    resolver = EnvConnectionResolver()
    resolved = await resolver.resolve(
        model=ModelRef(provider="openai", model="gpt-5.5"),
        context=_CTX,
    )
    assert resolved.credential_mode == "env"
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-from-env"}


async def test_env_resolver_absent_key_fails_closed():
    resolver = EnvConnectionResolver(env={})
    with pytest.raises(MissingCredentialError, match="self_managed"):
        await resolver.resolve(
            model=ModelRef(provider="openai", model="gpt-5.5"),
            context=_CTX,
        )


async def test_env_resolver_self_managed_is_runtime_provided():
    resolver = EnvConnectionResolver(env={"OPENAI_API_KEY": "sk-openai"})
    resolved = await resolver.resolve(
        model=ModelRef(
            provider="openai",
            model="gpt-5.5",
            connection=Connection(mode="self_managed"),
        ),
        context=_CTX,
    )
    # Self-managed injects nothing even when a key is in the env.
    assert resolved.credential_mode == "runtime_provided"
    assert _credential_environment(resolved) == {}


async def test_env_resolver_errors_without_a_provider():
    resolver = EnvConnectionResolver(env={"OPENAI_API_KEY": "sk-openai"})
    with pytest.raises(UnsupportedProviderError):
        await resolver.resolve(model=ModelRef(model="gpt-5.5"), context=_CTX)


# ------------------------------------------------------------ StaticConnectionResolver


async def test_static_resolver_builds_from_an_api_key():
    resolver = StaticConnectionResolver(provider="openai", api_key="sk-static")
    resolved = await resolver.resolve(
        model=ModelRef(provider="openai", model="gpt-5.5"),
        context=_CTX,
    )
    assert resolved.credential_mode == "env"
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-static"}
    assert resolved.provider == "openai"
    assert resolved.model == "gpt-5.5"


async def test_static_resolver_carries_a_base_url_into_the_endpoint():
    resolver = StaticConnectionResolver(
        provider="openai",
        api_key="sk-static",
        base_url="https://gw.example:8443/v1",
    )
    resolved = await resolver.resolve(
        model=ModelRef(provider="openai", model="gpt-5.5"),
        context=_CTX,
    )
    assert resolved.endpoint is not None
    assert resolved.endpoint.base_url == "https://gw.example:8443/v1"
    # The base URL is non-secret and must not leak into env.
    assert _credential_environment(resolved) == {"OPENAI_API_KEY": "sk-static"}


async def test_static_resolver_without_a_key_fails_closed():
    resolver = StaticConnectionResolver(provider="openai")
    with pytest.raises(MissingCredentialError, match="self_managed"):
        await resolver.resolve(
            model=ModelRef(provider="openai", model="gpt-5.5"),
            context=_CTX,
        )


async def test_static_resolver_self_managed_without_a_key_is_runtime_provided():
    resolver = StaticConnectionResolver(provider="openai")
    resolved = await resolver.resolve(
        model=ModelRef(
            provider="openai",
            model="gpt-5.5",
            connection=Connection(mode="self_managed"),
        ),
        context=_CTX,
    )
    assert resolved.credential_mode == "runtime_provided"
    assert _credential_environment(resolved) == {}


async def test_static_resolver_from_dict():
    resolver = StaticConnectionResolver.from_dict(
        {"provider": "anthropic", "api_key": "sk-ant"}
    )
    resolved = await resolver.resolve(
        model=ModelRef(provider="anthropic", model="claude-opus-4-8"),
        context=_CTX,
    )
    assert _credential_environment(resolved) == {"ANTHROPIC_API_KEY": "sk-ant"}
    assert resolved.provider == "anthropic"
