"""Capabilities, events, and the small cross-boundary DTOs.

Capabilities are what lets adapters branch on a flag instead of the harness name, so their
camelCase parsing is contract-critical. Events feed tracing; the trace/tool-callback DTOs
plumb the run into Agenta.
"""

from __future__ import annotations

import pytest

from agenta.sdk.agents import (
    AgentEvent,
    HarnessCapabilities,
    HarnessType,
    ToolCallback,
    TraceContext,
)


def test_capabilities_none_and_non_dict_pass_through_as_none():
    assert HarnessCapabilities.from_wire(None) is None
    assert HarnessCapabilities.from_wire("nope") is None


def test_capabilities_defaults_text_messages_true():
    caps = HarnessCapabilities.from_wire({})
    assert caps is not None
    assert caps.text_messages is True  # the one flag that defaults on
    assert caps.mcp_tools is False
    assert caps.images is False


def test_capabilities_map_camelcase_flags():
    caps = HarnessCapabilities.from_wire(
        {"mcpTools": True, "fileAttachments": True, "sessionLifecycle": True}
    )
    assert caps.mcp_tools is True
    assert caps.file_attachments is True
    assert caps.session_lifecycle is True


def test_agent_event_requires_type():
    assert AgentEvent.from_wire({"text": "no type"}) is None
    assert AgentEvent.from_wire({"type": ""}) is None  # falsy type
    assert AgentEvent.from_wire("not a dict") is None


def test_agent_event_keeps_full_payload_in_data():
    event = AgentEvent.from_wire(
        {"type": "tool_call", "name": "search", "input": {"q": "x"}}
    )
    assert event.type == "tool_call"
    # `data` carries the rest verbatim, including the type key.
    assert event.data == {"type": "tool_call", "name": "search", "input": {"q": "x"}}


def test_trace_context_to_wire_emits_all_keys_camelcase():
    wire = TraceContext(traceparent="tp", endpoint="ep").to_wire()
    assert wire == {
        "traceparent": "tp",
        "baggage": None,
        "endpoint": "ep",
        "authorization": None,
        "captureContent": True,  # defaults on, camelCase
    }


def test_tool_callback_to_wire():
    assert ToolCallback(endpoint="e", authorization="a").to_wire() == {
        "endpoint": "e",
        "authorization": "a",
    }


def test_harness_type_coerce():
    assert HarnessType.coerce(HarnessType.PI) is HarnessType.PI
    assert HarnessType.coerce("PI") is HarnessType.PI  # case-insensitive
    assert HarnessType.coerce("claude") is HarnessType.CLAUDE
    with pytest.raises(ValueError):
        HarnessType.coerce("bogus")
