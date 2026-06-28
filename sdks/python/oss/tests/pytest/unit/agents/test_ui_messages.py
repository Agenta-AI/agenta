"""Tests for the Vercel UI message adapter, the ``/messages`` egress adapter between the
Vercel ``UIMessage`` shape and the neutral runtime types.

Three directions:

- ``vercel_ui_messages_to_messages`` — inbound parts -> ``Message``; tool/approval parts are
  preserved as structured ``tool_call`` / ``tool_result`` content blocks.
- ``message_to_vercel_ui_message`` — outbound ``AgentResult`` / ``Message`` -> one
  ``UIMessage`` dict.
- ``agent_run_to_vercel_parts`` — a live ``AgentStream`` -> Vercel UI Message Stream parts.

The stream tests fabricate an ``AgentStream`` from a fixed record list (the same trick
``test_streaming.py`` uses), so they are pure and need no backend.
"""

from __future__ import annotations

from typing import Any, Dict, List

from agenta.sdk.agents import AgentStream, AgentResult, Message
from agenta.sdk.agents.adapters.vercel import (
    agent_run_to_vercel_parts,
    message_to_vercel_ui_message,
    vercel_ui_messages_to_messages,
)


async def _from_list(records: List[Dict[str, Any]]):
    for record in records:
        yield record


def _run(events: List[Dict[str, Any]], result: Dict[str, Any]) -> AgentStream:
    """An ``AgentStream`` over fabricated live events plus a terminal result record."""
    records = [{"kind": "event", "event": e} for e in events]
    records.append({"kind": "result", "result": {"ok": True, **result}})
    return AgentStream(_from_list(records))


async def _collect(run: AgentStream, **kwargs) -> List[Dict[str, Any]]:
    return [part async for part in agent_run_to_vercel_parts(run, **kwargs)]


# ---------------------------------------------------------------------------
# vercel_ui_messages_to_messages
# ---------------------------------------------------------------------------


