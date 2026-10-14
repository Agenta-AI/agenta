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

import socket

import httpx
import pytest

from oss.src.core.gateways.mcps.dtos import MCPCredentialBinding
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
    metadata_documents: bool = False,
    metadata_status: int = 200,
    requests: list[httpx.Request] | None = None,
):
    """A server that refuses the anonymous handshake and publishes where to authorize."""
    metadata = dict(_AS_METADATA)
    if registration_endpoint:
        metadata["registration_endpoint"] = registration_endpoint
    if metadata_documents:
        metadata["client_id_metadata_document_supported"] = True

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
async def test_the_probe_handshakes_lists_tools_and_never_calls_a_tool():
    requests: list[httpx.Request] = []

    await _probe(_open_server(requests)).probe(server_url=_SERVER_URL)

    posted = [json.loads(r.content)["method"] for r in requests if r.method == "POST"]
    assert posted == ["initialize", "notifications/initialized", "tools/list"]


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
        {
            "jsonrpc": "2.0",
            "method": "notifications/message",
            "params": {"level": "info"},
        }
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


def _key_server(*, challenge: str | None = 'Bearer realm="acme"'):
    """A server that wants a header: it refuses the handshake and publishes no OAuth
    metadata at all. This is the shape `mcps/providers/mock/app.py` serves at `/key/mcp`."""

    def handler(request: httpx.Request) -> httpx.Response:
        if ".well-known" in request.url.path:
            return httpx.Response(404, text="not found")
        headers = {"WWW-Authenticate": challenge} if challenge else {}
        return httpx.Response(401, json={"error": "invalid_token"}, headers=headers)

    return handler


@pytest.mark.asyncio
async def test_an_undiscoverable_challenge_carries_what_the_server_asked_for():
    """`unknown` is what the connect journey turns into its API-key screen, and that
    screen asks for a header name. The challenge is the only thing the probe ever saw
    that says anything about which header, so it travels with the answer."""
    result = await _probe(_key_server()).probe(server_url=_SERVER_URL)

    assert result.auth.mode is MCPProbeAuthMode.UNKNOWN
    assert result.auth.challenge_status == 401
    assert result.auth.challenge_schemes == ["Bearer"]


@pytest.mark.asyncio
async def test_a_challenge_naming_several_schemes_reports_them_in_order():
    """RFC 9110 s11.6.1 makes the header a list. Only the scheme tokens are read; a
    challenge's parameters are its own vocabulary and are not schemes."""
    result = await _probe(
        _key_server(challenge='Bearer realm="acme", Basic realm="acme"')
    ).probe(server_url=_SERVER_URL)

    assert result.auth.challenge_schemes == ["Bearer", "Basic"]


@pytest.mark.asyncio
async def test_a_comma_inside_a_quoted_parameter_is_not_a_scheme():
    result = await _probe(
        _key_server(challenge='Bearer realm="one,two", error="a \\"b,c\\""')
    ).probe(server_url=_SERVER_URL)

    assert result.auth.challenge_schemes == ["Bearer"]


@pytest.mark.asyncio
async def test_a_challenge_naming_no_scheme_reports_none():
    """Nothing is guessed from a bare 401. A screen with no prefill is honest; a screen
    prefilled with a header the server never named is not."""
    result = await _probe(_key_server(challenge=None)).probe(server_url=_SERVER_URL)

    assert result.auth.mode is MCPProbeAuthMode.UNKNOWN
    assert result.auth.challenge_status == 401
    assert result.auth.challenge_schemes == []


