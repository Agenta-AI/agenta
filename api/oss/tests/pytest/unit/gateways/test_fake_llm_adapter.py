"""Unit tests for FakeLlmAdapter (entities.md §7.1, workstreams/specs-wp5.md).

Nothing running: the adapter is exercised as a plain Python object.
"""

import json
import time

import pytest

from oss.src.core.gateways.llms.dtos import (
    LlmCallContext,
    LlmDeploymentKind,
    LlmResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import LlmRelayResult
from oss.src.core.gateways.llms.providers.fake.adapter import FakeLlmAdapter
from oss.src.core.gateways.llms.types import LlmUpstreamError


def _route(model: str = "fake/echo") -> LlmResolvedRoute:
    return LlmResolvedRoute(
        provider_key="fake", deployment=LlmDeploymentKind.DIRECT, model=model
    )


def _body(content: str = "hello") -> bytes:
    return json.dumps(
        {"model": "fake/echo", "messages": [{"role": "user", "content": content}]}
    ).encode()


async def _drain(body):
    return [chunk async for chunk in body]


@pytest.mark.asyncio
async def test_echo_returns_well_formed_result():
    adapter = FakeLlmAdapter()
    result = await adapter.relay_chat_completion(
        route=_route(),
        credential=None,
        context=LlmCallContext(model="fake/echo"),
        body=_body("hello there"),
        headers={},
    )

    assert isinstance(result, LlmRelayResult)
    assert result.status_code == 200

    chunks = await _drain(result.body)
    assert len(chunks) == 1
    payload = json.loads(chunks[0])
    assert payload["choices"][0]["message"]["content"] == "hello there"
    assert payload["object"] == "chat.completion"


@pytest.mark.asyncio
async def test_error_model_raises_upstream_error():
    adapter = FakeLlmAdapter()

    with pytest.raises(LlmUpstreamError) as excinfo:
        await adapter.relay_chat_completion(
            route=_route("fake/error"),
            credential=None,
            context=LlmCallContext(model="fake/error"),
            body=_body(),
            headers={},
        )

    assert excinfo.value.provider_key == "fake"
    assert excinfo.value.status_code == 500


@pytest.mark.asyncio
async def test_slow_model_sleeps_before_returning():
    adapter = FakeLlmAdapter()
    start = time.monotonic()

    result = await adapter.relay_chat_completion(
        route=_route("fake/slow-1"),
        credential=None,
        context=LlmCallContext(model="fake/slow-1"),
        body=_body(),
        headers={},
    )
    elapsed = time.monotonic() - start

    assert elapsed >= 1
    assert result.status_code == 200
    await _drain(result.body)


@pytest.mark.asyncio
async def test_streaming_yields_multiple_chunks_ending_in_done():
    adapter = FakeLlmAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        credential=None,
        context=LlmCallContext(model="fake/echo", stream=True),
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
    adapter = FakeLlmAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        credential=None,
        context=LlmCallContext(model="fake/echo"),
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
