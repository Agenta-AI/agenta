"""Unit tests for MockLLMAdapter (entities.md §7.1, workstreams/specs-wp5.md).

Nothing running: the adapter is exercised as a plain Python object.
"""

import json
import time

import pytest

from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import LLMRelayResult
from oss.src.core.gateways.llms.providers.mock.adapter import MockLLMAdapter
from oss.src.core.gateways.llms.types import LLMUpstreamError


def _route(model: str = "mock/echo") -> LLMResolvedRoute:
    return LLMResolvedRoute(
        provider_key="mock", deployment_kind=LLMDeploymentKind.DIRECT, model=model
    )


def _body(content: str = "hello") -> bytes:
    return json.dumps(
        {"model": "mock/echo", "messages": [{"role": "user", "content": content}]}
    ).encode()


async def _drain(body):
    return [chunk async for chunk in body]


@pytest.mark.asyncio
async def test_echo_returns_well_formed_result():
    adapter = MockLLMAdapter()
    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo"),
        body=_body("hello there"),
        headers={},
    )

    assert isinstance(result, LLMRelayResult)
    assert result.status_code == 200

    chunks = await _drain(result.body)
    assert len(chunks) == 1
    payload = json.loads(chunks[0])
    assert payload["choices"][0]["message"]["content"] == "hello there"
    assert payload["object"] == "chat.completion"


@pytest.mark.asyncio
async def test_error_model_raises_upstream_error():
    adapter = MockLLMAdapter()

    with pytest.raises(LLMUpstreamError) as excinfo:
        await adapter.relay_chat_completion(
            route=_route("mock/error"),
            secret=None,
            context=LLMCallContext(model="mock/error"),
            body=_body(),
            headers={},
        )

    assert excinfo.value.provider_key == "mock"
    assert excinfo.value.status_code == 500


@pytest.mark.asyncio
async def test_slow_model_sleeps_before_returning():
    adapter = MockLLMAdapter()
    start = time.monotonic()

    result = await adapter.relay_chat_completion(
        route=_route("mock/slow-1"),
        secret=None,
        context=LLMCallContext(model="mock/slow-1"),
        body=_body(),
        headers={},
    )
    elapsed = time.monotonic() - start

    assert elapsed >= 1
    assert result.status_code == 200
    await _drain(result.body)


@pytest.mark.asyncio
async def test_streaming_yields_multiple_chunks_ending_in_done():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", stream=True),
        body=_body("hi"),
        headers={},
    )

    chunks = await _drain(result.body)
    assert len(chunks) > 1
    assert chunks[-1] == b"data: [DONE]\n\n"
    for chunk in chunks[:-1]:
        assert chunk.startswith(b"data: ")


@pytest.mark.asyncio
async def test_usage_populated_after_body_exhausted():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo"),
        body=_body("hello world"),
        headers={},
    )
    assert result.usage is None

    await _drain(result.body)

    assert result.usage is not None
    assert result.usage.calls == 1
    assert result.usage.cost == 0.0
    assert result.usage.input_tokens is not None
    assert result.usage.output_tokens is not None


# --- protocol-shaped bodies (D33, WP23) --------------------------------------- #


@pytest.mark.asyncio
async def test_responses_non_streaming_body_and_usage():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.RESPONSES),
        body=_body("hello there"),
        headers={},
    )

    chunks = await _drain(result.body)
    payload = json.loads(chunks[0])
    assert payload["object"] == "response"
    assert payload["output"][0]["content"][0]["text"] == "hello there"
    assert payload["usage"]["output_tokens"] == result.usage.output_tokens


@pytest.mark.asyncio
async def test_responses_streaming_ends_with_a_completed_frame_carrying_usage():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(
            model="mock/echo", stream=True, protocol=LLMProtocol.RESPONSES
        ),
        body=_body("hi"),
        headers={},
    )

    chunks = await _drain(result.body)
    frames = [json.loads(chunk.split(b"data: ", 1)[1]) for chunk in chunks]
    assert [frame["sequence_number"] for frame in frames] == list(range(len(frames)))
    assert [frame["type"] for frame in frames] == [
        "response.created",
        "response.in_progress",
        "response.output_item.added",
        "response.content_part.added",
        "response.output_text.delta",
        "response.output_text.done",
        "response.content_part.done",
        "response.output_item.done",
        "response.completed",
    ]
    text_delta = next(
        frame for frame in frames if frame["type"] == "response.output_text.delta"
    )
    assert text_delta["logprobs"] == []
    assert chunks[-1].startswith(b"event: response.completed\n")
    final = json.loads(chunks[-1].split(b"data: ", 1)[1])
    assert final["response"]["usage"]["output_tokens"] == result.usage.output_tokens


@pytest.mark.asyncio
async def test_messages_non_streaming_body_and_usage():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.MESSAGES),
        body=_body("hello there"),
        headers={},
    )

    chunks = await _drain(result.body)
    payload = json.loads(chunks[0])
    assert payload["type"] == "message"
    assert payload["content"][0]["text"] == "hello there"
    assert payload["usage"]["output_tokens"] == result.usage.output_tokens


@pytest.mark.asyncio
async def test_messages_streaming_ends_with_message_stop_and_usage_on_message_delta():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(
            model="mock/echo", stream=True, protocol=LLMProtocol.MESSAGES
        ),
        body=_body("hi"),
        headers={},
    )

    chunks = await _drain(result.body)
    assert chunks[-1].startswith(b"event: message_stop\n")
    delta_frame = next(c for c in chunks if c.startswith(b"event: message_delta\n"))
    payload = json.loads(delta_frame.split(b"data: ", 1)[1])
    assert payload["usage"]["output_tokens"] == result.usage.output_tokens