@pytest.mark.asyncio
async def test_a_403_is_reported_as_the_status_it_was():
    def handler(request: httpx.Request) -> httpx.Response:
        if ".well-known" in request.url.path:
            return httpx.Response(404, text="not found")
        return httpx.Response(
            403, json={"error": "forbidden"}, headers={"WWW-Authenticate": "ApiKey"}
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.auth.challenge_status == 403
    assert result.auth.challenge_schemes == ["ApiKey"]


@pytest.mark.asyncio
async def test_a_server_that_answers_the_handshake_carries_no_challenge():
    """Nothing refused anything, so there is no challenge to report."""
    result = await _probe(_open_server()).probe(server_url=_SERVER_URL)

    assert result.auth.mode is MCPProbeAuthMode.NONE
    assert result.auth.challenge_status is None
    assert result.auth.challenge_schemes == []


@pytest.mark.asyncio
async def test_a_discoverable_challenge_stays_the_oauth_answer_and_keeps_the_challenge():
    """A person may pick an API key over OAuth. The key screen names the scheme from the
    challenge, so the OAuth answer keeps it."""
    result = await _probe(_protected_server()).probe(server_url=_SERVER_URL)

    assert result.auth.mode is MCPProbeAuthMode.OAUTH
    assert result.auth.challenge_status == 401
    assert result.auth.challenge_schemes == ["Bearer"]


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

    result = await _probe(_protected_server(metadata_documents=True)).probe(
        server_url=_SERVER_URL
    )

    assert result.auth.registration is MCPProbeRegistration.METADATA


@pytest.mark.asyncio
async def test_a_metadata_document_is_preferred_over_registration_where_both_are_offered(
    monkeypatch,
):
    monkeypatch.setattr(
        "oss.src.core.gateways.mcps.probe.is_publicly_resolvable_async",
        _resolves_publicly(True),
    )

    result = await _probe(
        _protected_server(
            registration_endpoint="https://auth.acme.io/register",
            metadata_documents=True,
        )
    ).probe(server_url=_SERVER_URL)

    assert result.auth.registration is MCPProbeRegistration.METADATA


@pytest.mark.asyncio
async def test_a_server_that_takes_neither_reports_unavailable_from_a_public_deployment(
    monkeypatch,
):
    """GitHub, HubSpot, Asana: no registration and no metadata documents, so the person
    has to bring an OAuth app, wherever this deployment is reachable from."""
    monkeypatch.setattr(
        "oss.src.core.gateways.mcps.probe.is_publicly_resolvable_async",
        _resolves_publicly(True),
    )

    result = await _probe(_protected_server()).probe(server_url=_SERVER_URL)

    assert result.auth.registration is MCPProbeRegistration.UNAVAILABLE


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


# ---------------------------------------------------------------------------
# D80: a refused connection and an unreadable answer are not the same failure
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_refused_connection_names_the_transport_that_refused_it():
    """The real-server acceptance case has to ask the DEPLOYMENT whether it can reach the
    internet, and `cause` alone cannot tell it: every transport failure is `unreachable`."""

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.problem is not None
    assert result.problem.cause == "unreachable"
    assert result.problem.transport == "connect_error"


@pytest.mark.asyncio
async def test_an_unreadable_answer_is_not_reported_as_a_refused_connection():
    """The regression that case exists for. The gateway reached the server and could not
    read what it sent, which must not read as "this deployment has no network"."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"content-type": "application/json", "content-encoding": "gzip"},
            content=b"this was never gzip",
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.problem is not None
    assert result.problem.cause == "unreachable"
    assert result.problem.transport == "transport_error"
    assert result.problem.transport != "connect_error"


@pytest.mark.asyncio
async def test_a_problem_that_no_transport_produced_names_none():
    """`transport` is set only when a transport failure produced the problem, so a caller
    branching on it is never told a story about the network that is not true."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="hello from a web server")

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.problem is not None
    assert result.problem.cause == "not_an_mcp_server"
    assert result.problem.transport is None


@pytest.mark.asyncio
async def test_a_name_that_does_not_resolve_says_so(monkeypatch):
    """How a machine with no outbound network fails: at the name, before any connection.
    It is the answer a runner has to be able to act on, and the address checks refuse a
    blocked target with the same coarse cause."""

    def _getaddrinfo(host, *_args, **_kwargs):
        raise socket.gaierror("Name or service not known")

    monkeypatch.setattr("oss.src.core.webhooks.utils.socket.getaddrinfo", _getaddrinfo)

    result = await _probe(_open_server()).probe(server_url=_SERVER_URL)

    assert result.problem is not None
    assert result.problem.cause == "address_refused"
    assert result.problem.transport == "unresolvable"


@pytest.mark.asyncio
async def test_a_blocked_address_names_no_transport(resolves_to):
    """The gateway declining to dial is a decision, not a network condition. Reading it as
    one would let an acceptance suite skip itself over a refusal it should have failed on."""
    resolves_to("127.0.0.1")

    result = await _probe(_open_server()).probe(server_url=_SERVER_URL)

    assert result.problem is not None
    assert result.problem.cause == "address_refused"
    assert result.problem.transport is None


# ---------------------------------------------------------------------------
# One answer per result, and the server's own words with it
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(301, headers={"location": "https://acme.io/"}),
        httpx.Response(404, html="<html>Not Found</html>"),
        httpx.Response(405, text="Method Not Allowed"),
        httpx.Response(200, html="<html>Sign in</html>"),
    ],
    ids=["redirect", "not-found", "method-not-allowed", "login-page"],
)
async def test_an_address_that_answers_with_no_handshake_is_not_an_mcp_server(
    response,
):
    result = await _probe(lambda _request: response).probe(server_url=_SERVER_URL)

    assert result.reachable is True
    assert result.auth.mode is MCPProbeAuthMode.UNKNOWN
    assert result.problem is not None
    assert result.problem.cause == "not_an_mcp_server"
    assert result.problem.response is not None
    assert result.problem.response.status == response.status_code
    assert result.problem.response.body == response.text


