"""Unit tests for `agenta.sdk.agents.fold`: batch = fold(stream), by construction.

Pure-function tests over the canonical agenta event vocabulary — no harness, no
backend, no HTTP. See docs/designs/invoke-negotiations/specs.md for the contract.
"""

from __future__ import annotations

from agenta.sdk.agents.fold import fold, trim_to_trailing_unit


def _msg_start(mid):
    return {"type": "message_start", "data": {"id": mid}}


def _msg_delta(mid, delta):
    return {"type": "message_delta", "data": {"id": mid, "delta": delta}}


def _msg_end(mid):
    return {"type": "message_end", "data": {"id": mid}}


def _done(stop_reason="stop"):
    return {"type": "done", "data": {"stopReason": stop_reason}}


# --------------------------------------------------------------------------- #
# fold — plain / multi-message turns
# --------------------------------------------------------------------------- #


def test_fold_plain_turn_single_message():
    events = [
        _msg_start("m1"),
        _msg_delta("m1", "hello "),
        _msg_delta("m1", "world"),
        _msg_end("m1"),
        _done("stop"),
    ]
    result = fold(events)
    assert result["messages"] == [{"role": "assistant", "content": "hello world"}]
    assert result["stop_reason"] == "stop"
    assert result["pending_interaction"] is None


def test_fold_multi_message_turn_keeps_ids_independent():
    events = [
        _msg_start("m1"),
        _msg_delta("m1", "first"),
        _msg_end("m1"),
        _msg_start("m2"),
        _msg_delta("m2", "second"),
        _msg_end("m2"),
        _done(),
    ]
    result = fold(events)
    assert [m["content"] for m in result["messages"]] == ["first", "second"]


def test_fold_coalesced_message_event_appends_directly():
    # One-shot `message` event: whole block, no delta lifecycle.
    events = [{"type": "message", "data": {"text": "hi"}}, _done()]
    result = fold(events)
    assert result["messages"] == [{"role": "assistant", "content": "hi"}]


# --------------------------------------------------------------------------- #
# fold — tool run
# --------------------------------------------------------------------------- #


def test_fold_tool_run_produces_call_and_result_messages_in_order():
    events = [
        _msg_start("m1"),
        _msg_delta("m1", "let me check"),
        _msg_end("m1"),
        {
            "type": "tool_call",
            "data": {"id": "t1", "name": "search", "input": {"q": "x"}},
        },
        {"type": "tool_result", "data": {"id": "t1", "output": "42"}},
        _msg_start("m2"),
        _msg_delta("m2", "the answer is 42"),
        _msg_end("m2"),
        _done(),
    ]
    result = fold(events)
    roles = [m["role"] for m in result["messages"]]
    assert roles == ["assistant", "tool", "tool", "assistant"]
    call, tool_result = result["messages"][1], result["messages"][2]
    assert call["tool_call_id"] == "t1" and call["tool_name"] == "search"
    assert tool_result["tool_call_id"] == "t1" and tool_result["content"] == "42"
    assert result["stop_reason"] == "stop"


def test_fold_tool_result_error_flag_carried():
    events = [
        {"type": "tool_call", "data": {"id": "t1", "name": "bash"}},
        {
            "type": "tool_result",
            "data": {"id": "t1", "output": "boom", "isError": True},
        },
        _done(),
    ]
    result = fold(events)
    tool_result = result["messages"][-1]
    assert tool_result["is_error"] is True


# --------------------------------------------------------------------------- #
# fold — paused turn (interaction_request + done(paused) -> pending_interaction)
# --------------------------------------------------------------------------- #


def test_fold_paused_turn_sets_pending_interaction():
    events = [
        {"type": "tool_call", "data": {"id": "t1", "name": "run_command"}},
        {
            "type": "interaction_request",
            "data": {
                "id": "req-1",
                "kind": "user_approval",
                "payload": {"toolCallId": "t1"},
            },
        },
        _done("paused"),
    ]
    result = fold(events)
    assert result["stop_reason"] == "paused"
    assert result["pending_interaction"] == {
        "id": "req-1",
        "kind": "user_approval",
        "payload": {"toolCallId": "t1"},
    }


