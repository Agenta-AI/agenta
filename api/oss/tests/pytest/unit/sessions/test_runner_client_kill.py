"""WP7 (W7.3): `kill_runner_sandbox`'s own contract — the direct API -> runner `/kill` hop.

Covers: not configured -> no-op False; success -> True with the right URL/body/headers;
non-2xx -> False; a transport exception -> False (never raises).
"""

from unittest.mock import patch

import httpx
import pytest

from oss.src.core.sessions.streams.runner_client import kill_runner_sandbox


class _FakeRunnerEnv:
    def __init__(self, internal_url=None, token=None):
        self.internal_url = internal_url
        self.token = token


@pytest.mark.asyncio
async def test_returns_false_when_not_configured():
    with patch("oss.src.core.sessions.streams.runner_client.env") as mock_env:
        mock_env.runner = _FakeRunnerEnv(internal_url=None, token=None)
        result = await kill_runner_sandbox(project_id="proj-1", session_id="sess-1")

    assert result is False


@pytest.mark.asyncio
async def test_posts_to_kill_with_scoped_body_and_bearer_header():
    captured = {}

    class _FakeResponse:
        status_code = 200

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return _FakeResponse()

    with (
        patch("oss.src.core.sessions.streams.runner_client.env") as mock_env,
        patch(
            "oss.src.core.sessions.streams.runner_client.httpx.AsyncClient",
            return_value=_FakeClient(),
        ),
    ):
        mock_env.runner = _FakeRunnerEnv(
            internal_url="http://runner:8765", token="shared-secret"
        )
        result = await kill_runner_sandbox(project_id="proj-1", session_id="sess-1")

    assert result is True
    assert captured["url"] == "http://runner:8765/kill"
    assert captured["json"] == {"sessionId": "sess-1", "projectId": "proj-1"}
    assert captured["headers"]["Authorization"] == "Bearer shared-secret"


@pytest.mark.asyncio
async def test_returns_false_on_non_2xx():
    class _FakeResponse:
        status_code = 500

    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, *a, **kw):
            return _FakeResponse()

    with (
        patch("oss.src.core.sessions.streams.runner_client.env") as mock_env,
        patch(
            "oss.src.core.sessions.streams.runner_client.httpx.AsyncClient",
            return_value=_FakeClient(),
        ),
    ):
        mock_env.runner = _FakeRunnerEnv(
            internal_url="http://runner:8765", token="shared-secret"
        )
        result = await kill_runner_sandbox(project_id="proj-1", session_id="sess-1")

    assert result is False


@pytest.mark.asyncio
async def test_returns_false_on_transport_error_never_raises():
    class _FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, *a, **kw):
            raise httpx.ConnectError("connection refused")

    with (
        patch("oss.src.core.sessions.streams.runner_client.env") as mock_env,
        patch(
            "oss.src.core.sessions.streams.runner_client.httpx.AsyncClient",
            return_value=_FakeClient(),
        ),
    ):
        mock_env.runner = _FakeRunnerEnv(
            internal_url="http://runner:8765", token="shared-secret"
        )
        result = await kill_runner_sandbox(project_id="proj-1", session_id="sess-1")

    assert result is False
