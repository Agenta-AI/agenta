"""Relay LLM requests while preserving provider request and response bodies."""

import json
from collections import OrderedDict
from typing import Any, AsyncIterator, Dict, Optional, Tuple
from urllib.parse import urlparse

import httpx

from oss.src.core.gateways.cleanup import run_shielded
from oss.src.core.gateways.dtos import (
    CredentialEchoDetected,
    CredentialEchoRelay,
    CredentialEchoScanner,
    credential_echo_envelope,
    injected_credential_values,
    outbound_headers,
)
from oss.src.core.gateways.egress import (
    EgressRefusedError,
    EgressTarget,
    classify_transport_error,
    harden_pooled_client,
    open_egress,
)
from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import LLMRelayResult, LLMUpstreamInterface
from oss.src.core.gateways.llms.providers.passthrough.auth import build_auth_headers
from oss.src.core.gateways.llms.providers.passthrough.routing import build_url
from oss.src.core.gateways.llms.providers.passthrough.static_fields import (
    apply_static_fields,
)
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.policy.dtos import GatewayUsage, ResolvedSecret

# Default timeout for outbound LLM requests.
_DEFAULT_TIMEOUT_SECONDS = 60.0


class LLMUpstreamCredentialEchoError(LLMUpstreamError):
    """The upstream returned the credential the gateway sent it.

    An upstream that echoes the `Authorization` it received, which several providers do in
    an error body, hands Agenta's provider key to the sandbox. The decision is to refuse the
    response rather than redact it: a body that already contains the key cannot be trusted
    to contain it only once, and a caller reading a doctored body is worse off than a caller
    reading a refusal. The same refusal covers a credential returned in a response *header*,
    which the proxy copies onto Agenta's own response verbatim.

    An `LLMUpstreamError` so the existing boundary mapping still catches it; `envelope`
    carries the shared `{code, message, retryable, next_step, details}` refusal, with a
    `code` of its own so a harness can tell this apart from a plain upstream failure.
    """

    def __init__(self, *, provider_key: Optional[str], status_code: Optional[int]):
        self.envelope = credential_echo_envelope(target=provider_key)
        super().__init__(
            provider_key=provider_key,
            status_code=status_code,
            detail=self.envelope["message"],
        )


async def _outbound_target(
    *,
    url: str,
    headers: Dict[str, str],
    route: LLMResolvedRoute,
    secret: Optional[ResolvedSecret],
) -> Tuple[EgressTarget, Tuple[bytes, ...]]:
    """The checked, pinned target and the credential values its headers carry.

    Layered caller, then endpoint, then authentication, so what the gateway injects wins
    over anything the caller sent under the same name in any casing. The whole assembly
    goes through the shared egress boundary, which admits only the allowlisted caller
    headers and pins the connection to an address it checked (OD26).
    """
    auth_headers = await build_auth_headers(route, secret)
    target = await open_egress(
        url,
        caller_headers=headers,
        above_caller=outbound_headers(route.headers, auth_headers),
    )
    return target, injected_credential_values(auth_headers)


# Usage fields differ by protocol but are read without rewriting the response.
def _usage_from_payload(payload: Any, protocol: LLMProtocol) -> Optional[GatewayUsage]:
    if not isinstance(payload, dict):
        return None

    usage = payload.get("usage")
    if usage is None and protocol == LLMProtocol.RESPONSES:
        # A Responses stream's usage rides the terminal `response.completed` event,
        # nested under `response` rather than at the frame's top level.
        response = payload.get("response")
        usage = response.get("usage") if isinstance(response, dict) else None
    if usage is None and protocol == LLMProtocol.MESSAGES:
        # A Messages stream splits its usage in two: `message_start`, the FIRST frame,
        # carries the input tokens inside the message object, and `message_delta`, near
        # the end, carries the output tokens at the frame's top level. Neither frame on
        # its own is the call's usage (OR49).
        message = payload.get("message")
        usage = message.get("usage") if isinstance(message, dict) else None

    if not isinstance(usage, dict):
        return None

    if protocol == LLMProtocol.CHAT_COMPLETIONS:
        return GatewayUsage(
            calls=1,
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
        )
    return GatewayUsage(
        calls=1,
        input_tokens=usage.get("input_tokens"),
        output_tokens=usage.get("output_tokens"),
    )


