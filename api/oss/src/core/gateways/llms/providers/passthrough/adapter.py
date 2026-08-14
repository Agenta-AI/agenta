"""PassthroughLLMAdapter: the byte-for-byte OpenAI-compatible south port
(entities.md §7.1).

For upstreams that speak the caller's own protocol (`deployment_kind=custom`, and direct
providers whose API is OpenAI-shaped). The request `body` travels to the upstream
untouched — no `json.loads`/`json.dumps` round trip on it anywhere in this file — which is
what keeps upstream prompt caching working (`scope-checklist.md`). The response body is
read only to lift a `usage` field for the audit record; the bytes handed back to the
caller are never reconstructed from that parse.
"""

import json
from typing import Any, AsyncIterator, Dict, Optional

import httpx

from oss.src.core.gateways.dtos import GATEWAY_ONLY_HEADERS
from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMResolvedRoute
from oss.src.core.gateways.llms.interfaces import LLMRelayResult, LLMUpstreamInterface
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.policy.dtos import GatewayUsage, ResolvedSecret
from oss.src.core.secrets.enums import SecretKind

# No document pins a default (specs-wp6.md: "Missing from the design, needs a ruling").
# 60s matches the outbound timeout core/workflows/service.py already uses for its own
# httpx calls (_post_service_json) — this package's own call, not a transcribed number.
_DEFAULT_TIMEOUT_SECONDS = 60.0

_CHAT_COMPLETIONS_PATH = "/chat/completions"

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


def _build_url(route: LLMResolvedRoute) -> str:
    if not route.base_url:
        raise LLMUpstreamError(
            provider_key=route.provider_key,
            status_code=None,
            detail="route has no base_url for the passthrough adapter",
        )
    return route.base_url.rstrip("/") + _CHAT_COMPLETIONS_PATH


def _outbound_headers(
    *,
    headers: Dict[str, str],
    route: LLMResolvedRoute,
    secret: Optional[ResolvedSecret],
) -> Dict[str, str]:
    outbound = {k: v for k, v in headers.items() if k.lower() not in _STRIPPED_HEADERS}

    if route.headers:
        outbound.update(route.headers)

    if secret is not None:
        secret = secret.secret
        key: Optional[str] = None

        # Dispatch on kind (`secrets.md`, mirrored from the SDK's own settings
        # builder) — the adapter, not the resolver, knows which fields it needs.
        if secret.kind == SecretKind.PROVIDER_KEY:
            key = secret.data.provider.key
        elif secret.kind == SecretKind.CUSTOM_PROVIDER:
            key = secret.data.provider.key
            extras = secret.data.provider.extras
            if extras:
                outbound.update({str(k): str(v) for k, v in extras.items()})

        if key:
            outbound["Authorization"] = f"Bearer {key}"

    return outbound


# Enough to hold the last SSE frames; the usage frame is the final data frame the
# OpenAI stream sends before [DONE].
_USAGE_TAIL_BYTES = 8192


def _usage_from_stream_tail(tail: bytes) -> Optional[GatewayUsage]:
    for line in reversed(tail.split(b"\n")):
        line = line.strip()
        if not line.startswith(b"data:"):
            continue
        payload = line[len(b"data:") :].strip()
        if payload == b"[DONE]":
            continue
        usage = _usage_from_body(payload)
        if usage is not None:
            return usage
    return None


def _usage_from_body(content: bytes) -> Optional[GatewayUsage]:
    try:
        payload: Any = json.loads(content) if content else None
    except (json.JSONDecodeError, TypeError):
        return None

    usage = payload.get("usage") if isinstance(payload, dict) else None
    if not isinstance(usage, dict):
        return None

    return GatewayUsage(
        calls=1,
        input_tokens=usage.get("prompt_tokens"),
        output_tokens=usage.get("completion_tokens"),
    )


class PassthroughLLMAdapter(LLMUpstreamInterface):
    """Relays to an OpenAI-compatible upstream with the body forwarded verbatim
    and only authorization injected. One `httpx.AsyncClient` per adapter
    instance, reused across calls (connection pooling; a streaming response
    keeps the client alive past this method's return, so it cannot be opened
    and closed per call)."""

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
        url = _build_url(route)
        outbound_headers = _outbound_headers(
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
            self._stream_body(response=response, result=result)
            if context.stream
            else self._single_chunk_body(response=response, result=result)
        )
        return result

    @staticmethod
    async def _single_chunk_body(
        *, response: httpx.Response, result: LLMRelayResult
    ) -> AsyncIterator[bytes]:
        try:
            content = await response.aread()
            yield content
            result.usage = _usage_from_body(content)
        finally:
            await response.aclose()

    @staticmethod
    async def _stream_body(
        *, response: httpx.Response, result: LLMRelayResult
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
            result.usage = _usage_from_stream_tail(tail) or result.usage
            await response.aclose()


async def _empty_body() -> AsyncIterator[bytes]:
    return
    yield b""  # pragma: no cover — placeholder, makes this an async generator
