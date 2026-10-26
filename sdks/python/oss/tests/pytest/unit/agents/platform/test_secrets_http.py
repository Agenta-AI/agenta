"""Named-secret resolution against a mocked vault."""

from __future__ import annotations

import asyncio

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


def _secret(content: str) -> dict:
    return {
        "kind": "custom_secret",
        "data": {"secret": {"format": "text", "content": content}},
    }


def _routed_client(handle):
    """An AsyncClient stand-in whose ``get`` answers per slug through ``handle``."""

    class _Response:
        def __init__(self, status_code, payload):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, headers=None):
            status_code, payload = await handle(url.rsplit("/", 1)[-1])
            return _Response(status_code, payload)

    return _Client


async def test_named_secrets_are_read_together_and_keep_request_order(
    monkeypatch, connection
):
    last_started = asyncio.Event()

    async def _handle(slug):
        if slug == "FIRST":
            # Answers only once the last read is in flight, so a serial loop times out.
            await asyncio.wait_for(last_started.wait(), timeout=1)
        if slug == "THIRD":
            last_started.set()
        return 200, _secret(slug.lower())

    monkeypatch.setattr(secrets.httpx, "AsyncClient", _routed_client(_handle))
    resolved = await resolve_named_secrets(
        ["FIRST", "SECOND", "FIRST", "THIRD"], connection=connection
    )
    assert list(resolved.items()) == [
        ("FIRST", "first"),
        ("SECOND", "second"),
        ("THIRD", "third"),
    ]


async def test_one_failed_named_secret_read_leaves_the_others_resolved(
    monkeypatch, connection
):
    async def _handle(slug):
        if slug == "BROKEN":
            raise RuntimeError("connection reset")
        if slug == "ABSENT":
            return 404, {"detail": "Secret not found"}
        return 200, _secret(slug.lower())

    monkeypatch.setattr(secrets.httpx, "AsyncClient", _routed_client(_handle))
    resolved = await resolve_named_secrets(
        ["OK", "BROKEN", "ABSENT", "ALSO"], connection=connection
    )
    assert resolved == {"OK": "ok", "ALSO": "also"}