class TestFromUIMessages:
    def test_all_text_message_collapses_to_string(self):
        msgs = vercel_ui_messages_to_messages(
            [{"id": "m1", "role": "user", "parts": [{"type": "text", "text": "hi"}]}]
        )
        assert len(msgs) == 1
        assert msgs[0].role == "user"
        assert msgs[0].content == "hi"

    def test_file_part_becomes_image_or_resource_block(self):
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m1",
                    "role": "user",
                    "parts": [
                        {"type": "text", "text": "look:"},
                        {"type": "file", "url": "data:...", "mediaType": "image/png"},
                    ],
                }
            ]
        )
        blocks = msgs[0].content
        assert [b.type for b in blocks] == ["text", "image"]
        assert blocks[1].uri == "data:..."
        assert blocks[1].mime_type == "image/png"

    def test_tool_part_is_preserved_as_structured_blocks(self):
        # A resolved tool part -> a tool_call block plus a tool_result block, keyed by
        # toolCallId, with the field names the runner transcript renders.
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m2",
                    "role": "assistant",
                    "parts": [
                        {
                            "type": "tool-getWeather",
                            "toolCallId": "call_1",
                            "state": "output-available",
                            "input": {"city": "Paris"},
                            "output": {"weather": "sunny"},
                        }
                    ],
                }
            ]
        )
        wire = [b.to_wire() for b in msgs[0].content]
        assert wire == [
            {
                "type": "tool_call",
                "toolCallId": "call_1",
                "toolName": "getWeather",
                "input": {"city": "Paris"},
            },
            {
                "type": "tool_result",
                "toolCallId": "call_1",
                "toolName": "getWeather",
                "output": {"weather": "sunny"},
                "isError": False,
            },
        ]

    def test_tool_error_part_sets_is_error(self):
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m2",
                    "role": "assistant",
                    "parts": [
                        {
                            "type": "tool-getWeather",
                            "toolCallId": "call_1",
                            "state": "output-error",
                            "input": {"city": "Paris"},
                            "errorText": "boom",
                        }
                    ],
                }
            ]
        )
        result_block = msgs[0].content[1]
        assert result_block.type == "tool_result"
        assert result_block.is_error is True
        assert result_block.output == "boom"

    def test_approval_response_becomes_tool_result_keyed_by_call_id(self):
        # The cross-turn HITL reply: a tool_result keyed by toolCallId so the runtime resumes.
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m3",
                    "role": "user",
                    "parts": [
                        {
                            "type": "tool-approval-response",
                            "toolCallId": "call_1",
                            "approved": True,
                        }
                    ],
                }
            ]
        )
        block = msgs[0].content[0]
        assert block.type == "tool_result"
        assert block.tool_call_id == "call_1"
        assert block.output == {"approved": True}

    def test_approval_response_denied_becomes_tool_result_with_false(self):
        # A standalone deny reply -> a tool_result whose `{approved: False}` envelope is
        # what extractApprovalDecisions maps to deny -> reject -> tool-error -> continue.
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m3d",
                    "role": "user",
                    "parts": [
                        {
                            "type": "tool-approval-response",
                            "toolCallId": "call_1",
                            "approved": False,
                        }
                    ],
                }
            ]
        )
        block = msgs[0].content[0]
        assert block.type == "tool_result"
        assert block.tool_call_id == "call_1"
        assert block.output == {"approved": False}

    def test_inline_approval_responded_deny_emits_approved_envelope(self):
        # The verbatim UIMessage path keeps the decision INLINE on the tool part
        # (`state: approval-responded`, `approval.approved: false`). The ingress must
        # emit the `{approved: False}` tool_result so the runner resolves the parked
        # gate (deny -> reject), not just the tool_call (which dead-ended the turn).
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m5",
                    "role": "assistant",
                    "parts": [
                        {
                            "type": "tool-deleteFile",
                            "toolCallId": "call_1",
                            "state": "approval-responded",
                            "input": {"path": "/x"},
                            "approval": {"id": "perm_1", "approved": False},
                        }
                    ],
                }
            ]
        )
        wire = [b.to_wire() for b in msgs[0].content]
        assert wire == [
            {
                "type": "tool_call",
                "toolCallId": "call_1",
                "toolName": "deleteFile",
                "input": {"path": "/x"},
            },
            {
                "type": "tool_result",
                "toolCallId": "call_1",
                "toolName": "deleteFile",
                "output": {"approved": False},
            },
        ]

    def test_inline_approval_responded_approve_emits_approved_envelope(self):
        # The same inline path for an approve keeps resume working symmetrically.
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m6",
                    "role": "assistant",
                    "parts": [
                        {
                            "type": "tool-deleteFile",
                            "toolCallId": "call_2",
                            "state": "approval-responded",
                            "input": {"path": "/y"},
                            "approval": {"id": "perm_2", "approved": True},
                        }
                    ],
                }
            ]
        )
        result = msgs[0].content[1]
        assert result.type == "tool_result"
        assert result.tool_call_id == "call_2"
        assert result.output == {"approved": True}

    def test_inline_output_denied_state_emits_denied_envelope(self):
        # The AI SDK terminal deny state has no `approval.approved` flag; `output-denied`
        # itself means denied, so the ingress still emits `{approved: False}`.
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m7",
                    "role": "assistant",
                    "parts": [
                        {
                            "type": "tool-deleteFile",
                            "toolCallId": "call_3",
                            "state": "output-denied",
                            "input": {"path": "/z"},
                            "approval": {"id": "perm_3", "approved": False},
                        }
                    ],
                }
            ]
        )
        result = msgs[0].content[1]
        assert result.type == "tool_result"
        assert result.tool_call_id == "call_3"
        assert result.output == {"approved": False}

    def test_pending_approval_request_only_part_emits_no_decision(self):
        # A tool part still awaiting a decision (`approval-requested`, no `approval.approved`)
        # carries NO decision envelope — only the tool_call. We must not invent an approve.
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m8",
                    "role": "assistant",
                    "parts": [
                        {
                            "type": "tool-deleteFile",
                            "toolCallId": "call_4",
                            "state": "approval-requested",
                            "input": {"path": "/q"},
                            "approval": {"id": "perm_4"},
                        }
                    ],
                }
            ]
        )
        assert [b.type for b in msgs[0].content] == ["tool_call"]

    def test_approval_request_part_is_dropped_on_replay(self):
        # The server's own request, echoed back; regenerated on replay, not model input.
        msgs = vercel_ui_messages_to_messages(
            [
                {
                    "id": "m4",
                    "role": "assistant",
                    "parts": [
                        {"type": "tool-approval-request", "approvalId": "p1"},
                        {"type": "text", "text": "thinking"},
                    ],
                }
            ]
        )
        assert msgs[0].content == "thinking"

    def test_plain_role_content_message_still_parses(self):
        # A non-parts {role, content} message in a mixed history falls back cleanly.
        msgs = vercel_ui_messages_to_messages([{"role": "user", "content": "hello"}])
        assert msgs[0].content == "hello"


