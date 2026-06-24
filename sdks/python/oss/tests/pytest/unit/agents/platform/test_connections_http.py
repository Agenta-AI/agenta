"""``VaultConnectionResolver`` against a mocked ``POST /vault/connections/resolve``.

Mirrors ``test_secrets_http.py``'s style (the shared ``fake_http`` / ``connection`` fixtures).
Asserts the outgoing request shape, least-privilege parsing (only the selected provider's vars
come back), endpoint parsing, and that the resolver is FAIL-LOUD on an HTTP error (unlike the
deprecated whole-vault dump, which swallowed errors and returned empty).
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents.connections import (
    ConnectionResolutionError,
    ModelRef,
    RuntimeAuthContext,
)
from agenta.sdk.agents.platform import PlatformConnection, VaultConnectionResolver
from agenta.sdk.agents.platform import connections


def _model(slug: str = "openai-prod") -> ModelRef:
    return ModelRef(
        provider="openai",
        model="gpt-5.5",
        connection={"mode": "agenta", "slug": slug},
    )


def _context() -> RuntimeAuthContext:
    return RuntimeAuthContext(harness="pi", backend="local")


async def test_resolve_posts_model_and_parses_least_privilege(fake_http, connection):
    capture = fake_http(
        connections,
        payload={
            "provider": "openai",
            "model": "gpt-5.5",
            "deployment": "direct",
            "credential_mode": "env",
            "env": {"OPENAI_API_KEY": "sk-prod"},
        },
    )
    resolver = VaultConnectionResolver(connection)
    resolved = await resolver.resolve(model=_model(), context=_context())

    assert resolved.provider == "openai"
    assert resolved.model == "gpt-5.5"
    assert resolved.credential_mode == "env"
    # Least-privilege: only the selected provider's one var.
    assert resolved.env == {"OPENAI_API_KEY": "sk-prod"}

    assert capture["method"] == "POST"
    assert capture["url"] == "https://api.x/api/vault/connections/resolve"
    assert capture["headers"]["Authorization"] == "Access tok"
    # project_id is NOT sent in the body (server takes it from request context). The vault resolve
    # is harness-agnostic, so neither harness nor backend is sent either.
    assert "project_id" not in capture["json"]
    assert "harness" not in capture["json"]
    assert "backend" not in capture["json"]
    assert capture["json"]["model"]["connection"] == {
        "mode": "agenta",
        "slug": "openai-prod",
    }


async def test_resolve_parses_endpoint(fake_http, connection):
    fake_http(
        connections,
        payload={
            "provider": "openai",
            "model": "gpt-5.5",
            "deployment": "custom",
            "credential_mode": "env",
            "env": {"OPENAI_API_KEY": "sk-gw"},
            "endpoint": {"base_url": "https://gw.example/v1"},
        },
    )
    resolved = await VaultConnectionResolver(connection).resolve(
        model=_model(), context=_context()
    )
    assert resolved.deployment == "custom"
    assert resolved.endpoint is not None
    assert resolved.endpoint.base_url == "https://gw.example/v1"


async def test_resolve_fails_loud_on_http_error(fake_http, connection):
    fake_http(connections, status=404)
    with pytest.raises(ConnectionResolutionError):
        await VaultConnectionResolver(connection).resolve(
            model=_model("missing"), context=_context()
        )


async def test_resolve_fails_loud_on_network_exception(fake_http, connection):
    fake_http(connections, raises=RuntimeError("network down"))
    with pytest.raises(ConnectionResolutionError):
        await VaultConnectionResolver(connection).resolve(
            model=_model(), context=_context()
        )


async def test_resolve_sends_internal_token_header_when_configured(
    fake_http, connection, monkeypatch
):
    # The internal-service token (the genuine guard on the plaintext resolve route) rides the
    # X-Agenta-Internal-Token header when the agent service has it configured.
    from agenta.sdk.agents.platform.connections import (
        INTERNAL_RESOLVE_TOKEN_ENV,
        INTERNAL_RESOLVE_TOKEN_HEADER,
    )

    monkeypatch.setenv(INTERNAL_RESOLVE_TOKEN_ENV, "tok-internal")
    capture = fake_http(
        connections,
        payload={
            "provider": "openai",
            "model": "gpt-5.5",
            "deployment": "direct",
            "credential_mode": "env",
            "env": {"OPENAI_API_KEY": "sk-prod"},
        },
    )
    await VaultConnectionResolver(connection).resolve(
        model=_model(), context=_context()
    )
    assert capture["headers"][INTERNAL_RESOLVE_TOKEN_HEADER] == "tok-internal"


async def test_resolve_omits_internal_token_header_when_unset(
    fake_http, connection, monkeypatch
):
    from agenta.sdk.agents.platform.connections import (
        INTERNAL_RESOLVE_TOKEN_ENV,
        INTERNAL_RESOLVE_TOKEN_HEADER,
    )

    monkeypatch.delenv(INTERNAL_RESOLVE_TOKEN_ENV, raising=False)
    capture = fake_http(
        connections,
        payload={
            "provider": "openai",
            "model": "gpt-5.5",
            "deployment": "direct",
            "credential_mode": "env",
            "env": {"OPENAI_API_KEY": "sk-prod"},
        },
    )
    await VaultConnectionResolver(connection).resolve(
        model=_model(), context=_context()
    )
    assert INTERNAL_RESOLVE_TOKEN_HEADER not in capture["headers"]


async def test_resolve_without_api_base_fails_loud(fake_http):
    # No backend configured: fail loud, never silently run with no credential.
    with pytest.raises(ConnectionResolutionError):
        await VaultConnectionResolver(PlatformConnection()).resolve(
            model=_model(), context=_context()
        )
