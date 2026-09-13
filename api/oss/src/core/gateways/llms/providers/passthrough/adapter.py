"""Relay LLM requests while preserving provider request and response bodies."""

import json
from typing import Any, AsyncIterator, Dict, Optional, Tuple

import httpx

from oss.src.core.gateways.dtos import (
    CredentialEchoScanner,
    credential_echo_envelope,
    injected_credential_values,
    outbound_headers,
)
from oss.src.core.gateways.egress import (
    EgressRefusedError,
    EgressTarget,
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
    reading a refusal.

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


# Enough to hold the last SSE frames; the usage frame is the final data frame before the
# stream's own terminator (`[DONE]` for Chat Completions, `message_stop`/`response.completed`
# for the other two).
_USAGE_TAIL_BYTES = 8192


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


def _usage_from_stream_tail(
    tail: bytes, protocol: LLMProtocol
) -> Optional[GatewayUsage]:
    for line in reversed(tail.split(b"\n")):
        line = line.strip()
        if not line.startswith(b"data:"):
            continue
        chunk = line[len(b"data:") :].strip()
        if chunk == b"[DONE]":
            continue
        try:
            payload = json.loads(chunk) if chunk else None
        except (json.JSONDecodeError, TypeError):
            continue
        usage = _usage_from_payload(payload, protocol)
        if usage is not None:
            return usage
    return None


def _usage_from_body(content: bytes, protocol: LLMProtocol) -> Optional[GatewayUsage]:
    try:
        payload: Any = json.loads(content) if content else None
    except (json.JSONDecodeError, TypeError):
        return None
    return _usage_from_payload(payload, protocol)


class RelayLLMAdapter(LLMUpstreamInterface):
    """Relay requests with routing and authentication while preserving bodies. One `httpx.AsyncClient`
    per adapter instance, reused across calls (connection pooling; a streaming response
    keeps the client alive past this method's return, so it cannot be opened and closed
    per call)."""

    def __init__(self, *, client: Optional[httpx.AsyncClient] = None) -> None:
        self._client = client or httpx.AsyncClient()
        # The pooled client is shared by every tenant, so it must hold no cookie jar (an
        # upstream `Set-Cookie` would otherwise be stored here and replayed on the next
        # tenant's call) and must not follow a redirect to a host nothing checked.
        harden_pooled_client(self._client)

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

        request = self._client.build_request(
            "POST",
            target.url,
            content=body,
            headers=target.headers,
            timeout=timeout,
            extensions=target.extensions,
        )

        try:
            response = await self._client.send(request, stream=True)
        except httpx.TimeoutException as exc:
            raise LLMUpstreamError(
                provider_key=route.provider_key,
                status_code=None,
                detail="upstream timed out",
            ) from exc
        except httpx.HTTPError as exc:
            raise LLMUpstreamError(
                provider_key=route.provider_key,
                status_code=None,
                detail=str(exc),
            ) from exc

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
            await response.aclose()

    @staticmethod
    async def _stream_body(
        *,
        response: httpx.Response,
        result: LLMRelayResult,
        protocol: LLMProtocol,
        scanner: CredentialEchoScanner,
        provider_key: Optional[str],
    ) -> AsyncIterator[bytes]:
        # Preserve upstream SSE chunk boundaries while extracting trailing usage. Each chunk
        # is checked before it is yielded, so a credential never leaves this generator, and
        # the scanner carries a tail between chunks so a split value is still caught.
        tail = b""
        try:
            async for chunk in response.aiter_bytes():
                if scanner.detects(chunk):
                    raise LLMUpstreamCredentialEchoError(
                        provider_key=provider_key, status_code=response.status_code
                    )
                tail = (tail + chunk)[-_USAGE_TAIL_BYTES:]
                yield chunk
        finally:
            result.usage = _usage_from_stream_tail(tail, protocol) or result.usage
            await response.aclose()


async def _empty_body() -> AsyncIterator[bytes]:
    return
    yield b""  # pragma: no cover — placeholder, makes this an async generator
