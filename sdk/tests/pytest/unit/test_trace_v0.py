"""
Unit tests for the trace_v0 handler (agenta:custom:trace:v0).

trace_v0 is an interface-only handler — it exists as a registry/schema entry
but cannot be invoked directly.  All call paths must raise HookV0Error.
"""

import asyncio

import pytest

from agenta.sdk.workflows.errors import HookV0Error
from agenta.sdk.workflows.handlers import trace_v0

_trace_v0 = trace_v0.__wrapped__


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ---------------------------------------------------------------------------
# 1. Interface-only — always raises
# ---------------------------------------------------------------------------


class TestTraceV0InterfaceOnly:
    def test_no_args_raises_hook_error(self):
        with pytest.raises(HookV0Error):
            run(_trace_v0())

    def test_with_inputs_raises_hook_error(self):
        with pytest.raises(HookV0Error):
            run(_trace_v0(inputs={"q": "hello"}))

    def test_with_outputs_raises_hook_error(self):
        with pytest.raises(HookV0Error):
            run(_trace_v0(outputs="some answer"))

    def test_with_all_args_raises_hook_error(self):
        with pytest.raises(HookV0Error):
            run(
                _trace_v0(
                    inputs={"q": "hello"},
                    parameters={"key": "val"},
                    outputs="answer",
                    trace={"latency": 42},
                    testcase={"correct": "answer"},
                )
            )

    def test_error_message_mentions_uri(self):
        with pytest.raises(HookV0Error) as exc_info:
            run(_trace_v0())
        assert "agenta:custom:trace:v0" in exc_info.value.message