def test_fold_interaction_request_without_pause_is_not_pending():
    # Resolved in-turn (not a HITL park) must not leak into pending_interaction.
    events = [
        {
            "type": "interaction_request",
            "data": {"id": "req-1", "kind": "client_tool", "payload": {}},
        },
        {"type": "tool_result", "data": {"id": "t1", "output": "ok"}},
        _done("stop"),
    ]
    result = fold(events)
    assert result["stop_reason"] == "stop"
    assert result["pending_interaction"] is None


# --------------------------------------------------------------------------- #
# fold — error turn
# --------------------------------------------------------------------------- #


def test_fold_error_turn_has_no_stop_reason_without_done():
    events = [
        _msg_start("m1"),
        _msg_delta("m1", "working"),
        {"type": "error", "data": {"message": "boom"}},
    ]
    result = fold(events)
    assert result["stop_reason"] is None
    assert result["pending_interaction"] is None
    # In-flight text is whatever accumulated before the error.
    assert result["messages"] == [{"role": "assistant", "content": "working"}]


def test_fold_error_then_done_still_resolves_stop_reason():
    events = [{"type": "error", "data": {"message": "boom"}}, _done("error")]
    result = fold(events)
    assert result["stop_reason"] == "error"


# --------------------------------------------------------------------------- #
# fold — thought / data / file / usage ignored in messages, not lost overall
# --------------------------------------------------------------------------- #


def test_fold_thought_events_do_not_appear_in_messages():
    events = [
        {"type": "thought_start", "data": {"id": "th1"}},
        {"type": "thought_delta", "data": {"id": "th1", "delta": "hmm"}},
        {"type": "thought_end", "data": {"id": "th1"}},
        _msg_start("m1"),
        _msg_delta("m1", "answer"),
        _msg_end("m1"),
        _done(),
    ]
    result = fold(events)
    assert result["messages"] == [{"role": "assistant", "content": "answer"}]


def test_fold_data_and_file_events_do_not_appear_in_messages_but_dont_break_done():
    events = [
        {"type": "data", "data": {"name": "progress", "data": {"pct": 50}}},
        {"type": "file", "data": {"url": "https://x/y.png", "mediaType": "image/png"}},
        {"type": "usage", "data": {"input": 10, "output": 5, "total": 15}},
        _done("stop"),
    ]
    result = fold(events)
    assert result["messages"] == []
    assert result["stop_reason"] == "stop"


def test_fold_empty_stream_yields_empty_envelope():
    result = fold([])
    assert result == {
        "messages": [],
        "stop_reason": None,
        "pending_interaction": None,
    }


# --------------------------------------------------------------------------- #
# trim_to_trailing_unit
# --------------------------------------------------------------------------- #


def test_trim_empty_list_is_empty_list():
    assert trim_to_trailing_unit([]) == []


def test_trim_text_tail_keeps_only_last_assistant_message():
    messages = [
        {"role": "assistant", "content": "first"},
        {"role": "assistant", "content": "second"},
    ]
    assert trim_to_trailing_unit(messages) == [
        {"role": "assistant", "content": "second"}
    ]


def test_trim_single_message_returns_that_message():
    messages = [{"role": "assistant", "content": "only"}]
    assert trim_to_trailing_unit(messages) == messages


def test_trim_tool_tail_keeps_whole_trailing_run_incl_initiating_assistant():
    messages = [
        {"role": "assistant", "content": "earlier turn, should be dropped"},
        {"role": "assistant", "content": "let me check"},
        {"role": "tool", "content": "", "tool_call_id": "t1"},
        {"role": "tool", "content": "42", "tool_call_id": "t1"},
    ]
    trimmed = trim_to_trailing_unit(messages)
    assert trimmed == messages[1:]


def test_trim_approval_tail_keeps_trailing_run_when_last_message_is_tool_shaped():
    # Pending-approval turn ends in a role="tool" unit; same trailing-run trim applies.
    messages = [
        {"role": "assistant", "content": "requesting approval"},
        {"role": "tool", "content": "", "tool_call_id": "t1"},
    ]
    assert trim_to_trailing_unit(messages) == messages


def test_trim_tool_tail_with_no_preceding_assistant_keeps_just_the_run():
    messages = [
        {"role": "tool", "content": "", "tool_call_id": "t1"},
        {"role": "tool", "content": "ok", "tool_call_id": "t1"},
    ]
    assert trim_to_trailing_unit(messages) == messages
