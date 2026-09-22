"""The gateway's outbound header contract, on both planes (OR36, OR37, OR39).

Three guarantees are pinned here, each of which the branch broke before these cases existed:

* what a caller sends reaches a tenant-configured upstream only if it is on the forward
  allowlist, so the caller's Agenta session cookie and `Authorization` never travel;
* the credential the gateway injects replaces any same-named header whatever its casing,
  so an upstream is never handed two authorization values to choose between;
* an upstream that returns the injected credential is refused rather than relayed, on the
  buffered path and the streamed one alike.

Every credential in this file is synthetic and belongs to no provider. Nothing runs:
`httpx.MockTransport` stands in for each upstream.
"""

import json
from types import SimpleNamespace
from typing import List
from uuid import uuid4

import httpx
import pytest

from oss.src.apis.fastapi.gateways.utils import response_headers
from oss.src.core.gateway.connections.dtos import Connection, ConnectionProviderKind
from oss.src.core.gateways.dtos import CREDENTIAL_ECHO_CODE
from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMEndpointSettings,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.providers.passthrough.adapter import (
    LLMUpstreamCredentialEchoError,
    RelayLLMAdapter,
)
from oss.src.core.gateways.mcps.dtos import (
    MCPBrokeredAuth,
    MCPCallContext,
    MCPDirectAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.providers.composio import ComposioMCPAdapter
from oss.src.core.gateways.mcps.providers.composio.standard import (
    StandardComposioMCPAdapter,
)
from oss.src.core.gateways.mcps.providers.http.adapter import HttpMCPAdapter
from oss.src.core.gateways.policy.dtos import (
    ResolvedSecret,
    SecretOrigin,
    SecretOwner,
    SecretOwnerKind,
)
from oss.src.core.secrets.dtos import (
    MCPStandardProviderDTO,
    SecretResponseDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import (
    MCPStandardProviderKind,
    SecretKind,
    StandardProviderKind,
)
from oss.src.core.shared.dtos import Header

# Synthetic throughout: none of these authenticates to anything.
_PROVIDER_KEY = "sk-synthetic-provider-key-000000000001"
_OAUTH_TOKEN = "synthetic-oauth-access-token-000000001"
_SESSION_CAPABILITY = "synthetic-session-capability-00000001"
_CALLER_TOKEN = "Bearer synthetic-caller-token"
_CALLER_COOKIE = "sAccessToken=synthetic-session-cookie"

_PUBLIC_IP = "93.184.216.34"  # example.com — routable, non-private

# What a caller sends on every request here: two credentials of its own that belong to
# Agenta, not to the upstream, and one header the upstream legitimately needs.
_CALLER_HEADERS = {
    "cookie": _CALLER_COOKIE,
    "authorization": _CALLER_TOKEN,
    "content-type": "application/json",
}


# --------------------------------------------------------------------------- #
# fixtures
# --------------------------------------------------------------------------- #


@pytest.fixture(autouse=True)
def _empty_host_allowlist(monkeypatch):
    monkeypatch.setattr(
        "oss.src.core.gateways.egress.env.mcp_gateway.host_allowlist",
        [],
    )


def _llm_route() -> LLMResolvedRoute:
    return LLMResolvedRoute(
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.DIRECT,
        model="gpt-4o",
        base_url="https://upstream.example/v1",
        settings=LLMEndpointSettings(),
    )


def _llm_context(*, stream: bool = False) -> LLMCallContext:
    return LLMCallContext(model="gpt-4o", stream=stream)


def _llm_body() -> bytes:
    return json.dumps({"model": "gpt-4o", "messages": []}).encode()


def _llm_secret(key: str = _PROVIDER_KEY) -> ResolvedSecret:
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.PROVIDER_KEY,
            data=StandardProviderDTO(
                kind=StandardProviderKind.OPENAI,
                provider=StandardProviderSettingsDTO(key=key),
            ),
            header=Header(name="openai"),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


def _llm_adapter(handler) -> RelayLLMAdapter:
    return RelayLLMAdapter(
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )


async def _drain(body) -> List[bytes]:
    return [chunk async for chunk in body]


def _streaming_response(chunks: List[bytes]) -> httpx.Response:
    async def stream():
        for chunk in chunks:
            yield chunk

    return httpx.Response(
        200, content=stream(), headers={"content-type": "text/event-stream"}
    )


def _mcp_context() -> MCPCallContext:
    return MCPCallContext(method="tools/list")


def _mcp_oauth_auth() -> MCPDirectAuth:
    # `OAuthGrantSettingsDTO` is not in the codebase yet (WP16), so this mirrors the shape
    # HttpMCPAdapter reads defensively, as the adapter's own suite does.
    return MCPDirectAuth.model_construct(
        secret=SimpleNamespace(
            secret=SimpleNamespace(
                data=SimpleNamespace(
                    grant=SimpleNamespace(
                        access_token=_OAUTH_TOKEN, token_type="Bearer"
                    )
                )
            )
        )
    )


def _composio_connection() -> Connection:
    return Connection(
        id=uuid4(),
        slug="my-gmail",
        name="My Gmail",
        provider_key=ConnectionProviderKind.COMPOSIO,
        integration_key="gmail",
        flags={"is_active": True, "is_valid": True},
        data={"project_id": "project-composio-user", "no_auth": False},
    )


def _composio_session_handler(requests: List[httpx.Request]):
    """A Tool Router broker: a session call, then the hosted MCP call."""

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/tool_router/session"):
            return httpx.Response(
                201,
                json={
                    "mcp": {
                        "url": "https://mcp.composio.test/session/abc",
                        "headers": {"Authorization": f"Bearer {_SESSION_CAPABILITY}"},
                    }
                },
            )
        return httpx.Response(200, content=b'{"jsonrpc":"2.0","id":1,"result":{}}')

    return handler


def _standard_composio_auth() -> MCPDirectAuth:
    return MCPDirectAuth(
        secret=ResolvedSecret(
            secret=SecretResponseDTO(
                id=uuid4(),
                slug="composio",
                header=Header(name="Composio"),
                kind=SecretKind.PROVIDER_KEY,
                data=MCPStandardProviderDTO(
                    kind=MCPStandardProviderKind.COMPOSIO,
                    provider=StandardProviderSettingsDTO(key="synthetic-composio-key"),
                ),
            ),
            owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
            origin=SecretOrigin.VAULT,
        )
    )


def _assert_only_the_gateways_credential(
    headers: httpx.Headers, *, expected: str
) -> None:
    """No caller credential upstream, and exactly one authorization value: ours."""
    assert "cookie" not in headers
    assert headers.get_list("authorization") == [expected]


# --------------------------------------------------------------------------- #
# 1. the LLM plane drops the caller's credentials and sends exactly one of ours
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_llm_relay_drops_caller_cookie_and_authorization():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _llm_adapter(handler)
    await adapter.relay_chat_completion(
        route=_llm_route(),
        secret=_llm_secret(),
        context=_llm_context(),
        body=_llm_body(),
        headers=_CALLER_HEADERS,
    )

    _assert_only_the_gateways_credential(
        captured["headers"], expected=f"Bearer {_PROVIDER_KEY}"
    )


# --------------------------------------------------------------------------- #
# 2. the same on each MCP adapter
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_http_mcp_relay_drops_caller_cookie_and_authorization():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {}})

    adapter = HttpMCPAdapter(transport=httpx.MockTransport(handler))
    await adapter.relay(
        route=MCPResolvedRoute(url=f"https://{_PUBLIC_IP}/mcp"),
        auth=_mcp_oauth_auth(),
        context=_mcp_context(),
        body=b"{}",
        headers=_CALLER_HEADERS,
    )

    _assert_only_the_gateways_credential(
        captured["headers"], expected=f"Bearer {_OAUTH_TOKEN}"
    )