@pytest.mark.asyncio
async def test_a_result_under_an_error_status_is_not_a_handshake():
    """A body shaped like the handshake's result proves nothing when the status says the
    request failed."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json=_INITIALIZE_RESULT)

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.server_name is None
    assert result.problem is not None
    assert result.problem.cause == "not_an_mcp_server"
    assert result.problem.response.status == 500


@pytest.mark.asyncio
async def test_a_success_with_no_initialize_result_is_not_a_handshake():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32601}}
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.problem is not None
    assert result.problem.cause == "not_an_mcp_server"


@pytest.mark.asyncio
async def test_a_challenge_with_no_oauth_carries_the_refusal():
    result = await _probe(_key_server()).probe(server_url=_SERVER_URL)

    assert result.problem is not None
    assert result.problem.cause == "auth_undiscoverable"
    assert result.problem.response.status == 401
    assert json.loads(result.problem.response.body) == {"error": "invalid_token"}


@pytest.mark.asyncio
async def test_a_server_that_never_answered_carries_no_response():
    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.problem.cause == "unreachable"
    assert result.problem.response is None


@pytest.mark.asyncio
async def test_an_oversized_answer_carries_only_its_start():
    oversized = b"x" * (2 * 1024 * 1024)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=oversized)

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.problem.cause == "not_an_mcp_server"
    assert result.problem.response.status == 200
    assert result.problem.response.body == "x" * 2048


@pytest.mark.asyncio
async def test_the_excerpt_is_at_most_two_kilobytes():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="y" * 10_000)

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.problem.response.body == "y" * 2048


def _echoing(body: str):
    """A server that answers 404 with this body, as an error page that echoes a request."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text=body)

    return handler


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("written", "echoed"),
    [
        ("fake-typed-key-0123456789", "fake-typed-key-0123456789"),
        # Shorter than any header rule would scan for. A short key is still a key.
        ("secret7", "secret7"),
        # A query `+` is a space, and an echo can carry either form.
        ("abcdefgh+ijklmnop", "abcdefgh+ijklmnop"),
        ("abcdefgh+ijklmnop", "abcdefgh ijklmnop"),
        ("fake%2Ftyped%2Fkey", "fake/typed/key"),
        # A raw value can come back encoded.
        ("fake/typed/key", "fake%2Ftyped%2Fkey"),
        ("abcdefgh+ijklmnop", "abcdefgh%20ijklmnop"),
    ],
)
async def test_the_excerpt_never_carries_a_key_from_the_url(written, echoed):
    """A person can type a key into the address, and an error page that echoes the
    request then holds it."""
    url = f"https://mcp.acme.io/mcp?api_key={written}"

    result = await _probe(_echoing(f"no route for api_key={echoed} here")).probe(
        server_url=url
    )

    body = result.problem.response.body
    assert body == "no route for api_key=[REDACTED] here"


