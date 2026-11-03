"""Integration fixtures: a fake httpx client for the tool/secret resolvers.

These tests wire the real resolver code against a mocked HTTP boundary (no live backend, no
respx/pytest-httpx dependency). ``install_http`` patches the two ``PlatformConnection`` helpers
(``_derive_base_url`` / ``_derive_authorization`` in the SDK platform connection module) plus
``httpx.AsyncClient`` in the given SDK platform module that performs the HTTP, and returns a
``capture`` dict the test can assert the outgoing request against.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, Optional

import pytest

from agenta.sdk.agents.platform import connection as platform_connection


class _FakeResponse:
    def __init__(self, status_code: int, payload: Any, text: Optional[str]) -> None:
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text if text is not None else json.dumps(self._payload)

    def json(self) -> Any:
        return self._payload


def _fake_async_client(*, make_response, raises, capture: Dict[str, Any]):
    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, url, json=None, headers=None):
            capture.update(method="POST", url=url, json=json, headers=headers)
            if raises:
                raise raises
            return make_response(json)

        async def get(self, url, headers=None):
            capture.update(method="GET", url=url, headers=headers)
            if raises:
                raise raises
            return make_response(None)

    return _Client


@pytest.fixture
def install_http(monkeypatch):
    def _install(
        module,
        *,
        status: int = 200,
        payload: Any = None,
        text: Optional[str] = None,
        raises: Optional[BaseException] = None,
        responder: Optional[Callable[[Any], Any]] = None,
        api_base: Optional[str] = "https://api.x/api",
        authorization: Optional[str] = "Access tok",
    ) -> Dict[str, Any]:
        capture: Dict[str, Any] = {}
        monkeypatch.setattr(platform_connection, "_derive_base_url", lambda: api_base)
        monkeypatch.setattr(
            platform_connection, "_derive_authorization", lambda: authorization
        )

        def make_response(request_json):
            # Tools now resolve one per HTTP call, so a test can vary the response by request
            # via ``responder`` (which receives the outgoing request body). Without one, the
            # single static ``payload`` is returned for every call, as before. A responder may
            # return a ``(status, payload)`` tuple to control the per-call status (e.g. a 404 for
            # one tool and a 200 for the next), or a bare payload to reuse the default ``status``.
            if responder is not None:
                result = responder(request_json)
                if isinstance(result, tuple):
                    call_status, call_payload = result
                    return _FakeResponse(call_status, call_payload, text)
                return _FakeResponse(status, result, text)
            return _FakeResponse(status, payload, text)

        monkeypatch.setattr(
            module.httpx,
            "AsyncClient",
            _fake_async_client(
                make_response=make_response, raises=raises, capture=capture
            ),
        )
        return capture

    return _install
