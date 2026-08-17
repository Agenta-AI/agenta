"""RelayLLMAdapter: the one south-port relay (D34, entities.md §7.1).

D34 forbids body conversion, so there is one relay for every deployment kind — the
`passthrough`/`translated` split it replaces. `routing.py` composes the URL from route
fields; `auth.py` presents the secret. Neither ever parses `body`. The response body is read
only to lift `usage` for the audit record; the bytes handed back to the caller are never
reconstructed from that parse.

D40 amends D34 with one bounded exception: `static_fields.py`'s literal per-deployment table,
applied to the request body immediately before it is sent, for Vertex only (OD19 moved
Bedrock's Messages door to `bedrock-mantle`, which needs no rewrite). Every other
deployment's request body still travels untouched.
"""

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

# No document pins a default (specs-wp6.md: "Missing from the design, needs a ruling").
# 60s matches the outbound timeout core/workflows/service.py already uses for its own
# httpx calls (_post_service_json) — this package's own call, not a transcribed number.
_DEFAULT_TIMEOUT_SECONDS = 60.0

# Stripped from the outbound header set: hop-by-hop headers (RFC 7230 §6.1) plus our own
# credentials header. A caller's `Authorization` is forwarded and overwritten below only
# when a secret resolved — pass-through is what happens when nothing overwrites (OD15).
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


# Chat Completions names token counts `prompt_tokens`/`completion_tokens`; Responses and
# Messages both name them `input_tokens`/`output_tokens` (D33, WP23) — the one place this
# adapter branches on protocol, and only to read, never to rewrite.
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
    """Relays to any upstream a front door's protocol reaches (OD16), with the body
    forwarded verbatim and only routing/authentication applied. One `httpx.AsyncClient`
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
        # SSE chunk boundaries pass through as httpx yields them — never
        # recombined or re-chunked (specs-wp6.md). Chunks are only inspected for the
        # trailing usage frame; what is yielded is always the original bytes.
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
