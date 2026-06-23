"""Fixtures for the platform-adapter tests: a fake httpx client and a pinned connection.

These tests exercise the real adapter code against a mocked HTTP boundary (no live backend,
no respx/pytest-httpx dependency). ``fake_http`` patches ``httpx.AsyncClient`` on a given
adapter module and returns a ``capture`` dict the test asserts the outgoing request against.
The base URL and authorization are supplied by injecting a :class:`PlatformConnection`, not
by patching module globals, which is the adapter's real seam.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

import pytest

from agenta.sdk.agents.platform import PlatformConnection

_ENV_VARS = (
    "AGENTA_AGENT_TOOLS_TIMEOUT",
    "AGENTA_AGENT_TOOLS_API_URL",
    "AGENTA_API_URL",
    "AGENTA_API_KEY",
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """No ambient config leaks in, so an unset connection truly resolves to ``None``."""
    for name in _ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(
        "agenta.sdk.engines.tracing.propagation.inject",
        lambda carrier: carrier,
    )


@pytest.fixture
def connection() -> PlatformConnection:
    """A connection pinned to a fake backend with an explicit caller credential."""
    return PlatformConnection(base_url="https://api.x/api", authorization="Access tok")


class _FakeResponse:
    def __init__(self, status_code: int, payload: Any, text: Optional[str]) -> None:
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text if text is not None else json.dumps(self._payload)

    def json(self) -> Any:
        return self._payload


def _fake_async_client(*, response, raises, capture: Dict[str, Any]):
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
            return response

        async def get(self, url, headers=None):
            capture.update(method="GET", url=url, headers=headers)
            if raises:
                raise raises
            return response

    return _Client


@pytest.fixture
def fake_http(monkeypatch):
    def _install(
        module,
        *,
        status: int = 200,
        payload: Any = None,
        text: Optional[str] = None,
        raises: Optional[BaseException] = None,
    ) -> Dict[str, Any]:
        capture: Dict[str, Any] = {}
        response = _FakeResponse(status, payload, text)
        monkeypatch.setattr(
            module.httpx,
            "AsyncClient",
            _fake_async_client(response=response, raises=raises, capture=capture),
        )
        return capture

    return _install
