"""Unit tests for `MCPServerProbe`.

`httpx.MockTransport` stands in for both the MCP server and its authorization server, the
same way `test_gateways_mcp_oauth_client.py` and `test_gateways_http_mcp_adapter.py` do.
The directory conftest stubs DNS to one public address, so the egress guard runs for real
against a deterministic answer.

The probe is the first thing a person's typed URL touches, so two properties are asserted
throughout rather than once: it sends no credential, and it sends no tool call.
"""

from __future__ import annotations

import asyncio
import gzip
import json
import time

import httpx
import pytest

from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.probe import (
    MCPProbeAuthMode,
    MCPProbeRegistration,
    MCPServerProbe,
)

_SERVER_URL = "https://mcp.acme.io/"

_PRM = {
    "resource": _SERVER_URL,
    "authorization_servers": ["https://auth.acme.io/"],
    "scopes_supported": ["tools:list", "tools:call"],
}
_AS_METADATA = {
    "issuer": "https://auth.acme.io/",
    "authorization_endpoint": "https://auth.acme.io/authorize",
    "token_endpoint": "https://auth.acme.io/token",
    "scopes_supported": ["tools:list", "tools:call"],
}

_INITIALIZE_RESULT = {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
        "protocolVersion": "2025-06-18",
        "capabilities": {"tools": {}},
        "serverInfo": {"name": "Acme Tools", "version": "3.1"},
    },
}


@pytest.fixture(autouse=True)
def _secure_egress(monkeypatch):
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)


@pytest.fixture(autouse=True)
def _empty_host_allowlist(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.env.mcp_gateway.host_allowlist",
        [],
    )


def _resolves_publicly(answer: bool):
    """The address check, answering without a resolver. It is a coroutine now, because
    the lookup it wraps is blocking and runs in a thread (M18)."""

    async def _answer(_api_url: str) -> bool:
        return answer

    return _answer


def _probe(handler, *, api_url: str = "https://agenta.example/api") -> MCPServerProbe:
    transport = httpx.MockTransport(handler)
    return MCPServerProbe(
        oauth_client=MCPOAuthClient(transport=transport),
        api_url=api_url,
        transport=transport,
    )


def _open_server(requests: list[httpx.Request] | None = None):
    """An MCP server that answers the handshake to anyone."""

    def handler(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request)
        return httpx.Response(200, json=_INITIALIZE_RESULT)

    return handler


def _protected_server(
    *,
    registration_endpoint: str | None = None,
    metadata_status: int = 200,
    requests: list[httpx.Request] | None = None,
):
    """A server that refuses the anonymous handshake and publishes where to authorize."""
    metadata = dict(_AS_METADATA)
    if registration_endpoint:
        metadata["registration_endpoint"] = registration_endpoint

    def handler(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request)
        path = request.url.path
        if path == "/.well-known/oauth-protected-resource":
            return httpx.Response(metadata_status, json=_PRM)
        if path == "/.well-known/oauth-authorization-server":
            return httpx.Response(metadata_status, json=metadata)
        return httpx.Response(
            401,
            json={"error": "invalid_token"},
            headers={
                "WWW-Authenticate": (
                    "Bearer resource_metadata="
                    '"https://mcp.acme.io/.well-known/oauth-protected-resource"'
                )
            },
        )

    return handler


# ---------------------------------------------------------------------------
# What the probe sends
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_the_probe_handshakes_and_never_calls_a_tool():
    requests: list[httpx.Request] = []

    await _probe(_open_server(requests)).probe(server_url=_SERVER_URL)

    posted = [r for r in requests if r.method == "POST"]
    assert len(posted) == 1
    body = json.loads(posted[0].content)
    assert body["method"] == "initialize"
    assert "tools/call" not in posted[0].content.decode()


@pytest.mark.asyncio
async def test_the_probe_sends_no_credential():
    requests: list[httpx.Request] = []

    await _probe(_open_server(requests)).probe(server_url=_SERVER_URL)

    for request in requests:
        assert "authorization" not in {k.lower() for k in request.headers}
        assert "cookie" not in {k.lower() for k in request.headers}
        assert "x-ag-credentials" not in {k.lower() for k in request.headers}


# ---------------------------------------------------------------------------
# What the probe reports
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_open_server_reports_its_name_and_needs_no_authentication():
    result = await _probe(_open_server()).probe(server_url=_SERVER_URL)

    assert result.reachable is True
    assert result.server_name == "Acme Tools"
    assert result.protocol_version == "2025-06-18"
    assert result.auth.mode is MCPProbeAuthMode.NONE
    assert result.problem is None