def _merge_usage(
    base: Optional[GatewayUsage], later: Optional[GatewayUsage]
) -> Optional[GatewayUsage]:
    """One call's usage, assembled from however many frames carried a piece of it.

    Field by field, the later value wins where it has one. That is what turns Anthropic's
    head-and-tail split into a single record, and it leaves a protocol that sends its usage
    whole, in one frame, with exactly that frame's numbers.
    """
    if later is None:
        return base
    if base is None:
        return later
    return GatewayUsage(
        calls=1,
        input_tokens=later.input_tokens
        if later.input_tokens is not None
        else base.input_tokens,
        output_tokens=later.output_tokens
        if later.output_tokens is not None
        else base.output_tokens,
        cost=later.cost if later.cost is not None else base.cost,
    )


def _usage_from_body(content: bytes, protocol: LLMProtocol) -> Optional[GatewayUsage]:
    try:
        payload: Any = json.loads(content) if content else None
    except (json.JSONDecodeError, TypeError):
        return None
    return _usage_from_payload(payload, protocol)


# How much of a single SSE frame the reader will hold while it waits for the newline that
# ends it. The cap bounds the READER only — every byte is relayed as it arrives either way.
# A Responses `response.completed` frame carries the whole response object, so it is
# generous; a frame past it is relayed and left unread.
_MAX_FRAME_BYTES = 1_048_576


def _frame_payload(line: bytes) -> Any:
    """The JSON object an SSE `data:` line carries, or None when it carries none."""
    stripped = line.strip()
    if not stripped.startswith(b"data:"):
        return None
    chunk = stripped[len(b"data:") :].strip()
    if not chunk or chunk == b"[DONE]":
        return None
    try:
        return json.loads(chunk)
    except (json.JSONDecodeError, TypeError):
        return None


class _StreamUsageReader:
    """Read usage out of a relayed SSE stream without touching a byte of it.

    Frames are read forward, as they pass, rather than out of a buffered tail. A tail never
    held the whole story: Anthropic's input-token count arrives in `message_start`, the
    first frame of the stream, and a Responses `response.completed` frame can be larger on
    its own than any tail worth keeping (OR49).

    Reading only, never rewriting: the relay hands the caller the upstream's own bytes, in
    the upstream's own chunks, and this reads a copy of them on the way past. A stream that
    reports no usage leaves `usage` as None, which is not the same record as a call that
    reported zero.
    """

    def __init__(self, protocol: LLMProtocol) -> None:
        self._protocol = protocol
        self._buffer = b""
        self.usage: Optional[GatewayUsage] = None

    def feed(self, chunk: bytes) -> None:
        """Read `chunk` for usage. The chunk itself is relayed by the caller, untouched."""
        self._buffer += chunk
        while True:
            if len(self._buffer) > _MAX_FRAME_BYTES:
                # Longer than any frame this reader can use, so stop holding it.
                self._buffer = b""
                break
            end = self._buffer.find(b"\n")
            if end < 0:
                break
            line, self._buffer = self._buffer[: end + 1], self._buffer[end + 1 :]
            self._read(line)

    def flush(self) -> None:
        """Read the last line of a stream that ended without a newline."""
        if not self._buffer:
            return
        line, self._buffer = self._buffer, b""
        self._read(line)

    def _read(self, line: bytes) -> None:
        usage = _usage_from_payload(_frame_payload(line), self._protocol)
        if usage is not None:
            self.usage = _merge_usage(self.usage, usage)


# How many per-origin clients the adapter keeps. Origins come from tenant-registered URLs,
# so the map cannot be unbounded; past this the least recently used entry is dropped.
_MAX_POOLED_CLIENTS = 64


def _pool_origin(url: str) -> str:
    """The identity a connection may be reused under: scheme, host and port, lowercased."""
    parsed = urlparse(url)
    scheme = (parsed.scheme or "").lower()
    host = (parsed.hostname or "").lower()
    port = parsed.port or (443 if scheme == "https" else 80)
    return f"{scheme}://{host}:{port}"


