"""
Unit tests for the mock_v0 workflow (agenta:custom:mock:v0).

mock_v0 is a deterministic, LLM-free, sandbox-free workflow used by evaluation
flow tests. It stands in for BOTH an application (invocation step, returns
outputs) and an evaluator (annotation step, returns {"score", "success"}). The
behavior is selected by name via parameters = {"key": ..., "kwargs": {...}}.

async handlers are called via asyncio.run() so no pytest-asyncio marker is
needed. The @instrument() decorator is bypassed via __wrapped__.
"""

import asyncio

import pytest

from agenta.sdk.workflows.errors import (
    MockV0Error,
    InvalidConfigurationParameterV0Error,
    MissingConfigurationParameterV0Error,
)
from agenta.sdk.workflows.handlers import mock_v0, MOCK_V0_BEHAVIORS

_mock_v0 = mock_v0.__wrapped__


def run(coro):
    return asyncio.run(coro)


def call(key=None, *, kwargs=None, inputs=None, outputs=None, trace=None):
    params = {}
    if key is not None:
        params["key"] = key
    if kwargs is not None:
        params["kwargs"] = kwargs
    return run(_mock_v0(parameters=params, inputs=inputs, outputs=outputs, trace=trace))


# --- parameter validation --------------------------------------------------


def test_missing_key_raises():
    with pytest.raises(MissingConfigurationParameterV0Error):
        call()


def test_unknown_key_raises():
    with pytest.raises(InvalidConfigurationParameterV0Error):
        call("not-a-real-selector")


def test_non_dict_kwargs_raises():
    with pytest.raises(InvalidConfigurationParameterV0Error):
        run(_mock_v0(parameters={"key": "pass", "kwargs": ["not", "a", "dict"]}))


# --- app-role selectors ----------------------------------------------------


def test_echo_returns_inputs_verbatim():
    assert call("echo", inputs={"input": "hello"}) == {"input": "hello"}


def test_echo_empty_inputs():
    assert call("echo") == {}


def test_static_returns_kwargs_output():
    assert call("static", kwargs={"output": {"answer": "world"}}) == {"answer": "world"}


# --- evaluator-role selectors ----------------------------------------------


def test_pass_returns_success():
    assert call("pass") == {"score": 1.0, "success": True}


def test_fail_returns_failure():
    assert call("fail") == {"score": 0.0, "success": False}


def test_score_above_threshold_succeeds():
    assert call("score", kwargs={"score": 0.8, "threshold": 0.5}) == {
        "score": 0.8,
        "success": True,
    }


def test_score_below_threshold_fails():
    assert call("score", kwargs={"score": 0.2, "threshold": 0.5}) == {
        "score": 0.2,
        "success": False,
    }


def test_score_default_threshold():
    # default threshold is 0.5
    assert call("score", kwargs={"score": 0.5})["success"] is True
    assert call("score", kwargs={"score": 0.49})["success"] is False


def test_reflect_passes_on_real_app_output():
    # an application output (echo of the testcase inputs) is a non-empty dict
    # without an evaluator-result shape -> score 1.0.
    assert call("reflect", outputs={"input": "hello", "expected": "world"}) == {
        "score": 1.0,
        "success": True,
    }


def test_reflect_fails_on_leaked_evaluator_output():
    # a sibling evaluator's {"score","success"} dict must NOT pass: this is the
    # cross-evaluator contamination signal.
    assert call("reflect", outputs={"score": 1.0, "success": True}) == {
        "score": 0.0,
        "success": False,
    }


def test_reflect_fails_on_empty_output():
    assert call("reflect", outputs={})["success"] is False
    assert call("reflect")["success"] is False


# --- shared selectors ------------------------------------------------------


def test_error_raises_mock_error():
    with pytest.raises(MockV0Error):
        call("error")


def test_error_custom_message():
    with pytest.raises(MockV0Error) as exc:
        call("error", kwargs={"message": "boom"})
    assert "boom" in str(exc.value)


def test_delay_sleeps_then_defers():
    # delay is fast here; just assert it defers to the named behavior
    assert call("delay", kwargs={"seconds": 0.01, "then": "pass"}) == {
        "score": 1.0,
        "success": True,
    }


def test_delay_default_then_is_pass():
    assert call("delay", kwargs={"seconds": 0.01})["success"] is True


def test_delay_recursion_guard():
    # then="delay" must not recurse into another sleep; it falls back to pass
    assert call("delay", kwargs={"seconds": 0.01, "then": "delay"})["success"] is True


# --- registry --------------------------------------------------------------


def test_registry_covers_documented_selectors():
    assert set(MOCK_V0_BEHAVIORS) == {
        "echo",
        "static",
        "messages",
        "events",
        "pass",
        "fail",
        "score",
        "reflect",
        "error",
        "delay",
    }


# --- agent-role selectors (big-agents `/invoke` shapes) ---------------------


def test_messages_returns_agent_envelope():
    # batch agent shape: the canonical {messages:[{role,content}]} envelope.
    assert call("messages", kwargs={"text": "hi"}) == {
        "messages": [{"role": "assistant", "content": "hi"}]
    }


def test_events_yields_agenta_event_stream():
    # stream agent shape: mock_v0 returns an async generator of {type, data}
    # agenta events (NOT a batch value). Drain it and assert the canonical types.
    async def _drain():
        gen = await _mock_v0(parameters={"key": "events", "kwargs": {"text": "a b"}})
        return [e async for e in gen]

    events = run(_drain())
    types = [e["type"] for e in events]
    assert types[0] == "message_start"
    assert "message_delta" in types
    assert types[-1] == "done"
    # deltas reconstruct the text
    deltas = [e["data"]["delta"] for e in events if e["type"] == "message_delta"]
    assert "".join(deltas).strip() == "a b"
    # every event is the {type, data} wire shape
    assert all(set(e) == {"type", "data"} for e in events)


def test_events_with_thought_and_tool():
    async def _drain():
        gen = await _mock_v0(
            parameters={
                "key": "events",
                "kwargs": {"text": "done", "thought": "thinking", "tool": "search"},
            }
        )
        return [e async for e in gen]

    types = [e["type"] for e in run(_drain())]
    assert "thought_start" in types and "thought_end" in types
    assert "tool_call" in types and "tool_result" in types
    # ordering: thought + tool precede the message, done is terminal
    assert types.index("tool_call") < types.index("message_start")
    assert types[-1] == "done"