@pytest.mark.asyncio
async def test_builtin_composio_mcp_relay_drops_caller_cookie_and_authorization():
    requests: List[httpx.Request] = []
    adapter = ComposioMCPAdapter(
        api_key="synthetic-platform-composio-key",
        api_url="https://backend.composio.test/api/v3.1",
        transport=httpx.MockTransport(_composio_session_handler(requests)),
    )

    await adapter.relay(
        route=MCPResolvedRoute(url="composio://composio/gmail/my-gmail"),
        auth=MCPBrokeredAuth(connection=_composio_connection()),
        context=_mcp_context(),
        body=b"{}",
        headers=_CALLER_HEADERS,
    )

    _, mcp_request = requests
    _assert_only_the_gateways_credential(
        mcp_request.headers, expected=f"Bearer {_SESSION_CAPABILITY}"
    )


@pytest.mark.asyncio
async def test_standard_composio_mcp_relay_drops_caller_cookie_and_authorization():
    requests: List[httpx.Request] = []
    adapter = StandardComposioMCPAdapter(
        api_url="https://broker.composio.test/api/v3.1",
        transport=httpx.MockTransport(_composio_session_handler(requests)),
    )

    await adapter.relay(
        route=MCPResolvedRoute(url="composio://standard", project_id=uuid4()),
        auth=_standard_composio_auth(),
        context=_mcp_context(),
        body=b"{}",
        headers=_CALLER_HEADERS,
    )

    _, mcp_request = requests
    _assert_only_the_gateways_credential(
        mcp_request.headers, expected=f"Bearer {_SESSION_CAPABILITY}"
    )