@pytest.mark.asyncio
async def test_a_key_across_the_cut_leaves_no_prefix_behind():
    """The key is removed before the body is cut, so a key that straddles the cut
    cannot leave its first half in the excerpt."""
    key = "fake-typed-key-0123456789"
    url = f"https://mcp.acme.io/mcp?api_key={key}"

    result = await _probe(_echoing("z" * 2040 + key)).probe(server_url=url)

    body = result.problem.response.body
    assert len(body) == 2048
    assert body[2040:] == "[REDACTED]"[:8]
    assert not any(key[:length] in body for length in range(2, len(key) + 1))


_PLACEHOLDER_URL = "https://mcp.acme.io/{secret}/v2/mcp"
_URL_BINDING = MCPCredentialBinding(kind="url")


@pytest.mark.asyncio
async def test_a_placeholder_address_is_handshaked_with_the_secret_in_its_path():
    """The address does not exist without its key, so the probe fills it, and only in the
    path: no header carries it."""
    requests: list[httpx.Request] = []

    result = await _probe(_open_server(requests)).probe(
        server_url=_PLACEHOLDER_URL, secret="test key/one", binding=_URL_BINDING
    )

    assert result.reachable and result.server_name == "Acme Tools"
    assert {r.url.raw_path for r in requests} == {b"/test%20key%2Fone/v2/mcp"}
    for request in requests:
        assert "authorization" not in {k.lower() for k in request.headers}


@pytest.mark.asyncio
@pytest.mark.parametrize("echoed", ["test key/one", "test%20key%2Fone"])
async def test_the_excerpt_never_carries_the_secret_from_the_path(echoed):
    result = await _probe(_echoing(f"no route for /{echoed}/v2/mcp")).probe(
        server_url=_PLACEHOLDER_URL, secret="test key/one", binding=_URL_BINDING
    )

    assert result.problem.response.body == "no route for /[REDACTED]/v2/mcp"


@pytest.mark.asyncio
async def test_a_refused_secret_is_reported_without_discovery():
    """A challenge can name a metadata address on another origin that carries the key.
    With a secret in the path, a 401 is the key refused, and nothing else is asked."""
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            401,
            headers={
                "WWW-Authenticate": (
                    'Bearer resource_metadata="https://other.example/test-key-one/meta"'
                )
            },
        )

    result = await _probe(handler).probe(
        server_url=_PLACEHOLDER_URL, secret="test-key-one", binding=_URL_BINDING
    )

    # The handshake only, to the address the person typed.
    assert [r.headers["host"] for r in requests] == ["mcp.acme.io"]
    assert result.auth.mode == MCPProbeAuthMode.UNKNOWN
    assert result.auth.challenge_status == 401
    assert result.problem is None


@pytest.mark.asyncio
@pytest.mark.parametrize("echoed", ["test key/one", "test%20key%2Fone"])
async def test_a_handshake_that_echoes_the_secret_returns_it_nowhere(echoed):
    """A successful handshake can write the key into what it reports about itself."""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "protocolVersion": f"v-{echoed}",
                    "serverInfo": {"name": f"Acme {echoed}"},
                },
            },
        )

    result = await _probe(handler).probe(
        server_url=_PLACEHOLDER_URL, secret="test key/one", binding=_URL_BINDING
    )

    assert result.server_name == "Acme [REDACTED]"
    assert result.protocol_version == "v-[REDACTED]"
    assert echoed not in result.model_dump_json()


# ---------------------------------------------------------------------------
# Discovery starts from the challenge the handshake already received
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_discovery_reads_the_handshake_challenge_rather_than_asking_again():
    """Many servers answer GET with 405, so a second anonymous GET lost the hint the
    POST carried. The document here lives at a location only the challenge names."""
    requests: list[httpx.Request] = []
    prm_url = "https://mcp.acme.io/meta/prm.json"

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/meta/prm.json":
            return httpx.Response(200, json=_PRM)
        if request.url.path == "/.well-known/oauth-authorization-server":
            return httpx.Response(200, json=_AS_METADATA)
        if request.method == "GET":
            return httpx.Response(405)
        return httpx.Response(
            401,
            headers={"WWW-Authenticate": f'Bearer resource_metadata="{prm_url}"'},
        )

    result = await _probe(handler).probe(server_url=_SERVER_URL)

    assert result.auth.mode is MCPProbeAuthMode.OAUTH
    to_server = [r for r in requests if r.url.path == "/"]
    assert [r.method for r in to_server] == ["POST"]


