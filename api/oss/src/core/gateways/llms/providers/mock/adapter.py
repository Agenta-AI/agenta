"""MockLLMAdapter: the in-process mock LLM upstream (entities.md §7.1, D23).

No socket, no process. Registered once, statically, under the "mock" adapter key
(wiring block, entities.md §9). Controllable behavior is keyed by `context.model`,
checked as a prefix so the base model name stays free-form:

    mock/echo         (default; any name matching no other suffix below)
    mock/error        raises LLMUpstreamError
    mock/slow-{n}     sleeps n seconds, then answers like mock/echo

The deployable app (app.py) calls this same adapter, so both tiers share one
implementation of the control convention.
"""

import asyncio
import json
import re
import time
import uuid
from typing import Any, AsyncIterator, Dict, Optional

from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMResolvedRoute
from oss.src.core.gateways.llms.interfaces import LLMRelayResult, LLMUpstreamInterface
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.policy.dtos import GatewayUsage, ResolvedSecret

_ERROR_PREFIX = "mock/error"
_SLOW_RE = re.compile(r"^mock/slow-(\d+)")


def _parse_slow_seconds(model: str) -> Optional[int]:
    match = _SLOW_RE.match(model)
    return int(match.group(1)) if match else None


def _last_message_content(body: bytes) -> str:
    try:
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        return ""

    messages = payload.get("messages") or []
    if not messages:
        return ""

    content = messages[-1].get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return str(content)


def _word_count(text: str) -> int:
    return len(text.split())


def _completion_payload(
    *, completion_id: str, created: int, model: str, content: str
) -> Dict[str, Any]:
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
    }


def _chunk_payload(
    *, completion_id: str, created: int, model: str, delta: Dict[str, Any], finish
) -> Dict[str, Any]:
    return {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }


def _sse(payload: Dict[str, Any]) -> bytes:
    return f"data: {json.dumps(payload)}\n\n".encode()


async def _empty_body() -> AsyncIterator[bytes]:
    return
    yield b""  # pragma: no cover — placeholder, makes this an async generator


class MockLLMAdapter(LLMUpstreamInterface):
    """The mock upstream (D23): unauthenticated, in-process, never opens a
    socket. `secret` may be None — targets with GatewayAuthScheme.NONE are
    the intended callers (entities.md §2)."""

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
        model = context.model

        if model.startswith(_ERROR_PREFIX):
            raise LLMUpstreamError(
                provider_key="mock", status_code=500, detail="forced by mock/error"
            )

        slow_seconds = _parse_slow_seconds(model)
        if slow_seconds is not None:
            await asyncio.sleep(slow_seconds)

        content = _last_message_content(body)
        input_tokens = _word_count(body.decode(errors="replace")) if body else 0
        output_tokens = _word_count(content)
        completion_id = f"chatcmpl-mock-{uuid.uuid4().hex}"
        created = int(time.time())

        result = LLMRelayResult(
            status_code=200,
            headers={
                "content-type": (
                    "text/event-stream" if context.stream else "application/json"
                )
            },
            body=_empty_body(),
        )

        async def _body_iter() -> AsyncIterator[bytes]:
            if context.stream:
                yield _sse(
                    _chunk_payload(
                        completion_id=completion_id,
                        created=created,
                        model=model,
                        delta={"role": "assistant", "content": content},
                        finish=None,
                    )
                )
                yield _sse(
                    _chunk_payload(
                        completion_id=completion_id,
                        created=created,
                        model=model,
                        delta={},
                        finish="stop",
                    )
                )
                yield b"data: [DONE]\n\n"
            else:
                payload = _completion_payload(
                    completion_id=completion_id,
                    created=created,
                    model=model,
                    content=content,
                )
                payload["usage"] = {
                    "prompt_tokens": input_tokens,
                    "completion_tokens": output_tokens,
                    "total_tokens": input_tokens + output_tokens,
                }
                yield json.dumps(payload).encode()

            result.usage = GatewayUsage(
                calls=1,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost=0.0,
            )

        result.body = _body_iter()
        return result