# --------------------------------------------------------------------------- #
# 3. the allowlist is what decides, not the header's shape
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_allowlisted_header_travels_and_an_arbitrary_one_does_not():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        return httpx.Response(200, json={"id": "x", "choices": []})

    adapter = _llm_adapter(handler)
    await adapter.relay_chat_completion(
        route=_llm_route(),
        secret=None,
        context=_llm_context(),
        body=_llm_body(),
        headers={
            "anthropic-version": "2023-06-01",
            "x-stainless-retry-count": "2",
            "x-evil": "1",
        },
    )

    headers = captured["headers"]
    assert headers["anthropic-version"] == "2023-06-01"
    assert headers["x-stainless-retry-count"] == "2"
    assert "x-evil" not in headers


# --------------------------------------------------------------------------- #
# 4. an upstream cannot set a cookie on Agenta's own origin
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_upstream_set_cookie_is_not_returned_to_the_caller():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"id": "x", "choices": []},
            headers={"set-cookie": "upstream_session=synthetic; Path=/"},
        )

    adapter = _llm_adapter(handler)
    result = await adapter.relay_chat_completion(
        route=_llm_route(),
        secret=_llm_secret(),
        context=_llm_context(),
        body=_llm_body(),
        headers={},
    )
    await _drain(result.body)

    returned = response_headers(result.headers)
    assert not any(name.lower() == "set-cookie" for name in returned)


# --------------------------------------------------------------------------- #
# 5. the pooled client carries no cookie from one tenant's upstream to the next
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_upstream_cookie_is_not_replayed_on_a_later_call():
    """One `httpx.AsyncClient` lives for the life of the process and is shared by every
    tenant, so a jar on it is a cross-tenant channel: the first upstream's `Set-Cookie`
    would be stored and sent to the second."""
    sent: List[httpx.Headers] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(request.headers)
        return httpx.Response(
            200,
            json={"id": "x", "choices": []},
            headers={"set-cookie": "upstream_session=synthetic; Path=/"},
        )

    adapter = _llm_adapter(handler)
    for _ in range(2):
        result = await adapter.relay_chat_completion(
            route=_llm_route(),
            secret=_llm_secret(),
            context=_llm_context(),
            body=_llm_body(),
            headers={},
        )
        await _drain(result.body)

    assert len(sent) == 2
    assert "cookie" not in sent[1]


# --------------------------------------------------------------------------- #
# 6/7. an upstream that returns the injected credential is refused, not relayed
# --------------------------------------------------------------------------- #


def _assert_refusal(error: LLMUpstreamCredentialEchoError) -> None:
    envelope = error.envelope
    assert envelope["code"] == CREDENTIAL_ECHO_CODE
    assert envelope["retryable"] is False
    assert envelope["next_step"]
    # The refusal reaches the sandbox and the transcript, which is the disclosure it
    # exists to prevent.
    assert _PROVIDER_KEY not in json.dumps(envelope)
    assert _PROVIDER_KEY not in str(error)


@pytest.mark.asyncio
async def test_non_streaming_body_echoing_the_credential_is_refused():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={
                "error": {
                    "message": f"Incorrect API key provided: {_PROVIDER_KEY}",
                }
            },
        )

    adapter = _llm_adapter(handler)
    result = await adapter.relay_chat_completion(
        route=_llm_route(),
        secret=_llm_secret(),
        context=_llm_context(),
        body=_llm_body(),
        headers={},
    )

    with pytest.raises(LLMUpstreamCredentialEchoError) as excinfo:
        await _drain(result.body)

    _assert_refusal(excinfo.value)