@pytest.mark.asyncio
async def test_the_handshake_and_discovery_share_one_deadline(monkeypatch):
    """A slow handshake leaves discovery only what remains, so a challenged probe ends
    when the browser expects it to."""
    import oss.src.core.gateways.mcps.probe as probe_module

    monkeypatch.setattr(probe_module, "_DEADLINE_SECONDS", 0.5)

    async def trickle():
        while True:
            yield b" "
            await asyncio.sleep(0.02)

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/.well-known/"):
            return httpx.Response(200, content=trickle())
        await asyncio.sleep(0.35)
        return httpx.Response(401, headers={"WWW-Authenticate": "Bearer"})

    started = time.monotonic()
    result = await _probe(handler).probe(server_url=_SERVER_URL)
    elapsed = time.monotonic() - started

    assert result.problem.cause == "auth_undiscoverable"
    assert "in time" in result.problem.message
    # Two separate deadlines would run past 0.85 s.
    assert elapsed < 0.75


@pytest.mark.asyncio
async def test_a_slow_name_resolution_spends_the_same_deadline(monkeypatch):
    import oss.src.core.gateways.mcps.probe as probe_module

    monkeypatch.setattr(probe_module, "_DEADLINE_SECONDS", 0.2)

    async def slow_open_egress(_url):
        await asyncio.sleep(5)

    monkeypatch.setattr(probe_module, "open_egress", slow_open_egress)

    started = time.monotonic()
    result = await _probe(_open_server()).probe(server_url=_SERVER_URL)
    elapsed = time.monotonic() - started

    assert result.reachable is False
    assert result.problem.cause == "unreachable"
    assert result.problem.transport == "timeout"
    assert elapsed < 1


@pytest.mark.asyncio
async def test_a_slow_registration_check_keeps_the_oauth_answer(monkeypatch):
    """The registration check resolves this deployment's own name. When that outlasts
    the deadline, OAuth was still found, and only the registration is left unsaid."""
    import oss.src.core.gateways.mcps.probe as probe_module

    monkeypatch.setattr(probe_module, "_DEADLINE_SECONDS", 0.2)

    async def slow_check(_api_url: str) -> bool:
        await asyncio.sleep(5)
        return True

    monkeypatch.setattr(probe_module, "is_publicly_resolvable_async", slow_check)

    started = time.monotonic()
    result = await _probe(_protected_server(metadata_documents=True)).probe(
        server_url=_SERVER_URL
    )
    elapsed = time.monotonic() - started

    assert result.auth.mode is MCPProbeAuthMode.OAUTH
    assert result.auth.registration is None
    assert result.problem is None
    assert elapsed < 1


# ---------------------------------------------------------------------------
# The legacy HTTP+SSE transport, which Agenta does not speak (#6915)
# ---------------------------------------------------------------------------


def _refusal(www_authenticate: str) -> dict:
    return {
        "status_code": 401,
        "json": {
            "error": "invalid_token",
            "error_description": "Missing or invalid access token",
        },
        "headers": {"WWW-Authenticate": www_authenticate},
    }


# What Atlassian's `/v1/sse` and `/v1/mcp` both answered an anonymous POST and GET, recorded
# on 2026-10-14. The two addresses send the same refusal byte for byte.
_ATLASSIAN_REFUSAL = _refusal(
    'Bearer realm="OAuth", error="invalid_token", '
    'error_description="Missing or invalid access token"'
)

# What Asana's `/sse` answered, recorded the same day. It names a resource metadata
# document, so without the address check it would have been offered OAuth.
_ASANA_SSE_REFUSAL = _refusal(
    'Bearer realm="OAuth", '
    'resource_metadata="https://mcp.asana.com/.well-known/oauth-protected-resource", '
    'error="invalid_token", error_description="Missing or invalid access token"'
)