@pytest.mark.asyncio
async def test_a_handshake_framed_as_one_sse_event_is_still_read():
    """Streamable HTTP servers may answer the handshake as an event stream."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=f"event: message\ndata: {json.dumps(_INITIALIZE_RESULT)}\n\n".encode(),
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.server_name == "Acme Tools"
    assert result.auth.mode is MCPProbeAuthMode.NONE


@pytest.mark.asyncio
async def test_a_handshake_behind_a_notification_is_still_read():
    """D63. The transport lets a server send notifications before the response to a request.

    The probe is the third client speaking this wire, after the Pi extension and the browser.
    Reading the last `data:` line happened to survive a notification sent FIRST and would have
    failed on one sent after, so all three now select the last frame carrying a result or error.
    """
    notification = json.dumps(
        {"jsonrpc": "2.0", "method": "notifications/message", "params": {"level": "info"}}
    )

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=(
                f"event: message\ndata: {notification}\n\n"
                f"event: message\ndata: {json.dumps(_INITIALIZE_RESULT)}\n\n"
                f"event: message\ndata: {notification}\n\n"
            ).encode(),
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.reachable is True
    assert result.server_name == "Acme Tools"
    assert result.auth.mode is MCPProbeAuthMode.NONE


@pytest.mark.asyncio
async def test_a_stream_carrying_only_notifications_is_not_a_handshake():
    """Nothing answered the request, so this is not a server that shook hands."""
    notification = json.dumps({"jsonrpc": "2.0", "method": "notifications/message"})

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "text/event-stream"},
            content=f"event: message\ndata: {notification}\n\n".encode(),
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.server_name is None


@pytest.mark.asyncio
async def test_a_challenged_server_reports_oauth_and_the_scopes_it_offers():
    result = await _probe(_protected_server()).probe(server_url=_SERVER_URL)

    assert result.reachable is True
    assert result.auth.mode is MCPProbeAuthMode.OAUTH
    assert result.auth.authorization_server == "https://auth.acme.io/"
    assert result.auth.scopes_offered == ["tools:list", "tools:call"]
    assert result.problem is None


@pytest.mark.asyncio
async def test_discovery_runs_only_once_the_server_has_actually_challenged():
    """A server that answers the handshake is never asked for OAuth metadata."""
    requests: list[httpx.Request] = []

    await _probe(_open_server(requests)).probe(server_url=_SERVER_URL)

    assert not [r for r in requests if ".well-known" in r.url.path]


# ---------------------------------------------------------------------------
# What the probe refuses to guess
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_undiscoverable_challenge_is_unknown_rather_than_an_api_key():
    """A 401 is not evidence of an API key, and must not produce a key field."""
    result = await _probe(_protected_server(metadata_status=404)).probe(
        server_url=_SERVER_URL
    )

    assert result.reachable is True
    assert result.auth.mode is MCPProbeAuthMode.UNKNOWN
    assert result.problem is not None
    assert result.problem.cause == "auth_undiscoverable"
    assert "authorization" in result.problem.message.lower()


@pytest.mark.asyncio
async def test_an_address_that_answers_something_else_is_not_an_mcp_server():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, html="<html>hello</html>")

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.reachable is True
    assert result.server_name is None
    assert result.auth.mode is MCPProbeAuthMode.UNKNOWN
    assert result.problem is not None
    assert result.problem.cause == "not_an_mcp_server"


@pytest.mark.asyncio
async def test_a_server_that_does_not_answer_is_not_reachable():
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.reachable is False
    assert result.auth.mode is MCPProbeAuthMode.UNKNOWN
    assert result.problem is not None
    assert result.problem.cause == "unreachable"


# ---------------------------------------------------------------------------
# The egress boundary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_blocked_address_is_refused_before_anything_is_dialled(resolves_to):
    resolves_to("127.0.0.1")
    requests: list[httpx.Request] = []

    result = await _probe(_open_server(requests)).probe(server_url=_SERVER_URL)

    assert requests == []
    assert result.reachable is False
    assert result.problem is not None
    assert result.problem.cause == "address_refused"


@pytest.mark.asyncio
async def test_the_request_is_pinned_to_the_checked_address(resolves_to):
    resolves_to("93.184.216.34")
    requests: list[httpx.Request] = []

    await _probe(_open_server(requests)).probe(server_url=_SERVER_URL)

    posted = [r for r in requests if r.method == "POST"][0]
    assert posted.url.host == "93.184.216.34"
    assert posted.headers["Host"] == "mcp.acme.io"


# ---------------------------------------------------------------------------
# Which client identity a consent would use
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_an_issuer_offering_registration_reports_dynamic():
    result = await _probe(
        _protected_server(registration_endpoint="https://auth.acme.io/register")
    ).probe(server_url=_SERVER_URL)

    assert result.auth.registration is MCPProbeRegistration.DYNAMIC


@pytest.mark.asyncio
async def test_a_deployment_the_issuer_cannot_reach_reports_unavailable(monkeypatch):
    """Said before consent rather than discovered at the point of no return."""
    monkeypatch.setattr(
        "oss.src.core.gateways.mcps.probe.is_publicly_resolvable_async",
        _resolves_publicly(False),
    )

    result = await _probe(_protected_server()).probe(server_url=_SERVER_URL)

    assert result.auth.mode is MCPProbeAuthMode.OAUTH
    assert result.auth.registration is MCPProbeRegistration.UNAVAILABLE


@pytest.mark.asyncio
async def test_a_publicly_resolvable_deployment_reports_the_metadata_document(
    monkeypatch,
):
    monkeypatch.setattr(
        "oss.src.core.gateways.mcps.probe.is_publicly_resolvable_async",
        _resolves_publicly(True),
    )

    result = await _probe(_protected_server()).probe(server_url=_SERVER_URL)

    assert result.auth.registration is MCPProbeRegistration.METADATA


# ---------------------------------------------------------------------------
# D38: the probe bounds what it reads and how long it waits
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_server_that_answers_with_more_than_a_handshake_is_not_read_whole():
    """The address is tenant data, so the size of what comes back was the server's
    choice: the body was buffered entirely before anything looked at it."""
    oversized = b"x" * (2 * 1024 * 1024)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-type": "application/json"}, content=oversized
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.reachable is True
    assert result.problem is not None
    assert result.problem.cause == "not_an_mcp_server"
    assert "more data" in result.problem.message


@pytest.mark.asyncio
async def test_a_handshake_just_under_the_cap_is_still_read():
    """The cap must be generous against a real handshake, which is a few kilobytes."""
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "result": {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "acme", "version": "1.0"},
            # Padding, well inside the cap.
            "instructions": "x" * 200_000,
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json"},
            content=json.dumps(payload).encode(),
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.reachable is True
    assert result.problem is None
    assert result.server_name == "acme"


@pytest.mark.asyncio
async def test_a_server_that_trickles_forever_does_not_hold_the_worker(monkeypatch):
    """httpx's timeout is an inactivity timeout, so a server sending one byte just
    inside it keeps a worker occupied for as long as it likes. The deadline is elapsed
    time, which is the only thing that bounds that."""
    import oss.src.core.gateways.mcps.probe as probe_module

    monkeypatch.setattr(probe_module, "_DEADLINE_SECONDS", 0.3)

    async def trickle():
        while True:
            yield b" "
            await asyncio.sleep(0.02)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-type": "application/json"}, content=trickle()
        )

    started = time.monotonic()
    result = await _probe(handler).probe(server_url=_SERVER_URL)
    elapsed = time.monotonic() - started

    assert result.reachable is False
    assert result.problem is not None
    assert result.problem.cause == "unreachable"
    assert "in time" in result.problem.message
    # The deadline, not the ten-second inactivity timeout.
    assert elapsed < 5


# ---------------------------------------------------------------------------
# D46: the same bounds on the branch a 401 takes
# ---------------------------------------------------------------------------


def _padded_prm(*, scopes: int) -> bytes:
    """A protected-resource document that is valid however large it is.

    The padding is more `scopes_supported` entries, which the model accepts and keeps, so
    the only thing standing between this document and a successful discovery is its size.
    Padding with bytes that are not JSON would have been refused by the parser whether
    the cap existed or not, which is no test of the cap at all.
    """
    return json.dumps(
        {
            **_PRM,
            "scopes_supported": [*_PRM["scopes_supported"]]
            + [f"pad:{index}" for index in range(scopes)],
        }
    ).encode()


def _serving_prm(document: bytes):
    """A 401 server whose protected-resource document is exactly these bytes."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/oauth-protected-resource":
            return httpx.Response(
                200, headers={"content-type": "application/json"}, content=document
            )
        if request.url.path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        return httpx.Response(
            401,
            json={"error": "invalid_token"},
            headers={
                "WWW-Authenticate": (
                    "Bearer resource_metadata="
                    '"https://mcp.acme.io/.well-known/oauth-protected-resource"'
                )
            },
        )

    return handler