@pytest.mark.asyncio
async def test_streamed_credential_split_across_two_chunks_is_refused():
    """The split lands mid-credential on purpose: a per-chunk search with no memory of the
    chunk before it sees neither half and relays both."""
    frame = f'data: {{"error":"key {_PROVIDER_KEY} is invalid"}}\n\n'.encode()
    starts_at = frame.index(_PROVIDER_KEY.encode())
    split = starts_at + len(_PROVIDER_KEY) // 2
    first, second = frame[:split], frame[split:]
    assert _PROVIDER_KEY.encode() not in first
    assert _PROVIDER_KEY.encode() not in second

    async def handler(request: httpx.Request) -> httpx.Response:
        return _streaming_response([first, second])

    adapter = _llm_adapter(handler)
    result = await adapter.relay_chat_completion(
        route=_llm_route(),
        secret=_llm_secret(),
        context=_llm_context(stream=True),
        body=_llm_body(),
        headers={},
    )

    chunks: List[bytes] = []
    with pytest.raises(LLMUpstreamCredentialEchoError) as excinfo:
        async for chunk in result.body:
            chunks.append(chunk)

    _assert_refusal(excinfo.value)
    # The refusal really did come from a value spanning the boundary: the second chunk was
    # never relayed, and neither was the part of the first that had begun the credential.
    relayed = b"".join(chunks)
    assert relayed == frame[:starts_at]
    assert second not in relayed


@pytest.mark.asyncio
async def test_a_body_without_the_credential_still_relays_when_one_was_injected():
    """The negative space of the two cases above: the scan refuses an echo, not a body."""
    payload = {"id": "x", "choices": [], "usage": {"prompt_tokens": 1}}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    adapter = _llm_adapter(handler)
    result = await adapter.relay_chat_completion(
        route=_llm_route(),
        secret=_llm_secret(),
        context=_llm_context(),
        body=_llm_body(),
        headers=_CALLER_HEADERS,
    )

    chunks = await _drain(result.body)
    assert json.loads(chunks[0]) == payload


@pytest.mark.asyncio
async def test_no_injected_secret_means_no_scan():
    """Nothing was injected, so nothing can be echoed: a body that happens to carry the
    string is relayed, and the scan costs a call with no secret nothing."""
    body = json.dumps({"error": {"message": _PROVIDER_KEY}}).encode()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, content=body)

    adapter = _llm_adapter(handler)
    result = await adapter.relay_chat_completion(
        route=_llm_route(),
        secret=None,
        context=_llm_context(),
        body=_llm_body(),
        headers={},
    )

    assert await _drain(result.body) == [body]


