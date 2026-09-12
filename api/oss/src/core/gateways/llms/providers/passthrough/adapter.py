"""Relay LLM requests while preserving provider request and response bodies."""

import json
from typing import Any, AsyncIterator, Dict, Optional

import httpx

from oss.src.core.gateways.dtos import GATEWAY_ONLY_HEADERS
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

# Strip hop-by-hop and gateway-only headers before forwarding upstream.
_STRIPPED_HEADERS = {
    *GATEWAY_ONLY_HEADERS,
    "host",
    "content-length",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "te",
    "trailer",
    "upgrade",
    "proxy-authenticate",
    "proxy-authorization",
}


async def _outbound_headers(
    *,
    headers: Dict[str, str],
    route: LLMResolvedRoute,
    secret: Optional[ResolvedSecret],
) -> Dict[str, str]:
    outbound = {k: v for k, v in headers.items() if k.lower() not in _STRIPPED_HEADERS}
    if route.headers:
        outbound.update(route.headers)
    outbound.update(await build_auth_headers(route, secret))
    return outbound


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
        outbound_headers = await _outbound_headers(
            headers=headers, route=route, secret=secret
        )
        timeout = (
            route.settings.timeout_seconds
            if route.settings.timeout_seconds is not None
            else _DEFAULT_TIMEOUT_SECONDS
        )

        request = self._client.build_request(
            "POST", url, content=body, headers=outbound_headers, timeout=timeout
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
            detail = (await response.aread()).decode(errors="replace")
            await response.aclose()
            raise LLMUpstreamError(
                provider_key=route.provider_key,
                status_code=response.status_code,
                detail=detail,
            )

        result = LLMRelayResult(
            status_code=response.status_code,
            headers=dict(response.headers),
            body=_empty_body(),
        )
        result.body = (
            self._stream_body(
                response=response, result=result, protocol=context.protocol
            )
            if context.stream
            else self._single_chunk_body(
                response=response, result=result, protocol=context.protocol
            )
        )
        return result

    @staticmethod
    async def _single_chunk_body(
        *, response: httpx.Response, result: LLMRelayResult, protocol: LLMProtocol
    ) -> AsyncIterator[bytes]:
        try:
            content = await response.aread()
            yield content
            result.usage = _usage_from_body(content, protocol)
        finally:
            await response.aclose()

    @staticmethod
    async def _stream_body(
        *, response: httpx.Response, result: LLMRelayResult, protocol: LLMProtocol
    ) -> AsyncIterator[bytes]:
        # Preserve upstream SSE chunk boundaries while extracting trailing usage.
        tail = b""
        try:
            async for chunk in response.aiter_bytes():
                tail = (tail + chunk)[-_USAGE_TAIL_BYTES:]
                yield chunk
        finally:
            result.usage = _usage_from_stream_tail(tail, protocol) or result.usage
            await response.aclose()


async def _empty_body() -> AsyncIterator[bytes]:
    return
    yield b""  # pragma: no cover — placeholder, makes this an async generator
