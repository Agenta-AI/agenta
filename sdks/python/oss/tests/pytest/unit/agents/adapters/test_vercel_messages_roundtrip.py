"""Round-trip fidelity for the Vercel ``UIMessage`` part <-> ``ContentBlock`` mapping.

``message_to_vercel_ui_message`` (outbound) and ``vercel_ui_messages_to_messages`` (inbound)
sit at opposite edges of the same adapter. A part kind the outbound side emits must survive
being fed back in, or a client that persists and replays its own transcript loses content on
every turn. Agenta's ``ContentBlock`` model is canonical, so this only holds for kinds that map
onto an existing ``ContentBlock`` type; kinds Agenta has no block for are dropped, observably.
"""

from __future__ import annotations

import logging

from agenta.sdk.agents import ContentBlock, Message
from agenta.sdk.agents.adapters.vercel import (
    message_to_vercel_ui_message,
    vercel_ui_messages_to_messages,
)


def _roundtrip(message: Message) -> Message:
    ui = message_to_vercel_ui_message(message)
    [back] = vercel_ui_messages_to_messages([ui])
    return back


class TestRoundTripLosslessForEmittedKinds:
    def test_text_roundtrips(self):
        back = _roundtrip(Message(role="assistant", content="hello there"))
        assert back.content == "hello there"

    def test_tool_call_and_result_roundtrip(self):
        message = Message(
            role="assistant",
            content=[
                ContentBlock(
                    type="tool_call",
                    tool_call_id="call_1",
                    tool_name="getWeather",
                    input={"city": "Paris"},
                ),
                ContentBlock(
                    type="tool_result",
                    tool_call_id="call_1",
                    tool_name="getWeather",
                    output={"weather": "sunny"},
                    is_error=False,
                ),
            ],
        )
        back = _roundtrip(message)
        wire = [b.to_wire() for b in back.content]
        # The call's input and the result's output both survive the round trip (each
        # outbound tool part comes back as its own block; a duplicate no-input tool_call
        # from the output part is a pre-existing quirk of this mapping, not this fix's
        # concern, so this checks presence/content rather than exact list shape).
        calls_with_input = [
            b for b in wire if b["type"] == "tool_call" and "input" in b
        ]
        results = [b for b in wire if b["type"] == "tool_result"]
        assert calls_with_input == [
            {
                "type": "tool_call",
                "toolCallId": "call_1",
                "toolName": "getWeather",
                "input": {"city": "Paris"},
            }
        ]
        assert results == [
            {
                "type": "tool_result",
                "toolCallId": "call_1",
                "toolName": "getWeather",
                "output": {"weather": "sunny"},
                "isError": False,
            }
        ]

    def test_resource_block_roundtrips(self):
        message = Message(
            role="user",
            content=[
                ContentBlock(
                    type="resource",
                    uri="s3://bucket/doc.pdf",
                    mime_type="application/pdf",
                ),
            ],
        )
        back = _roundtrip(message)
        block = back.content[0]
        assert block.type == "resource"
        assert block.uri == "s3://bucket/doc.pdf"
        assert block.mime_type == "application/pdf"


class TestInboundReasoningDroppedSymmetrically:
    def test_inbound_reasoning_part_is_dropped_and_logged(self, caplog):
        # Reasoning is stream-only (stream.py maps `thought` events to `reasoning` frames).
        # Stored-message conversion emits no reasoning on the outbound side, so an inbound
        # reasoning part is dropped here to stay symmetric — not folded, not fabricated.
        caplog.set_level(logging.DEBUG)
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m1",
                    "role": "assistant",
                    "parts": [
                        {"type": "reasoning", "text": "step one"},
                        {"type": "text", "text": "the answer"},
                    ],
                }
            ]
        )
        assert msgs[0].content == "the answer"
        assert "reasoning" in caplog.text


class TestUnmappedPartsAreDroppedObservably:
    def test_unmapped_kind_is_dropped_but_logged(self, caplog):
        caplog.set_level(logging.DEBUG)
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m1",
                    "role": "assistant",
                    "parts": [
                        {"type": "data-custom", "data": {"foo": "bar"}},
                        {"type": "text", "text": "still here"},
                    ],
                }
            ]
        )
        # The unmapped part contributes nothing to content ...
        assert msgs[0].content == "still here"
        # ... but its kind is observable, not a silent drop.
        assert "data-custom" in caplog.text

    def test_error_and_source_url_and_step_start_are_dropped_observably(self, caplog):
        caplog.set_level(logging.DEBUG)
        for ptype in ("error", "source-url", "step-start"):
            caplog.clear()
            msgs = vercel_ui_messages_to_messages(
                [{"id": "m1", "role": "assistant", "parts": [{"type": ptype}]}]
            )
            assert msgs[0].content == ""
            assert ptype in caplog.text