@pytest.mark.asyncio
async def test_a_credential_returned_in_a_response_header_is_refused():
    """The scan read the body only, and the proxy copies the upstream's header block onto
    Agenta's own response (`response_headers` strips hop-by-hop names and `set-cookie`, and
    nothing else). So a 200 whose body is ordinary and whose header carries the key handed
    the caller the credential with the body scan finding nothing."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"id": "x", "choices": []},
            headers={"x-debug-auth": _PROVIDER_KEY},
        )

    adapter = _llm_adapter(handler)

    # The refusal lands before either response shape is built, so the proxy never reaches
    # `response_headers` with a header block holding the key.
    with pytest.raises(LLMUpstreamCredentialEchoError) as excinfo:
        await adapter.relay_chat_completion(
            route=_llm_route(),
            secret=_llm_secret(),
            context=_llm_context(),
            body=_llm_body(),
            headers={},
        )

    _assert_refusal(excinfo.value)
    assert response_headers({"x-debug-auth": _PROVIDER_KEY}) == {
        "x-debug-auth": _PROVIDER_KEY
    }, "the header would have been forwarded verbatim had the relay not refused"


@pytest.mark.asyncio
async def test_a_credential_split_one_byte_from_its_end_never_reaches_the_caller():
    """The reviewer's case: 26 bytes split at 25 leaves one byte to guess. Detecting the
    split once the second chunk arrives is too late — the first chunk is already gone — so
    the relay withholds a tail that could still become the credential instead."""
    short_key = "sk-synthetic-2600000000001"
    assert len(short_key) == 26
    frame = f'data: {{"error":"key {short_key}"}}\n\n'.encode()
    split = frame.index(short_key.encode()) + 25
    first, second = frame[:split], frame[split:]
    assert first.endswith(short_key[:25].encode())

    async def handler(request: httpx.Request) -> httpx.Response:
        return _streaming_response([first, second])

    adapter = _llm_adapter(handler)
    result = await adapter.relay_chat_completion(
        route=_llm_route(),
        secret=_llm_secret(key=short_key),
        context=_llm_context(stream=True),
        body=_llm_body(),
        headers={},
    )

    chunks: List[bytes] = []
    with pytest.raises(LLMUpstreamCredentialEchoError):
        async for chunk in result.body:
            chunks.append(chunk)

    relayed = b"".join(chunks)
    # Not one byte of the credential, not merely "not all 26 of them".
    for length in range(1, len(short_key) + 1):
        assert short_key[:length].encode() not in relayed


@pytest.mark.asyncio
async def test_a_stream_that_never_echoes_is_relayed_whole_and_undelayed():
    """The withholding must not cost a normal stream its bytes or its liveness: every chunk
    goes out as it arrives, and the body the caller assembles is the body sent."""
    frames = [
        b'data: {"choices":[{"delta":{"content":"hel"}}]}\n\n',
        b'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        b'data: {"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\n',
        b"data: [DONE]\n\n",
    ]

    async def handler(request: httpx.Request) -> httpx.Response:
        return _streaming_response(frames)

    adapter = _llm_adapter(handler)
    result = await adapter.relay_chat_completion(
        route=_llm_route(),
        secret=_llm_secret(),
        context=_llm_context(stream=True),
        body=_llm_body(),
        headers={},
    )

    assert await _drain(result.body) == frames
    assert result.usage is not None and result.usage.input_tokens == 3


def test_short_values_are_not_scanned_for() -> None:
    """A value too short to identify anything would refuse responses over a coincidence."""
    from oss.src.core.gateways.dtos import injected_credential_values

    assert injected_credential_values({"Authorization": "Bearer ab"}) == ()
    assert injected_credential_values({"x-api-key": _PROVIDER_KEY}) == (
        _PROVIDER_KEY.encode(),
    )


def test_scanner_finds_a_value_split_across_three_chunks() -> None:
    from oss.src.core.gateways.dtos import CredentialEchoScanner

    scanner = CredentialEchoScanner([b"abcdefghij"])
    assert scanner.detects(b"xxabcd") is False
    assert scanner.detects(b"efg") is False
    assert scanner.detects(b"hijxx") is True


def test_relay_withholds_only_what_could_still_become_the_credential() -> None:
    """How many bytes are held, and why that is the right number: the longest suffix that
    is still a proper prefix of the value, and nothing else. Anything shorter relays a
    fragment that the next chunk completes; anything longer stalls a stream for bytes
    already proven innocent."""
    from oss.src.core.gateways.dtos import CredentialEchoDetected, CredentialEchoRelay

    relay = CredentialEchoRelay([b"abcdefghij"])

    # No suffix of this chunk begins the value, so nothing is held.
    assert relay.release(b"hello world") == b"hello world"
    assert relay.held == 0

    # The tail is nine of the ten bytes: held, and only those nine.
    assert relay.release(b"xx abcdefghi") == b"xx "
    assert relay.held == 9

    with pytest.raises(CredentialEchoDetected):
        relay.release(b"j and more")


def test_relay_releases_a_held_tail_when_it_turns_out_to_be_innocent() -> None:
    """A tail that never completes must still reach the caller, in the next chunk or at the
    end of the stream — otherwise the fix truncates every body ending in a near-miss."""
    from oss.src.core.gateways.dtos import CredentialEchoRelay

    relay = CredentialEchoRelay([b"abcdefghij"])

    assert relay.release(b"result: abcde") == b"result: "
    assert relay.held == 5
    # The next chunk disproves it; the held bytes go out with it, in order.
    assert relay.release(b"XYZ") == b"abcdeXYZ"
    assert relay.held == 0

    assert relay.release(b"trailing abc") == b"trailing "
    assert relay.flush() == b"abc"
    assert relay.held == 0