def _recorded(answer, requests: list[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(**answer)

    return handler


def _legacy_sse_server(requests: list[httpx.Request], *, post_status: int = 405):
    """A server on the legacy transport: it refuses the POST and streams to a GET."""

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                content=b"event: endpoint\ndata: /messages?sessionId=1\n\n",
                headers={"content-type": "text/event-stream"},
            )
        return httpx.Response(post_status, text="Method Not Allowed")

    return handler


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "server_url,answer",
    [
        ("https://mcp.atlassian.com/v1/sse", _ATLASSIAN_REFUSAL),
        ("https://mcp.asana.com/sse", _ASANA_SSE_REFUSAL),
        ("https://mcp.asana.com/sse/", _ASANA_SSE_REFUSAL),
    ],
)
async def test_a_refused_sse_address_is_warned_about_not_refused(server_url, answer):
    # Neither recorded answer proves the transport, so the sign-in goes ahead. Both
    # servers refuse discovery here, which lands on credential entry.
    requests: list[httpx.Request] = []
    result = await _probe(_recorded(answer, requests)).probe(server_url=server_url)

    assert result.legacy_transport_suspected is True
    assert result.problem.cause == "auth_undiscoverable"
    assert result.auth.challenge_status == 401
    # No address is suggested anywhere: a computed one sent Asana to the wrong place.
    suggested = server_url.rstrip("/").removesuffix("/sse") + "/mcp"
    assert suggested not in result.model_dump_json()
    # The GET that proves a legacy stream is never sent after a 401.
    assert all(
        request.url.path.startswith("/.well-known/")
        for request in requests
        if request.method == "GET"
    )


@pytest.mark.asyncio
async def test_a_custom_sse_address_with_oauth_metadata_reaches_oauth_with_a_warning():
    result = await _probe(_protected_server()).probe(
        server_url="https://mcp.acme.io/sse"
    )

    assert result.problem is None
    assert result.auth.mode is MCPProbeAuthMode.OAUTH
    assert result.legacy_transport_suspected is True


@pytest.mark.asyncio
async def test_a_custom_sse_address_without_metadata_reaches_credential_entry_with_a_warning():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.startswith("/.well-known/"):
            return httpx.Response(404)
        return httpx.Response(401, headers={"WWW-Authenticate": "Bearer"})

    result = await _probe(handler).probe(server_url="https://mcp.acme.io/sse")

    assert result.problem.cause == "auth_undiscoverable"
    assert result.auth.mode is MCPProbeAuthMode.UNKNOWN
    assert result.legacy_transport_suspected is True


@pytest.mark.asyncio
async def test_the_same_refusal_at_a_streamable_address_is_still_a_challenge():
    requests: list[httpx.Request] = []
    result = await _probe(_recorded(_ATLASSIAN_REFUSAL, requests)).probe(
        server_url="https://mcp.atlassian.com/v1/mcp"
    )

    assert result.problem.cause == "auth_undiscoverable"
    assert result.auth.challenge_status == 401
    assert result.legacy_transport_suspected is False
    assert all(
        request.url.path.startswith("/.well-known/")
        for request in requests
        if request.method == "GET"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("post_status", [404, 405])
async def test_a_refused_post_and_an_event_stream_is_an_unsupported_transport(
    post_status,
):
    requests: list[httpx.Request] = []
    result = await _probe(_legacy_sse_server(requests, post_status=post_status)).probe(
        server_url="https://mcp.acme.io/events"
    )

    assert result.problem.cause == "unsupported_transport"
    assert result.problem.message.startswith(
        "This address uses the older SSE transport, which Agenta does not support."
    )
    assert result.problem.response.status == post_status
    get = requests[-1]
    assert get.method == "GET"
    assert get.headers["accept"] == "text/event-stream"
    assert "authorization" not in get.headers


@pytest.mark.asyncio
async def test_a_refused_post_with_no_stream_is_not_an_mcp_server():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="Not Found")

    result = await _probe(handler).probe(server_url="https://mcp.acme.io/events")

    assert result.problem.cause == "not_an_mcp_server"