# ---------------------------------------------------------------------------
# message_to_vercel_ui_message
# ---------------------------------------------------------------------------


class TestToUIMessage:
    def test_agent_result_becomes_assistant_text_message(self):
        ui = message_to_vercel_ui_message(AgentResult(output="Paris."), message_id="m9")
        assert ui == {
            "id": "m9",
            "role": "assistant",
            "parts": [{"type": "text", "text": "Paris."}],
        }

    def test_message_with_tool_blocks_round_trips_to_parts(self):
        from agenta.sdk.agents import ContentBlock

        msg = Message(
            role="assistant",
            content=[
                ContentBlock(
                    type="tool_call",
                    tool_call_id="c1",
                    tool_name="getWeather",
                    input={"city": "Paris"},
                ),
            ],
        )
        ui = message_to_vercel_ui_message(msg)
        assert ui["role"] == "assistant"
        assert ui["parts"][0]["type"] == "tool-getWeather"
        assert ui["parts"][0]["toolCallId"] == "c1"


# ---------------------------------------------------------------------------
# agent_run_to_vercel_parts
# ---------------------------------------------------------------------------


class TestUIMessageStream:
    async def test_full_turn_part_order(self):
        run = _run(
            events=[
                {
                    "type": "tool_call",
                    "id": "call_1",
                    "name": "getWeather",
                    "input": {"city": "Paris"},
                },
                {
                    "type": "tool_result",
                    "id": "call_1",
                    "output": "sunny",
                    "data": {"w": "sunny"},
                },
                {"type": "message_start", "id": "t1"},
                {"type": "message_delta", "id": "t1", "delta": "It is sunny."},
                {"type": "message_end", "id": "t1"},
                {"type": "usage", "input": 820, "output": 36, "cost": 0.004},
                {"type": "done", "stopReason": "end_turn"},
            ],
            result={"output": "It is sunny.", "sessionId": "sess_123"},
        )
        parts = await _collect(run, session_id="sess_123")

        assert [p["type"] for p in parts] == [
            "start",
            "start-step",
            "tool-input-start",
            "tool-input-available",
            "tool-output-available",
            "text-start",
            "text-delta",
            "text-end",
            "finish-step",
            "finish",
        ]
        # start carries the session id; tool output prefers the structured `data`.
        assert parts[0]["messageMetadata"] == {"sessionId": "sess_123"}
        assert parts[4]["output"] == {"w": "sunny"}
        # finish carries the usage and the stop reason, mapped from the model's
        # raw `end_turn` onto the AI SDK `finishReason` enum (`stop`).
        assert parts[-1]["finishReason"] == "stop"
        assert parts[-1]["messageMetadata"]["usage"] == {
            "input": 820,
            "output": 36,
            "cost": 0.004,
        }

    async def test_usage_falls_back_to_terminal_result(self):
        run = _run(
            events=[
                {"type": "message", "text": "hi"},
                {"type": "done", "stopReason": "end_turn"},
            ],
            result={"output": "hi", "usage": {"input": 10, "output": 2}},
        )
        parts = await _collect(run, session_id="s1")
        assert parts[-1]["messageMetadata"]["usage"] == {"input": 10, "output": 2}

    async def test_coalesced_message_emits_text_block(self):
        run = _run(
            events=[{"type": "message", "text": "Paris."}, {"type": "done"}],
            result={"output": "Paris."},
        )
        parts = await _collect(run, session_id="s1")
        types = [p["type"] for p in parts]
        assert "text-start" in types and "text-delta" in types and "text-end" in types
        delta = next(p for p in parts if p["type"] == "text-delta")
        assert delta["delta"] == "Paris."

    async def test_permission_interaction_becomes_approval_request(self):
        run = _run(
            events=[
                {
                    "type": "interaction_request",
                    "id": "perm_1",
                    "kind": "permission",
                    "payload": {
                        "toolCallId": "call_1",
                        "availableReplies": ["once", "always", "reject"],
                        "toolCall": {"toolCallId": "call_1", "name": "deleteFile"},
                    },
                },
                {"type": "done"},
            ],
            result={"output": ""},
        )
        parts = await _collect(run, session_id="s1")
        approval = next(p for p in parts if p["type"] == "tool-approval-request")
        assert approval["approvalId"] == "perm_1"
        # REQUIRED top-level toolCallId binds the approval to its tool part (RFC / AI SDK).
        assert approval["toolCallId"] == "call_1"
        # The AI SDK chunk is a strict object: only type/approvalId/toolCallId are
        # allowed; the agenta-only availableReplies/toolCall keys must not leak.
        assert set(approval.keys()) == {"type", "approvalId", "toolCallId"}
        # No tool_call preceded, so a tool part is synthesized for the approval to
        # attach to (toolName from the request's nested toolCall).
        synth = next(p for p in parts if p["type"] == "tool-input-available")
        assert synth["toolCallId"] == "call_1"
        assert synth["toolName"] == "deleteFile"

    async def test_parked_gate_emits_only_approval_request_no_error_output(self):
        # The "park does not clobber" contract (F-024): once the runner stops replying `reject`
        # on a parked gate, a turn's events are [tool_call, interaction_request(permission),
        # done] with NO error tool_result. The egress must then emit exactly one
        # tool-approval-request for the tool and NO tool-output-error/-denied on the same id, so
        # the approval prompt is the last word on the tool part.
        run = _run(
            events=[
                {
                    "type": "tool_call",
                    "id": "call_5",
                    "name": "deleteFile",
                    "input": {"path": "/x"},
                },
                {
                    "type": "interaction_request",
                    "id": "perm_5",
                    "kind": "permission",
                    "payload": {
                        "toolCallId": "call_5",
                        "availableReplies": ["once", "always", "reject"],
                        "toolCall": {"toolCallId": "call_5", "name": "deleteFile"},
                    },
                },
                {"type": "done"},
            ],
            result={"output": ""},
        )
        parts = await _collect(run, session_id="s1")
        approvals = [p for p in parts if p["type"] == "tool-approval-request"]
        assert len(approvals) == 1
        assert approvals[0]["toolCallId"] == "call_5"
        # No error/denied part clobbers the approval prompt for this tool call.
        for kind in ("tool-output-error", "tool-output-denied"):
            assert all(
                p.get("toolCallId") != "call_5" for p in parts if p["type"] == kind
            )

    async def test_permission_tool_call_id_falls_back_to_nested_tool_call(self):
        # No top-level toolCallId on the payload: dig it out of the nested ACP toolCall detail.
        run = _run(
            events=[
                {
                    "type": "interaction_request",
                    "id": "perm_2",
                    "kind": "permission",
                    "payload": {
                        "availableReplies": ["once", "reject"],
                        "toolCall": {"id": "call_9", "name": "deleteFile"},
                    },
                },
                {"type": "done"},
            ],
            result={"output": ""},
        )
        parts = await _collect(run, session_id="s1")
        approval = next(p for p in parts if p["type"] == "tool-approval-request")
        assert approval["toolCallId"] == "call_9"

    async def test_permission_does_not_duplicate_an_already_streamed_tool_call(self):
        # The tool call was already surfaced as a tool part, so the approval binds
        # to it by id without synthesizing a second tool-input part.
        run = _run(
            events=[
                {
                    "type": "tool_call",
                    "id": "call_1",
                    "name": "deleteFile",
                    "input": {},
                },
                {
                    "type": "interaction_request",
                    "id": "perm_1",
                    "kind": "permission",
                    "payload": {
                        "toolCallId": "call_1",
                        "toolCall": {"toolCallId": "call_1", "name": "deleteFile"},
                    },
                },
                {"type": "done"},
            ],
            result={"output": ""},
        )
        parts = await _collect(run, session_id="s1")
        inputs = [p for p in parts if p["type"] == "tool-input-available"]
        assert len(inputs) == 1  # no synthesized duplicate
        approval = next(p for p in parts if p["type"] == "tool-approval-request")
        assert approval["toolCallId"] == "call_1"

    async def test_tool_denial_becomes_output_denied(self):
        # A human denied the tool: it never ran, so emit tool-output-denied (not -available).
        run = _run(
            events=[
                {"type": "tool_call", "id": "c1", "name": "deleteFile", "input": {}},
                {"type": "tool_result", "id": "c1", "denied": True},
                {"type": "done"},
            ],
            result={"output": ""},
        )
        parts = await _collect(run, session_id="s1")
        denied = next(p for p in parts if p["type"] == "tool-output-denied")
        assert denied["toolCallId"] == "c1"
        # A denied result is neither output-available nor output-error.
        types = [p["type"] for p in parts]
        assert "tool-output-available" not in types
        assert "tool-output-error" not in types

    async def test_finish_carries_trace_id_from_param(self):
        run = _run(
            events=[
                {"type": "message", "text": "hi"},
                {"type": "done", "stopReason": "end_turn"},
            ],
            result={"output": "hi", "usage": {"input": 10, "output": 2}},
        )
        parts = await _collect(run, session_id="s1", trace_id="abc123")
        # traceId and usage coexist under the finish messageMetadata.
        assert parts[-1]["messageMetadata"]["traceId"] == "abc123"
        assert parts[-1]["messageMetadata"]["usage"] == {"input": 10, "output": 2}

    async def test_finish_trace_id_falls_back_to_terminal_result(self):
        run = _run(
            events=[
                {"type": "message", "text": "hi"},
                {"type": "done", "stopReason": "end_turn"},
            ],
            result={"output": "hi", "traceId": "trace_from_result"},
        )
        parts = await _collect(run, session_id="s1")
        assert parts[-1]["messageMetadata"]["traceId"] == "trace_from_result"

    async def test_finish_reason_maps_model_stop_reason_to_ai_sdk_enum(self):
        # The AI SDK `finish` chunk only accepts a closed `finishReason` enum;
        # raw model reasons must be mapped or the client's stream validator
        # rejects the whole frame. Unknown reasons fall back to `unknown`.
        cases = {
            "end_turn": "stop",
            "stop_sequence": "stop",
            "max_tokens": "length",
            "tool_use": "tool-calls",
            "refusal": "content-filter",
            "stop": "stop",  # already-valid value passes through
            "wat": "unknown",  # unmapped reason does not break validation
        }
        for raw, expected in cases.items():
            run = _run(
                events=[
                    {"type": "message", "text": "hi"},
                    {"type": "done", "stopReason": raw},
                ],
                result={"output": "hi"},
            )
            parts = await _collect(run, session_id="s1")
            assert parts[-1]["finishReason"] == expected, raw

    async def test_finish_omits_reason_when_model_gives_none(self):
        run = _run(
            events=[{"type": "message", "text": "hi"}, {"type": "done"}],
            result={"output": "hi"},
        )
        parts = await _collect(run, session_id="s1")
        assert "finishReason" not in parts[-1]

    async def test_render_hint_rides_a_sibling_data_part(self):
        # The AI SDK tool chunks are strict objects with no `render` field, so the
        # hint travels as a `data-render` part keyed by toolCallId, not inline.
        render = {"kind": "component", "component": "WeatherCard"}
        run = _run(
            events=[
                {
                    "type": "tool_call",
                    "id": "c1",
                    "name": "w",
                    "input": {},
                    "render": render,
                },
                {
                    "type": "tool_result",
                    "id": "c1",
                    "data": {"w": "sunny"},
                    "render": render,
                },
                {"type": "done"},
            ],
            result={"output": ""},
        )
        parts = await _collect(run, session_id="s1")
        available = next(p for p in parts if p["type"] == "tool-input-available")
        output = next(p for p in parts if p["type"] == "tool-output-available")
        # render does not leak onto the strict tool chunks…
        assert "render" not in available
        assert "render" not in output
        # …it rides one data-render part per tool frame, keyed by toolCallId.
        renders = [p for p in parts if p["type"] == "data-render"]
        assert len(renders) == 2
        assert all(p["data"]["toolCallId"] == "c1" for p in renders)
        assert all(p["data"]["render"] == render for p in renders)

    async def test_tool_error_becomes_output_error(self):
        run = _run(
            events=[
                {"type": "tool_call", "id": "c1", "name": "w", "input": {}},
                {"type": "tool_result", "id": "c1", "output": "boom", "isError": True},
                {"type": "done"},
            ],
            result={"output": ""},
        )
        parts = await _collect(run, session_id="s1")
        err = next(p for p in parts if p["type"] == "tool-output-error")
        assert err["toolCallId"] == "c1"
        assert err["errorText"] == "boom"

    async def test_terminal_failure_emits_error_part_and_no_finish(self):
        records = [
            {"kind": "event", "event": {"type": "message", "text": "partial"}},
            {"kind": "result", "result": {"ok": False, "error": "kaboom"}},
        ]
        run = AgentStream(_from_list(records))
        parts = [part async for part in agent_run_to_vercel_parts(run, session_id="s1")]
        types = [p["type"] for p in parts]
        assert types[0] == "start"
        assert "finish" not in types
        error = next(p for p in parts if p["type"] == "error")
        assert "kaboom" in error["errorText"]
