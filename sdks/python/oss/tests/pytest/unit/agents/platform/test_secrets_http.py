"""Named-secret resolution against a mocked vault."""

from __future__ import annotations

from agenta.sdk.agents.platform import PlatformConnection, resolve_named_secrets
from agenta.sdk.agents.platform import secrets


# --- named secrets (GET /secrets/{slug}) -----------------------------------


async def test_named_secrets_are_resolved(fake_http, connection):
    capture = fake_http(
        secrets,
        payload={
            "kind": "custom_secret",
            "slug": "TOKEN",
            "data": {"secret": {"format": "text", "content": "value"}},
        },
    )
    resolved = await resolve_named_secrets(["TOKEN"], connection=connection)
    assert resolved == {"TOKEN": "value"}
    assert capture == {
        "method": "GET",
        "url": "https://api.x/api/secrets/TOKEN",
        "headers": {
            "Content-Type": "application/json",
            "Authorization": "Access tok",
        },
    }


async def test_named_secret_slug_is_url_encoded(fake_http, connection):
    capture = fake_http(
        secrets,
        payload={
            "kind": "custom_secret",
            "data": {"secret": {"format": "text", "content": "value"}},
        },
    )
    assert await resolve_named_secrets(["TOKEN/name"], connection=connection) == {
        "TOKEN/name": "value"
    }
    assert capture["url"] == "https://api.x/api/secrets/TOKEN%2Fname"


async def test_named_secrets_reject_non_text_values(fake_http, connection):
    fake_http(
        secrets,
        payload={
            "kind": "custom_secret",
            "data": {"secret": {"format": "json", "content": {"TOKEN": "value"}}},
        },
    )
    assert await resolve_named_secrets(["TOKEN"], connection=connection) == {}


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