@pytest.mark.asyncio
async def test_a_stream_that_does_not_open_is_not_evidence_of_one():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            raise httpx.ReadTimeout("no stream", request=request)
        return httpx.Response(405)

    result = await _probe(handler).probe(server_url="https://mcp.acme.io/events")

    assert result.problem.cause == "not_an_mcp_server"


@pytest.mark.asyncio
async def test_other_failures_never_send_the_get():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(500)

    result = await _probe(handler).probe(server_url="https://mcp.acme.io/events")

    assert result.problem.cause == "not_an_mcp_server"
    assert [request.method for request in requests] == ["POST"]


@pytest.mark.asyncio
async def test_an_sse_address_that_answers_the_handshake_connects():
    result = await _probe(_open_server()).probe(server_url="https://mcp.acme.io/sse")

    assert result.problem is None
    assert result.auth.mode is MCPProbeAuthMode.NONE


@pytest.mark.asyncio
async def test_a_key_is_handshaked_in_the_header_its_binding_names():
    """A changed key is checked before it is saved, sent the way the relay sends it."""
    requests: list[httpx.Request] = []

    result = await _probe(_open_server(requests)).probe(
        server_url="https://mcp.acme.io/mcp",
        secret="test-key-one",
        binding=MCPCredentialBinding(kind="header", name="X-Api-Key", prefix="Token"),
    )

    assert result.auth.mode == MCPProbeAuthMode.NONE
    assert requests[0].headers["x-api-key"] == "Token test-key-one"


@pytest.mark.asyncio
async def test_a_key_is_handshaked_in_the_query_parameter_its_binding_names():
    requests: list[httpx.Request] = []

    await _probe(_open_server(requests)).probe(
        server_url="https://mcp.acme.io/mcp?region=eu",
        secret="test-key-one",
        binding=MCPCredentialBinding(kind="query", name="apiKey"),
    )

    assert requests[0].url.params["apiKey"] == "test-key-one"
    assert requests[0].url.params["region"] == "eu"


@pytest.mark.asyncio
async def test_a_refused_header_key_is_reported_without_discovery_or_the_key():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="bad key test-key-one", headers={})

    result = await _probe(handler).probe(
        server_url="https://mcp.acme.io/mcp",
        secret="test-key-one",
        binding=MCPCredentialBinding(kind="header", name="Authorization"),
    )

    assert result.auth.mode == MCPProbeAuthMode.UNKNOWN
    assert result.auth.challenge_status == 401
    assert "test-key-one" not in result.model_dump_json()


def _refusing_tool_list(requests: list[httpx.Request]):
    """A server that answers the handshake to anyone and checks the key on the list."""

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(404)
        if json.loads(request.content)["method"] == "tools/list":
            return httpx.Response(401, json={"error": "invalid_token"})
        return httpx.Response(
            200, json=_INITIALIZE_RESULT, headers={"mcp-session-id": "session-one"}
        )

    return handler


@pytest.mark.asyncio
async def test_a_key_the_server_refuses_on_the_tool_list_is_reported_refused():
    """A key checked by `initialize` alone was saved, and the tool list then refused it."""
    requests: list[httpx.Request] = []

    result = await _probe(_refusing_tool_list(requests)).probe(
        server_url="https://mcp.acme.io/mcp",
        secret="test-key-one",
        binding=MCPCredentialBinding(kind="header", name="X-Api-Key"),
    )

    assert result.auth.mode == MCPProbeAuthMode.UNKNOWN
    assert result.auth.challenge_status == 401
    listed = requests[-1]
    assert listed.headers["x-api-key"] == "test-key-one"
    assert listed.headers["mcp-session-id"] == "session-one"
    assert listed.headers["mcp-protocol-version"] == "2025-06-18"


@pytest.mark.asyncio
async def test_no_key_the_server_refuses_on_the_tool_list_is_not_none():
    """The check before a reconnect writes None reads this answer too."""
    result = await _probe(_refusing_tool_list([])).probe(server_url=_SERVER_URL)

    assert result.auth.mode is not MCPProbeAuthMode.NONE
    assert result.auth.challenge_status == 401
