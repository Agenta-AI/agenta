"""Named-secret and provider-key resolution against a mocked vault."""

from __future__ import annotations

from agenta.sdk.agents.platform import (
    PlatformConnection,
    resolve_named_secrets,
    resolve_provider_keys,
)
from agenta.sdk.agents.platform import secrets


# --- named secrets (POST /secrets/resolve) ---------------------------------


async def test_named_secrets_are_resolved(fake_http, connection):
    capture = fake_http(
        secrets,
        payload={"secrets": {"TOKEN": "value", "EMPTY": None}},
    )
    resolved = await resolve_named_secrets(
        ["TOKEN", "EMPTY", "MISSING"], connection=connection
    )
    assert resolved == {"TOKEN": "value"}
    assert capture == {
        "method": "POST",
        "url": "https://api.x/api/secrets/resolve",
        "json": {"names": ["TOKEN", "EMPTY", "MISSING"]},
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Access tok",
        },
    }


async def test_named_secrets_restrict_to_requested(fake_http, connection):
    # An upstream that returns extras must not leak unrequested secrets into memory.
    fake_http(
        secrets,
        payload={"secrets": {"TOKEN": "value", "UNREQUESTED": "leak"}},
    )
    resolved = await resolve_named_secrets(["TOKEN"], connection=connection)
    assert resolved == {"TOKEN": "value"}


async def test_named_secrets_without_api_base_return_empty(fake_http):
    capture = fake_http(secrets)
    assert await resolve_named_secrets(["TOKEN"], connection=PlatformConnection()) == {}
    assert capture == {}  # short-circuits before any HTTP


async def test_named_secret_http_failure_returns_empty(fake_http, connection):
    fake_http(secrets, status=500)
    assert await resolve_named_secrets(["TOKEN"], connection=connection) == {}


async def test_no_names_short_circuits(fake_http, connection):
    capture = fake_http(secrets)
    assert await resolve_named_secrets([], connection=connection) == {}
    assert capture == {}


# --- provider keys (GET /secrets/) -----------------------------------------


async def test_provider_keys_without_api_base_return_empty(fake_http):
    assert await resolve_provider_keys(connection=PlatformConnection()) == {}


async def test_provider_keys_map_only_provider_keys_with_dedupe(fake_http, connection):
    fake_http(
        secrets,
        payload=[
            {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": "sk-1"}},
            },
            # duplicate env var -> first one wins (setdefault).
            {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": "sk-2"}},
            },
            {
                "kind": "provider_key",
                "data": {"kind": "anthropic", "provider": {"key": "sk-ant"}},
            },
            # not a provider key -> ignored.
            {"kind": "other", "data": {"kind": "openai", "provider": {"key": "x"}}},
            # unmapped provider -> ignored.
            {
                "kind": "provider_key",
                "data": {"kind": "made_up", "provider": {"key": "y"}},
            },
            # missing key -> ignored.
            {"kind": "provider_key", "data": {"kind": "groq", "provider": {}}},
        ],
    )
    env = await resolve_provider_keys(connection=connection)
    assert env == {"OPENAI_API_KEY": "sk-1", "ANTHROPIC_API_KEY": "sk-ant"}


async def test_provider_keys_http_error_returns_empty(fake_http, connection):
    fake_http(secrets, status=400)
    assert await resolve_provider_keys(connection=connection) == {}


async def test_provider_keys_network_exception_returns_empty(fake_http, connection):
    fake_http(secrets, raises=RuntimeError("network down"))
    assert await resolve_provider_keys(connection=connection) == {}
