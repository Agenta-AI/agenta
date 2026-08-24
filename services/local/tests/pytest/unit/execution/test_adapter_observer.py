"""Offline unit tests for the neutral-stream observer and deferred result semantics."""

import asyncio

import pytest
from agenta_local.core.execution.errors import ExecutionError
from agenta_local.execution.sdk.observer import observe_and_project, turn_result


async def _from_events(events):
    for event in events:
        yield event


async def _drain(frames):
    collected = []
    async for frame in frames:
        collected.append(frame)
    return collected


def _clean_text_events():
    return [
        {"type": "message_start", "data": {"id": "m1"}},
        {"type": "message_delta", "data": {"id": "m1", "delta": "Hello"}},
        {"type": "message_delta", "data": {"id": "m1", "delta": ", world."}},
        {"type": "message_end", "data": {"id": "m1"}},
        {"type": "done", "data": {"stopReason": "end_turn"}},
    ]


async def test_clean_stream_ends_with_finish_frames_and_correct_text():
    frames, observation = observe_and_project(_from_events(_clean_text_events()))

    collected = await _drain(frames)

    assert collected[0]["type"] == "start"
    assert collected[-2]["type"] == "finish-step"
    assert collected[-1]["type"] == "finish"
    assert collected[-1]["finishReason"] == "stop"
    result = await turn_result(observation)
    assert result.assistant_text == "Hello, world."
    assert observation.exhausted


async def test_injectable_projector_receives_neutral_events():
    async def echo_projector(events):
        count = 0
        async for event in events:
            yield {"type": f"echo-{event['type']}", "index": count}
            count += 1
        yield {"type": "echo-done"}

    frames, observation = observe_and_project(
        _from_events(_clean_text_events()), projector=echo_projector
    )

    collected = await _drain(frames)

    assert [frame["type"] for frame in collected] == [
        "echo-message_start",
        "echo-message_delta",
        "echo-message_delta",
        "echo-message_end",
        "echo-done",
        "echo-done",
    ]
    assert (await turn_result(observation)).assistant_text == "Hello, world."


async def test_neutral_error_event_fails_result_but_finish_frames_still_emitted():
    events = [
        {"type": "message", "data": {"text": "partial answer"}},
        {"type": "error", "data": {"message": "provider exploded"}},
    ]
    frames, observation = observe_and_project(_from_events(events))

    collected = await _drain(frames)

    # The projector closes its protocol with finish-step/finish even on error.
    assert collected[-2]["type"] == "finish-step"
    assert collected[-1]["type"] == "finish"
    types = [frame["type"] for frame in collected]
    assert "error" in types
    assert observation.error_event is True
    with pytest.raises(ExecutionError):
        await turn_result(observation)


async def test_source_exception_fails_result_but_finish_frames_still_emitted():
    async def raising_stream():
        yield {"type": "message", "data": {"text": "partial"}}
        raise RuntimeError("kaboom")

    frames, observation = observe_and_project(raising_stream())

    collected = await _drain(frames)

    assert collected[-2]["type"] == "finish-step"
    assert collected[-1]["type"] == "finish"
    assert isinstance(observation.source_exception, RuntimeError)
    with pytest.raises(ExecutionError) as excinfo:
        await turn_result(observation)
    assert excinfo.value.__cause__ is observation.source_exception


async def test_empty_clean_stream_yields_empty_text_per_fold_semantics():
    frames, observation = observe_and_project(_from_events([]))

    collected = await _drain(frames)

    # Zero content parts triggers the projector's no-output backstop error frames,
    # yet the run itself was clean: the result succeeds with empty text.
    types = [frame["type"] for frame in collected]
    assert types[-1] == "finish"
    assert "finish-step" in types
    assert "data-agent-error" in types
    assert (await turn_result(observation)).assistant_text == ""


async def test_closing_frames_closes_neutral_generator_and_fails_result():
    state = {"closed": False}

    async def endless_stream():
        try:
            index = 0
            while True:
                yield {
                    "type": "message_delta",
                    "data": {"id": "m", "delta": str(index)},
                }
                index += 1
                await asyncio.sleep(0)
        finally:
            state["closed"] = True

    frames, observation = observe_and_project(endless_stream())

    iterator = aiter(frames)
    # Consume past the projector's start/start-step preamble so the neutral
    # generator is actually suspended mid-iteration when we close.
    while (await anext(iterator))["type"] != "text-delta":
        pass
    await iterator.aclose()

    assert state["closed"] is True
    with pytest.raises(ExecutionError):
        await asyncio.wait_for(turn_result(observation), timeout=1)


async def test_cancelling_stream_consumption_fails_result_as_cancelled():
    async def hanging_stream():
        yield {"type": "message", "data": {"text": "partial"}}
        await asyncio.sleep(3600)

    frames, observation = observe_and_project(hanging_stream())

    consumer = asyncio.ensure_future(_drain(frames))
    await asyncio.sleep(0)
    consumer.cancel()
    with pytest.raises(asyncio.CancelledError):
        await consumer

    assert observation.cancelled is True
    with pytest.raises(ExecutionError):
        await asyncio.wait_for(turn_result(observation), timeout=1)