class RelayLLMAdapter(LLMUpstreamInterface):
    """Relay requests with routing and authentication while preserving bodies.

    Clients are pooled rather than opened per call: a streaming response keeps its client
    alive past this method's return, so a client opened and closed around one call would cut
    the stream. They are pooled **one per registered origin**, not one for the adapter.

    One client for everything was wrong once the egress guard began pinning (OD26). Pinning
    rewrites the URL's host to the literal address it checked, and httpcore keys connection
    reuse on that rewritten origin (`AsyncConnectionPool._assign_requests_to_connections` ->
    `AsyncHTTPConnection.can_handle_request`, which compares only scheme/host/port).
    `sni_hostname` rides in the request extensions and is read at handshake time only, so it
    never reaches the pool key. Two tenants whose hostnames resolve to one address therefore
    shared a single TLS connection, and the second tenant's provider key travelled over a
    connection opened, and certificate-checked, for the first tenant's hostname.

    Keying the map on the ORIGINAL origin restores that identity: connection reuse is a
    per-origin concept to begin with, so nothing is lost by partitioning on it. An evicted
    entry is dropped, never closed, because a response streaming from it is still being read;
    its connections retire on their own once the last reader is finished.
    """

    def __init__(self, *, client: Optional[httpx.AsyncClient] = None) -> None:
        # A caller (every test) passes a client to install its transport. Only the transport
        # is adopted: the adapter has to own its clients to key them by origin.
        self._transport: Optional[httpx.AsyncBaseTransport] = getattr(
            client, "_transport", None
        )
        self._clients: "OrderedDict[str, httpx.AsyncClient]" = OrderedDict()

    def _client_for(self, origin: str) -> httpx.AsyncClient:
        existing = self._clients.get(origin)
        if existing is not None:
            self._clients.move_to_end(origin)
            return existing

        # Each pooled client is shared by every tenant reaching this origin, so it must hold
        # no cookie jar (an upstream `Set-Cookie` would otherwise be stored here and replayed
        # on the next tenant's call) and must not follow a redirect to a host nothing checked.
        client = harden_pooled_client(httpx.AsyncClient(transport=self._transport))
        self._clients[origin] = client
        while len(self._clients) > _MAX_POOLED_CLIENTS:
            self._clients.popitem(last=False)
        return client

    async def relay_chat_completion(
        self,
        *,
        route: LLMResolvedRoute,
        secret: Optional[ResolvedSecret],
        #
        context: LLMCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> LLMRelayResult:
        url = build_url(route, context.protocol, stream=context.stream)
        body = apply_static_fields(
            deployment_kind=route.deployment_kind,
            protocol=context.protocol,
            body=body,
        )
        try:
            target, injected_secrets = await _outbound_target(
                url=url, headers=headers, route=route, secret=secret
            )
        except EgressRefusedError as exc:
            raise LLMUpstreamError(
                provider_key=route.provider_key,
                status_code=None,
                detail=exc.relay_detail,
            ) from exc
        scanner = CredentialEchoScanner(injected_secrets)
        timeout = (
            route.settings.timeout_seconds
            if route.settings.timeout_seconds is not None
            else _DEFAULT_TIMEOUT_SECONDS
        )

        client = self._client_for(_pool_origin(target.original_url or url))
        request = client.build_request(
            "POST",
            target.url,
            content=body,
            headers=target.headers,
            timeout=timeout,
            extensions=target.extensions,
        )

        try:
            response = await client.send(request, stream=True)
        except httpx.TimeoutException as exc:
            raise LLMUpstreamError(
                provider_key=route.provider_key,
                status_code=None,
                detail="upstream timed out",
            ) from exc
        except httpx.RequestError as exc:
            # The provider key is in these headers, and a refusal raised while building
            # the request quotes them (OR86).
            failure = classify_transport_error(exc)
            raise LLMUpstreamError(
                provider_key=route.provider_key,
                status_code=None,
                detail=failure.detail,
            ) from exc
        except httpx.HTTPError as exc:
            raise LLMUpstreamError(
                provider_key=route.provider_key,
                status_code=None,
                detail="The gateway could not complete the request to the upstream.",
            ) from exc

        # Before either response shape is built, and before the error path reads a body: the
        # header block is relayed too (`apis/fastapi/gateways/utils.py::response_headers`
        # strips only hop-by-hop names and `set-cookie`), so an upstream answering 200 with
        # the key in a header of its own discloses it without the body ever carrying it.
        if scanner.detects_headers(response.headers):
            await response.aclose()
            raise LLMUpstreamCredentialEchoError(
                provider_key=route.provider_key,
                status_code=response.status_code,
            )

        if response.status_code >= 500:
            content = await response.aread()
            await response.aclose()
            if scanner.detects(content):
                raise LLMUpstreamCredentialEchoError(
                    provider_key=route.provider_key,
                    status_code=response.status_code,
                )
            raise LLMUpstreamError(
                provider_key=route.provider_key,
                status_code=response.status_code,
                detail=content.decode(errors="replace"),
            )

        result = LLMRelayResult(
            status_code=response.status_code,
            headers=dict(response.headers),
            body=_empty_body(),
        )
        result.body = (
            self._stream_body(
                response=response,
                result=result,
                protocol=context.protocol,
                scanner=scanner,
                provider_key=route.provider_key,
            )
            if context.stream
            else self._single_chunk_body(
                response=response,
                result=result,
                protocol=context.protocol,
                scanner=scanner,
                provider_key=route.provider_key,
            )
        )
        return result

    @staticmethod
    async def _single_chunk_body(
        *,
        response: httpx.Response,
        result: LLMRelayResult,
        protocol: LLMProtocol,
        scanner: CredentialEchoScanner,
        provider_key: Optional[str],
    ) -> AsyncIterator[bytes]:
        try:
            content = await response.aread()
            if scanner.detects(content):
                raise LLMUpstreamCredentialEchoError(
                    provider_key=provider_key, status_code=response.status_code
                )
            yield content
            result.usage = _usage_from_body(content, protocol)
        finally:
            # Shielded for the reason given on `_stream_body` (OR48).
            await run_shielded(response.aclose())

    @staticmethod
    async def _stream_body(
        *,
        response: httpx.Response,
        result: LLMRelayResult,
        protocol: LLMProtocol,
        scanner: CredentialEchoScanner,
        provider_key: Optional[str],
    ) -> AsyncIterator[bytes]:
        # Preserve upstream SSE chunk boundaries while reading usage out of the frames as
        # they pass — the reader takes a copy, and relays nothing of its own. Bytes reach
        # the caller only once they cannot still begin the credential
        # (`CredentialEchoRelay`), so a value split across two chunks is withheld rather
        # than yielded and regretted: noticing the split after the first half has left the
        # generator leaves the caller holding all but the last byte of the key.
        relay = CredentialEchoRelay(scanner.secrets)
        reader = _StreamUsageReader(protocol)
        try:
            async for chunk in response.aiter_bytes():
                try:
                    safe = relay.release(chunk)
                except CredentialEchoDetected as exc:
                    raise LLMUpstreamCredentialEchoError(
                        provider_key=provider_key, status_code=response.status_code
                    ) from exc
                if not safe:
                    continue
                reader.feed(safe)
                yield safe
            # A prefix that reached the end of the body never completed into the credential.
            remainder = relay.flush()
            if remainder:
                reader.feed(remainder)
                yield remainder
            # A stream whose last frame ended without a newline still carries usage.
            reader.flush()
        finally:
            result.usage = reader.usage or result.usage
            # A client that disconnects mid-stream cancels this task, and a bare `await`
            # in a `finally` under cancellation raises before it runs: the upstream
            # response stayed open and its connection leaked until the pool timed it out
            # (OR48). Shielded, the close completes; the cancellation still propagates.
            await run_shielded(response.aclose())


async def _empty_body() -> AsyncIterator[bytes]:
    return
    yield b""  # pragma: no cover — placeholder, makes this an async generator
