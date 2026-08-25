"""In-process mock LLM upstream.

No socket, no process. Registered once, statically, under the "mock" adapter key
Controllable behavior is keyed by `context.model`,
checked as a prefix so the base model name stays free-form:

    mock/echo         (default; any name matching no other suffix below)
    mock/error        raises LLMUpstreamError
    mock/slow-{n}     sleeps n seconds, then answers like mock/echo

`context.protocol` picks the response shape — Chat Completions, OpenAI
Responses or Anthropic Messages — so the three front doors each have something protocol-
shaped to relay in tests, without any of this adapter's logic branching on the door that
called it beyond this one dispatch.

The deployable app (app.py) calls this same adapter, so both tiers share one
implementation of the control convention.
"""

import asyncio
import json
import re
import time
import uuid
from typing import Any, AsyncIterator, Dict, Optional

from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMProtocol,
    LLMResolvedRoute,
)
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

    # "messages" (Chat Completions, Messages) or "input" (Responses) — same shape,
    # different field name on the wire.
    messages = payload.get("messages") or payload.get("input") or []
    if isinstance(messages, str):
        return messages
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


def _responses_payload(
    *, response_id: str, created: int, model: str, content: str
) -> Dict[str, Any]:
    return {
        "id": response_id,
        "object": "response",
        "created_at": created,
        "model": model,
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": content}],
            }
        ],
    }


def _messages_payload(*, message_id: str, model: str, content: str) -> Dict[str, Any]:
    return {
        "id": message_id,
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": content}],
        "stop_reason": "end_turn",
    }


def _sse(payload: Dict[str, Any]) -> bytes:
    return f"data: {json.dumps(payload)}\n\n".encode()


def _sse_event(event: str, payload: Dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n".encode()


async def _empty_body() -> AsyncIterator[bytes]:
    return
    yield b""  # pragma: no cover — placeholder, makes this an async generator


class MockLLMAdapter(LLMUpstreamInterface):
    """Unauthenticated, in-process mock upstream that never opens a
    socket. `secret` may be None — targets with GatewayAuthScheme.NONE are
    the intended callers."""

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
            if context.protocol == LLMProtocol.RESPONSES:
                usage = {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": input_tokens + output_tokens,
                }
                if context.stream:
                    sequence_number = 0

                    def _responses_event(event: str, payload: Dict[str, Any]) -> bytes:
                        nonlocal sequence_number
                        framed = _sse_event(
                            event, {"sequence_number": sequence_number, **payload}
                        )
                        sequence_number += 1
                        return framed

                    response = {
                        "id": completion_id,
                        "object": "response",
                        "created_at": created,
                        "model": model,
                        "status": "in_progress",
                        "output": [],
                    }
                    item = {
                        "id": f"msg-mock-{uuid.uuid4().hex}",
                        "type": "message",
                        "status": "in_progress",
                        "role": "assistant",
                        "content": [],
                    }
                    part = {"type": "output_text", "text": "", "annotations": []}
                    completed_part = {
                        "type": "output_text",
                        "text": content,
                        "annotations": [],
                    }
                    completed_item = {
                        **item,
                        "status": "completed",
                        "content": [completed_part],
                    }
                    yield _responses_event(
                        "response.created",
                        {"type": "response.created", "response": response},
                    )
                    yield _responses_event(
                        "response.in_progress",
                        {"type": "response.in_progress", "response": response},
                    )
                    yield _responses_event(
                        "response.output_item.added",
                        {
                            "type": "response.output_item.added",
                            "output_index": 0,
                            "item": item,
                        },
                    )
                    yield _responses_event(
                        "response.content_part.added",
                        {
                            "type": "response.content_part.added",
                            "item_id": item["id"],
                            "output_index": 0,
                            "content_index": 0,
                            "part": part,
                        },
                    )
                    yield _responses_event(
                        "response.output_text.delta",
                        {
                            "type": "response.output_text.delta",
                            "item_id": item["id"],
                            "output_index": 0,
                            "content_index": 0,
                            "delta": content,
                            "logprobs": [],
                        },
                    )
                    yield _responses_event(
                        "response.output_text.done",
                        {
                            "type": "response.output_text.done",
                            "item_id": item["id"],
                            "output_index": 0,
                            "content_index": 0,
                            "text": content,
                            "logprobs": [],
                        },
                    )
                    yield _responses_event(
                        "response.content_part.done",
                        {
                            "type": "response.content_part.done",
                            "item_id": item["id"],
                            "output_index": 0,
                            "content_index": 0,
                            "part": completed_part,
                        },
                    )
                    yield _responses_event(
                        "response.output_item.done",
                        {
                            "type": "response.output_item.done",
                            "output_index": 0,
                            "item": completed_item,
                        },
                    )
                    completed = _responses_payload(
                        response_id=completion_id,
                        created=created,
                        model=model,
                        content=content,
                    )
                    completed["usage"] = usage
                    completed["status"] = "completed"
                    yield _responses_event(
                        "response.completed",
                        {"type": "response.completed", "response": completed},
                    )
                else:
                    payload = _responses_payload(
                        response_id=completion_id,
                        created=created,
                        model=model,
                        content=content,
                    )
                    payload["usage"] = usage
                    yield json.dumps(payload).encode()

            elif context.protocol == LLMProtocol.MESSAGES:
                usage = {"input_tokens": input_tokens, "output_tokens": output_tokens}
                if context.stream:
                    message = {
                        "id": completion_id,
                        "type": "message",
                        "role": "assistant",
                        "model": model,
                        "content": [],
                        "stop_reason": None,
                        "stop_sequence": None,
                        "usage": {"input_tokens": input_tokens, "output_tokens": 0},
                    }
                    block = {"type": "text", "text": ""}
                    yield _sse_event(
                        "message_start", {"type": "message_start", "message": message}
                    )
                    yield _sse_event(
                        "content_block_start",
                        {
                            "type": "content_block_start",
                            "index": 0,
                            "content_block": block,
                        },
                    )
                    yield _sse_event(
                        "content_block_delta",
                        {
                            "type": "content_block_delta",
                            "delta": {"type": "text_delta", "text": content},
                        },
                    )
                    yield _sse_event(
                        "content_block_stop", {"type": "content_block_stop", "index": 0}
                    )
                    yield _sse_event(
                        "message_delta",
                        {
                            "type": "message_delta",
                            "delta": {"stop_reason": "end_turn"},
                            "usage": usage,
                        },
                    )
                    yield _sse_event("message_stop", {"type": "message_stop"})
                else:
                    payload = _messages_payload(
                        message_id=completion_id, model=model, content=content
                    )
                    payload["usage"] = usage
                    yield json.dumps(payload).encode()

            else:
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