@pytest.mark.asyncio
async def test_a_valid_metadata_document_past_the_cap_is_not_read():
    """Discovery's URLs are attacker-influenced too: the protected-resource location
    arrives in the server's own challenge. A candidate that answers with half a megabyte
    is skipped like any other unusable one — and this document is perfectly valid, so
    the only reason it is skipped is its size."""
    document = _padded_prm(scopes=40_000)
    assert len(document) > 256 * 1024

    result = await _probe(_serving_prm(document)).probe(server_url=_SERVER_URL)

    assert result.reachable is True
    assert result.problem is not None
    assert result.problem.cause == "auth_undiscoverable"
    assert result.auth is None or result.auth.mode is not MCPProbeAuthMode.OAUTH


@pytest.mark.asyncio
async def test_a_valid_metadata_document_under_the_cap_is_read():
    """The same document, padded to just under the cap. The bound has to be generous
    enough that a real document with a long scope list still gets through, or the cap
    would be refusing servers rather than protecting the process."""
    document = _padded_prm(scopes=10_000)
    assert 100 * 1024 < len(document) < 256 * 1024

    result = await _probe(_serving_prm(document)).probe(server_url=_SERVER_URL)

    assert result.problem is None
    assert result.auth is not None
    assert result.auth.mode is MCPProbeAuthMode.OAUTH


