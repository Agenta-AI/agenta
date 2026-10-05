"""The streaming transport prefers the runner pod that ran the session's last turn.

With a ``runner_address`` the ``/run`` post goes to that pod, so a follow-up reaches the pod
that holds the warm session. Without one it goes to the Service URL. The transport falls back
to the Service URL once, and only when the pod could not have taken the prompt: no connection,
or a 503 from a draining pod. A failure after the response began is final, because a prompt
must never be sent twice.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import httpx
import pytest

from agenta.sdk.agents.adapters import SandboxAgentBackend
from agenta.sdk.agents.adapters.sandbox_agent import SandboxAgentSandbox
from agenta.sdk.agents.dtos import HarnessKind
from agenta.sdk.agents.utils import ts_runner
from agenta.sdk.agents.utils.ts_runner import deliver_http_stream

SERVICE_URL = "http://agenta-runner:8765"
POD_ADDRESS = "http://10.8.2.17:8765"
RESULT = {"kind": "result", "result": {"ok": True}}


class _Outcome:
    """What one ``POST /run`` answers: an error before the response, or a status and lines.

    A line may be an exception, raised after the lines before it were read.
    """

    def __init__(
        self,
        *,
        raises: Optional[BaseException] = None,
        status_code: int = 200,
        lines: Optional[List[Any]] = None,
    ) -> None:
        self.raises = raises
        self.status_code = status_code
        self.lines = lines if lines is not None else [json.dumps(RESULT)]


def _client(outcomes: Dict[str, _Outcome], posts: List[Dict[str, Any]]):
    class _Stream:
        def __init__(self, outcome: _Outcome) -> None:
            self._outcome = outcome
            self.status_code = outcome.status_code
            self.closed = False

        async def __aenter__(self):
            if self._outcome.raises is not None:
                raise self._outcome.raises
            return self

        async def __aexit__(self, *args):
            self.closed = True
            return False

        async def aiter_lines(self):
            for line in self._outcome.lines:
                if isinstance(line, BaseException):
                    raise line
                yield line

        async def aread(self) -> bytes:
            return b"draining"

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url, json=None, headers=None, timeout=None):
            stream = _Stream(outcomes[url])
            posts.append(
                {
                    "url": url,
                    "timeout": timeout,
                    "json": json,
                    "stream": stream,
                    # Earlier responses still open when this post went out.
                    "open_before": [p["url"] for p in posts if not p["stream"].closed],
                }
            )
            return stream

    return _Client


@pytest.fixture
def runner(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", "tok")

    def _install(outcomes: Dict[str, _Outcome]) -> List[Dict[str, Any]]:
        posts: List[Dict[str, Any]] = []
        monkeypatch.setattr(httpx, "AsyncClient", _client(outcomes, posts))
        return posts

    return _install


async def _drain(runner_address: Optional[str]) -> List[Dict[str, Any]]:
    return [
        record
        async for record in deliver_http_stream(
            SERVICE_URL, {"harness": "pi_core"}, runner_address=runner_address
        )
    ]


def _urls(posts: List[Dict[str, Any]]) -> List[str]:
    return [post["url"] for post in posts]


async def test_an_address_takes_the_post(runner):
    posts = runner({f"{POD_ADDRESS}/run": _Outcome()})

    assert await _drain(POD_ADDRESS) == [RESULT]
    assert _urls(posts) == [f"{POD_ADDRESS}/run"]
    # The pod gets a short connect bound; the idle bound of the stream is unchanged.
    timeout = posts[0]["timeout"]
    assert timeout.connect == ts_runner._RUNNER_ADDRESS_CONNECT_TIMEOUT
    assert timeout.read == ts_runner.RUNNER_TIMEOUT_SECONDS


@pytest.mark.parametrize("runner_address", [None, ""], ids=["none", "empty"])
async def test_no_address_posts_to_the_service_url(runner, runner_address):
    posts = runner({f"{SERVICE_URL}/run": _Outcome()})

    assert await _drain(runner_address) == [RESULT]
    assert _urls(posts) == [f"{SERVICE_URL}/run"]


@pytest.mark.parametrize(
    "error",
    [
        httpx.ConnectError("[Errno 111] Connection refused"),
        httpx.ConnectError("[Errno -2] Name or service not known"),
        httpx.ConnectTimeout("timed out"),
        httpx.UnsupportedProtocol("Request URL is missing an 'http://' protocol."),
        httpx.InvalidURL("Invalid port"),
    ],
    ids=["refused", "dns", "connect-timeout", "unsupported-protocol", "invalid-url"],
)
async def test_an_unreachable_pod_falls_back_once_to_the_service_url(runner, error):
    posts = runner(
        {
            f"{POD_ADDRESS}/run": _Outcome(raises=error),
            f"{SERVICE_URL}/run": _Outcome(),
        }
    )

    assert await _drain(POD_ADDRESS) == [RESULT]
    assert _urls(posts) == [f"{POD_ADDRESS}/run", f"{SERVICE_URL}/run"]
    # The same prompt goes to the Service URL, with the Service URL's own timeouts.
    assert posts[0]["json"] == posts[1]["json"]
    assert posts[1]["timeout"] is None


async def test_a_draining_pod_falls_back_once_to_the_service_url(runner):
    draining_line = json.dumps({"kind": "result", "result": {"ok": False}})
    posts = runner(
        {
            f"{POD_ADDRESS}/run": _Outcome(status_code=503, lines=[draining_line]),
            f"{SERVICE_URL}/run": _Outcome(),
        }
    )

    # Only the Service URL's records reach the caller; the 503 body is never read.
    assert await _drain(POD_ADDRESS) == [RESULT]
    assert _urls(posts) == [f"{POD_ADDRESS}/run", f"{SERVICE_URL}/run"]
    # The 503 response was closed before the second post went out.
    assert posts[1]["open_before"] == []
    assert posts[0]["stream"].closed


async def test_the_fallback_is_tried_only_once(runner):
    posts = runner(
        {
            f"{POD_ADDRESS}/run": _Outcome(raises=httpx.ConnectError("refused")),
            f"{SERVICE_URL}/run": _Outcome(raises=httpx.ConnectError("refused")),
        }
    )

    with pytest.raises(httpx.ConnectError):
        await _drain(POD_ADDRESS)
    assert _urls(posts) == [f"{POD_ADDRESS}/run", f"{SERVICE_URL}/run"]


async def test_a_failure_after_the_first_byte_is_not_retried(runner):
    posts = runner(
        {
            f"{POD_ADDRESS}/run": _Outcome(
                lines=[
                    json.dumps({"kind": "event", "event": {"type": "message"}}),
                    httpx.ReadError("connection reset"),
                ]
            ),
            f"{SERVICE_URL}/run": _Outcome(),
        }
    )

    received: List[Dict[str, Any]] = []
    with pytest.raises(httpx.ReadError):
        async for record in deliver_http_stream(
            SERVICE_URL, {"harness": "pi_core"}, runner_address=POD_ADDRESS
        ):
            received.append(record)

    assert received == [{"kind": "event", "event": {"type": "message"}}]
    assert _urls(posts) == [f"{POD_ADDRESS}/run"]


async def test_a_read_timeout_before_any_line_is_not_retried(runner):
    """The pod accepted the connection and may hold the prompt; only a connect error is safe."""
    posts = runner(
        {
            f"{POD_ADDRESS}/run": _Outcome(raises=httpx.ReadTimeout("no response")),
            f"{SERVICE_URL}/run": _Outcome(),
        }
    )

    with pytest.raises(httpx.ReadTimeout):
        await _drain(POD_ADDRESS)
    assert _urls(posts) == [f"{POD_ADDRESS}/run"]


@pytest.mark.parametrize("status_code", [400, 404, 500, 502])
async def test_other_errors_from_the_pod_are_not_retried(runner, status_code):
    posts = runner(
        {
            f"{POD_ADDRESS}/run": _Outcome(status_code=status_code, lines=[]),
            f"{SERVICE_URL}/run": _Outcome(),
        }
    )

    with pytest.raises(RuntimeError, match=f"Agent runner HTTP {status_code}"):
        await _drain(POD_ADDRESS)
    assert _urls(posts) == [f"{POD_ADDRESS}/run"]


async def test_a_503_from_the_service_url_is_not_retried(runner):
    posts = runner({f"{SERVICE_URL}/run": _Outcome(status_code=503, lines=[])})

    with pytest.raises(RuntimeError, match="Agent runner HTTP 503"):
        await _drain(None)
    assert _urls(posts) == [f"{SERVICE_URL}/run"]


async def test_the_backend_keeps_its_service_url_and_takes_the_address_per_turn(
    monkeypatch,
):
    """The Service URL is fixed at construction; each session carries its own turn's pod."""
    calls: List[Dict[str, Any]] = []

    async def _fake_stream(base_url, payload, *, timeout, runner_address=None):
        calls.append({"base_url": base_url, "runner_address": runner_address})
        yield RESULT

    monkeypatch.setattr(
        "agenta.sdk.agents.adapters.sandbox_agent.deliver_http_stream", _fake_stream
    )
    backend = SandboxAgentBackend(sandbox="local", url=SERVICE_URL)

    for address in (POD_ADDRESS, None):
        session = await backend.create_session(
            SandboxAgentSandbox("local"),
            None,
            harness=HarnessKind.PI,
            runner_address=address,
        )
        monkeypatch.setattr(session, "_wire_payload", lambda messages: {})
        async for _ in session.stream([]):
            pass

    assert calls == [
        {"base_url": SERVICE_URL, "runner_address": POD_ADDRESS},
        {"base_url": SERVICE_URL, "runner_address": None},
    ]
    assert backend._url == SERVICE_URL
