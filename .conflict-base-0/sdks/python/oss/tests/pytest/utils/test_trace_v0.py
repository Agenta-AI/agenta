"""
Unit tests for the feedback_v0 handler (agenta:custom:feedback:v0).

feedback_v0 is an interface-only handler — it exists as a registry/schema entry
but cannot be invoked directly. All call paths must raise FeedbackV0Error.
"""

import asyncio

import pytest

from agenta.sdk.workflows.errors import FeedbackV0Error
from agenta.sdk.workflows.handlers import feedback_v0

_feedback_v0 = feedback_v0.__wrapped__


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# 1. Interface-only — always raises
# ---------------------------------------------------------------------------


class TestFeedbackV0InterfaceOnly:
    def test_no_args_raises_hook_error(self):
        with pytest.raises(FeedbackV0Error):
            run(_feedback_v0())

    def test_with_inputs_raises_hook_error(self):
        with pytest.raises(FeedbackV0Error):
            run(_feedback_v0(inputs={"q": "hello"}))

    def test_with_outputs_raises_hook_error(self):
        with pytest.raises(FeedbackV0Error):
            run(_feedback_v0(outputs="some answer"))

    def test_with_all_args_raises_hook_error(self):
        with pytest.raises(FeedbackV0Error):
            run(
                _feedback_v0(
                    inputs={"q": "hello"},
                    parameters={"key": "val"},
                    outputs="answer",
                    trace={"latency": 42},
                    testcase={"correct": "answer"},
                )
            )

    def test_error_message_mentions_uri(self):
        with pytest.raises(FeedbackV0Error) as exc_info:
            run(_feedback_v0())
        assert "agenta:custom:feedback:v0" in exc_info.value.message