@pytest.mark.asyncio
async def test_an_ordinary_metadata_document_is_still_read():
    result = await _probe(_protected_server()).probe(server_url=_SERVER_URL)

    assert result.reachable is True
    assert result.problem is None
    assert result.auth is not None
    assert result.auth.mode is MCPProbeAuthMode.OAUTH


@pytest.mark.asyncio
async def test_a_server_whose_metadata_trickles_forever_is_reported_not_awaited(
    monkeypatch,
):
    """Discovery walks several candidates, each with its own inactivity timeout, so
    without an elapsed bound the 401 branch could outlast the branch that never reaches
    it."""
    import oss.src.core.gateways.mcps.probe as probe_module

    monkeypatch.setattr(probe_module, "_DEADLINE_SECONDS", 0.3)

    async def trickle():
        while True:
            yield b" "
            await asyncio.sleep(0.02)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/.well-known/"):
            return httpx.Response(
                200, headers={"content-type": "application/json"}, content=trickle()
            )
        return httpx.Response(
            401,
            json={"error": "invalid_token"},
            headers={
                "WWW-Authenticate": (
                    "Bearer resource_metadata="
                    '"https://mcp.acme.io/.well-known/oauth-protected-resource"'
                )
            },
        )

    started = time.monotonic()
    result = await _probe(handler).probe(server_url=_SERVER_URL)
    elapsed = time.monotonic() - started

    assert result.reachable is True
    assert result.problem is not None
    assert result.problem.cause == "auth_undiscoverable"
    assert "in time" in result.problem.message
    assert elapsed < 5


# ---------------------------------------------------------------------------
# A compressed answer, which is what every real server sends
# ---------------------------------------------------------------------------


def _gzipped(payload: bytes) -> tuple[bytes, dict]:
    return gzip.compress(payload), {
        "content-type": "application/json",
        "content-encoding": "gzip",
    }


@pytest.mark.asyncio
async def test_a_gzip_encoded_metadata_document_is_read():
    """The capped read yields decoded bytes, and the rebuilt response used to carry the
    upstream's `content-encoding` over them, so the next reader tried to decompress what
    was already decompressed. Every real server compresses; the mocks do not, which is
    why only a live probe found it."""
    document, headers = _gzipped(json.dumps(_PRM).encode())

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/.well-known/oauth-protected-resource":
            return httpx.Response(200, headers=headers, content=document)
        if request.url.path == "/.well-known/oauth-authorization-server":
            encoded, as_headers = _gzipped(json.dumps(_AS_METADATA).encode())
            return httpx.Response(200, headers=as_headers, content=encoded)
        return httpx.Response(
            401,
            json={"error": "invalid_token"},
            headers={
                "WWW-Authenticate": (
                    "Bearer resource_metadata="
                    '"https://mcp.acme.io/.well-known/oauth-protected-resource"'
                )
            },
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.problem is None, result.problem
    assert result.auth is not None
    assert result.auth.mode is MCPProbeAuthMode.OAUTH
    assert result.auth.authorization_server == "https://auth.acme.io/"


@pytest.mark.asyncio
async def test_a_gzip_encoded_handshake_is_read():
    """The same rebuild, on the branch a server that needs no authorization takes."""
    document, headers = _gzipped(json.dumps(_INITIALIZE_RESULT).encode())

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers=headers, content=document)

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.problem is None, result.problem
    assert result.reachable is True
    assert result.server_name == "Acme Tools"


@pytest.mark.asyncio
async def test_a_body_that_cannot_be_decoded_is_a_result_not_a_crash():
    """Whatever the cause, the connect dialog has somewhere to show a problem and
    nowhere to show a stack trace."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json", "content-encoding": "gzip"},
            content=b"this was never gzip",
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.problem is not None
    assert result.reachable is False
