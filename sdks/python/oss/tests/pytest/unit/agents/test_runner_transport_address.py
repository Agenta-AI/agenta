"""The streaming transport prefers the runner pod that ran the session's last turn.

With a ``runner_address`` the ``/run`` post goes to that pod, so a follow-up reaches the pod
that holds the warm session. Without one it goes to the Service URL.

Kubernetes can give a dead pod's IP to another pod, and the ``/run`` post carries the runner
token and provider credentials. So the transport first asks the pod at the address for its
replica id on ``GET /health`` and uses the address only when the id equals
``runner_replica_id``. Any other answer, or no id to compare, sends the post to the Service URL.

The transport falls back to the Service URL once, and only when the pod could not have taken
the prompt: no connection, a 503 from a draining pod, or a 429 from a pod at its limit. A
failure after the response began is final, because a prompt must never be sent twice.
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
POD_REPLICA_ID = "agenta-runner-6f9c7d5b8-aaaaa"
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


class _Health:
    """What one ``GET /health`` answers: an error, or a status and a replica id."""

    def __init__(
        self,
        *,
        replica_id: Any = POD_REPLICA_ID,
        status_code: int = 200,
        raises: Optional[BaseException] = None,
        json_body: bool = True,
    ) -> None:
        self.replica_id = replica_id
        self.status_code = status_code
        self.raises = raises
        self.json_body = json_body


class _Calls(list):
    """The ``/run`` posts in order. ``gets`` holds the health checks."""

    def __init__(self) -> None:
        super().__init__()
        self.gets: List[Dict[str, Any]] = []


def _client(outcomes: Dict[str, _Outcome], health: Dict[str, _Health], calls: _Calls):
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

    class _HealthResponse:
        def __init__(self, answer: _Health) -> None:
            self.status_code = answer.status_code
            self._answer = answer

        def json(self):
            if self.status_code != 200 or not self._answer.json_body:
                raise ValueError("not JSON")
            return {"status": "ok", "replicaId": self._answer.replica_id}

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, timeout=None, headers=None):
            calls.gets.append({"url": url, "timeout": timeout, "headers": headers})
            answer = health[url]
            if answer.raises is not None:
                raise answer.raises
            return _HealthResponse(answer)

        def stream(self, method, url, json=None, headers=None, timeout=None):
            stream = _Stream(outcomes[url])
            calls.append(
                {
                    "url": url,
                    "timeout": timeout,
                    "json": json,
                    "stream": stream,
                    # Earlier responses still open when this post went out.
                    "open_before": [p["url"] for p in calls if not p["stream"].closed],
                }
            )
            return stream

    return _Client


@pytest.fixture
def runner(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", "tok")

    def _install(
        outcomes: Dict[str, _Outcome], health: Optional[_Health] = None
    ) -> _Calls:
        calls = _Calls()
        answers = {f"{POD_ADDRESS}/health": health or _Health()}
        monkeypatch.setattr(httpx, "AsyncClient", _client(outcomes, answers, calls))
        return calls

    return _install


async def _drain(
    runner_address: Optional[str], runner_replica_id: Optional[str] = POD_REPLICA_ID
) -> List[Dict[str, Any]]:
    return [
        record
        async for record in deliver_http_stream(
            SERVICE_URL,
            {"harness": "pi_core"},
            runner_address=runner_address,
            runner_replica_id=runner_replica_id,
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


async def test_the_pod_identity_is_checked_first_with_no_token_and_a_short_bound(
    runner,
):
    posts = runner({f"{POD_ADDRESS}/run": _Outcome()})

    await _drain(POD_ADDRESS)

    assert posts.gets == [
        {"url": f"{POD_ADDRESS}/health", "timeout": 2.0, "headers": None}
    ]
    assert ts_runner._RUNNER_ADDRESS_CONNECT_TIMEOUT == 2.0
    assert posts[0]["timeout"].connect == 2.0


@pytest.mark.parametrize("runner_address", [None, ""], ids=["none", "empty"])
async def test_no_address_posts_to_the_service_url(runner, runner_address):
    posts = runner({f"{SERVICE_URL}/run": _Outcome()})

    assert await _drain(runner_address) == [RESULT]
    assert _urls(posts) == [f"{SERVICE_URL}/run"]
    assert posts.gets == []


@pytest.mark.parametrize(
    "health",
    [
        _Health(replica_id="agenta-runner-6f9c7d5b8-bbbbb"),
        _Health(replica_id=None),
        _Health(status_code=404),
        _Health(raises=httpx.ConnectError("[Errno 111] Connection refused")),
        _Health(raises=httpx.ConnectTimeout("timed out")),
        _Health(raises=httpx.ReadTimeout("no answer")),
        _Health(json_body=False),
        _Health(raises=httpx.InvalidURL("Invalid IPv6 URL")),
    ],
    ids=[
        "another-replica",
        "no-id-in-the-answer",
        "not-a-runner",
        "refused",
        "connect-timeout",
        "read-timeout",
        "not-json",
        "invalid-url",
    ],
)
async def test_a_pod_that_is_not_the_bound_replica_never_sees_the_post(runner, health):
    posts = runner(
        {
            f"{POD_ADDRESS}/run": _Outcome(),
            f"{SERVICE_URL}/run": _Outcome(),
        },
        health,
    )

    assert await _drain(POD_ADDRESS) == [RESULT]
    assert _urls(posts) == [f"{SERVICE_URL}/run"]
    assert posts[0]["timeout"] is None, "the Service URL keeps its own timeouts"


@pytest.mark.parametrize("runner_replica_id", [None, ""], ids=["none", "empty"])
async def test_an_address_with_no_replica_id_is_not_used(runner, runner_replica_id):
    posts = runner(
        {
            f"{POD_ADDRESS}/run": _Outcome(),
            f"{SERVICE_URL}/run": _Outcome(),
        }
    )

    assert await _drain(POD_ADDRESS, runner_replica_id) == [RESULT]
    assert _urls(posts) == [f"{SERVICE_URL}/run"]
    assert posts.gets == [], "with nothing to compare there is nothing to ask"


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


@pytest.mark.parametrize("status_code", [503, 429], ids=["draining", "busy"])
async def test_a_pod_that_did_not_take_the_run_falls_back_once(runner, status_code):
    refused_line = json.dumps({"kind": "result", "result": {"ok": False}})
    posts = runner(
        {
            f"{POD_ADDRESS}/run": _Outcome(
                status_code=status_code, lines=[refused_line]
            ),
            f"{SERVICE_URL}/run": _Outcome(),
        }
    )

    # Only the Service URL's records reach the caller; the refusal body is never read.
    assert await _drain(POD_ADDRESS) == [RESULT]
    assert _urls(posts) == [f"{POD_ADDRESS}/run", f"{SERVICE_URL}/run"]
    # The refused response was closed before the second post went out.
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
            SERVICE_URL,
            {"harness": "pi_core"},
            runner_address=POD_ADDRESS,
            runner_replica_id=POD_REPLICA_ID,
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


@pytest.mark.parametrize("status_code", [503, 429])
async def test_a_refusal_from_the_service_url_is_not_retried(runner, status_code):
    posts = runner({f"{SERVICE_URL}/run": _Outcome(status_code=status_code, lines=[])})

    with pytest.raises(RuntimeError, match=f"Agent runner HTTP {status_code}"):
        await _drain(None)
    assert _urls(posts) == [f"{SERVICE_URL}/run"]


async def test_the_backend_keeps_its_service_url_and_takes_the_address_per_turn(
    monkeypatch,
):
    """The Service URL is fixed at construction; each session carries its own turn's pod."""
    calls: List[Dict[str, Any]] = []

    async def _fake_stream(
        base_url, payload, *, timeout, runner_address=None, runner_replica_id=None
    ):
        calls.append(
            {
                "base_url": base_url,
                "runner_address": runner_address,
                "runner_replica_id": runner_replica_id,
            }
        )
        yield RESULT

    monkeypatch.setattr(
        "agenta.sdk.agents.adapters.sandbox_agent.deliver_http_stream", _fake_stream
    )
    backend = SandboxAgentBackend(sandbox="local", url=SERVICE_URL)

    for address, replica_id in ((POD_ADDRESS, POD_REPLICA_ID), (None, None)):
        session = await backend.create_session(
            SandboxAgentSandbox("local"),
            None,
            harness=HarnessKind.PI,
            runner_address=address,
            runner_replica_id=replica_id,
        )
        monkeypatch.setattr(session, "_wire_payload", lambda messages: {})
        async for _ in session.stream([]):
            pass

    assert calls == [
        {
            "base_url": SERVICE_URL,
            "runner_address": POD_ADDRESS,
            "runner_replica_id": POD_REPLICA_ID,
        },
        {"base_url": SERVICE_URL, "runner_address": None, "runner_replica_id": None},
    ]
    assert backend._url == SERVICE_URL
