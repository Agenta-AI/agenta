"""Unit tests for the Logfire adapter.

Tests the mapping of PydanticAI / Logfire span attributes to Agenta's `ag.*`
canonical attributes, covering v2+ data extraction (chat, tool, agent spans),
message normalization, and the v1 events-based fallback.
"""

from datetime import datetime, timezone
from json import dumps

import pytest

from oss.src.apis.fastapi.otlp.extractors.adapters.logfire_adapter import (
    LogfireAdapter,
    _normalize_pydantic_messages,
)
from oss.src.apis.fastapi.otlp.extractors.canonical_attributes import (
    CanonicalAttributes,
    SpanFeatures,
)
from oss.src.core.otel.dtos import OTelSpanKind, OTelStatusCode


# ── helpers ──────────────────────────────────────────────────────────


def _make_bag(
    span_attributes: dict, span_name: str = "test-span"
) -> CanonicalAttributes:
    return CanonicalAttributes(
        span_name=span_name,
        trace_id="aaaa" * 8,
        span_id="bbbb" * 4,
        span_kind=OTelSpanKind.SPAN_KIND_INTERNAL,
        start_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
        end_time=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
        status_code=OTelStatusCode.STATUS_CODE_OK,
        span_attributes=span_attributes,
    )


@pytest.fixture
def adapter() -> LogfireAdapter:
    return LogfireAdapter()


# ── Chat Span Data Extraction ───────────────────────────────────────


class TestChatSpanData:
    def test_simple_text_response(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "chat",
                "gen_ai.system": "openai",
                "gen_ai.input.messages": dumps(
                    [
                        {
                            "role": "system",
                            "parts": [{"type": "text", "content": "You are helpful."}],
                        },
                        {
                            "role": "user",
                            "parts": [{"type": "text", "content": "hi"}],
                        },
                    ]
                ),
                "gen_ai.output.messages": dumps(
                    [
                        {
                            "role": "assistant",
                            "parts": [
                                {"type": "text", "content": "Hello! How can I help?"}
                            ],
                            "finish_reason": "stop",
                        }
                    ]
                ),
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"]["prompt"] == [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "hi"},
        ]
        assert features.data["outputs"]["completion"] == [
            {
                "role": "assistant",
                "content": "Hello! How can I help?",
                "finish_reason": "stop",
            }
        ]

    def test_chat_with_tool_calls(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "chat",
                "gen_ai.system": "openai",
                "gen_ai.input.messages": dumps(
                    [
                        {
                            "role": "user",
                            "parts": [
                                {"type": "text", "content": "Check availability"}
                            ],
                        }
                    ]
                ),
                "gen_ai.output.messages": dumps(
                    [
                        {
                            "role": "assistant",
                            "parts": [
                                {"type": "text", "content": "Let me check"},
                                {
                                    "type": "tool_call",
                                    "id": "call_123",
                                    "name": "search",
                                    "arguments": {"date": "2026-05-16"},
                                },
                            ],
                            "finish_reason": "tool_calls",
                        }
                    ]
                ),
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        output = features.data["outputs"]["completion"][0]
        assert output["content"] == "Let me check"
        assert output["tool_calls"] == [
            {
                "id": "call_123",
                "type": "function",
                "function": {
                    "name": "search",
                    "arguments": {"date": "2026-05-16"},
                },
            }
        ]
        assert output["finish_reason"] == "tool_calls"

    def test_chat_with_already_parsed_messages(self, adapter):
        """When gen_ai.input.messages is already a list (not a JSON string)."""
        bag = _make_bag(
            {
                "gen_ai.operation.name": "chat",
                "gen_ai.system": "openai",
                "gen_ai.input.messages": [
                    {
                        "role": "user",
                        "parts": [{"type": "text", "content": "hello"}],
                    }
                ],
                "gen_ai.output.messages": [
                    {
                        "role": "assistant",
                        "parts": [{"type": "text", "content": "hi"}],
                        "finish_reason": "stop",
                    }
                ],
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"]["prompt"] == [
            {"role": "user", "content": "hello"}
        ]
        assert features.data["outputs"]["completion"] == [
            {"role": "assistant", "content": "hi", "finish_reason": "stop"}
        ]

    def test_chat_multi_part_system_message(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "chat",
                "gen_ai.system": "openai",
                "gen_ai.input.messages": dumps(
                    [
                        {
                            "role": "system",
                            "parts": [
                                {
                                    "type": "text",
                                    "content": "You are a hotel concierge.",
                                },
                                {"type": "text", "content": "Guest: Sarah (standard)"},
                            ],
                        }
                    ]
                ),
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        prompt = features.data["inputs"]["prompt"]
        assert len(prompt) == 1
        assert (
            prompt[0]["content"] == "You are a hotel concierge. Guest: Sarah (standard)"
        )


# ── Tool Span Data Extraction ───────────────────────────────────────


class TestToolSpanData:
    def test_tool_span_v2(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": "search_availability",
                "gen_ai.tool.call.id": "call_abc",
                "tool_arguments": '{"check_in": "2026-05-16", "guests": 1}',
                "tool_response": '[{"room_type": "STD", "rate": "180.00"}]',
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"] == {
            "name": "search_availability",
            "arguments": {"check_in": "2026-05-16", "guests": 1},
        }
        assert features.data["outputs"] == [{"room_type": "STD", "rate": "180.00"}]

    def test_tool_span_v3_attribute_names(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": "get_weather",
                "gen_ai.tool.call.arguments": '{"city": "Berlin"}',
                "gen_ai.tool.call.result": '{"temp": 22}',
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"] == {
            "name": "get_weather",
            "arguments": {"city": "Berlin"},
        }
        assert features.data["outputs"] == {"temp": 22}

    def test_tool_span_no_response(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": "void_tool",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"] == {"name": "void_tool"}
        assert "outputs" not in features.data

    def test_tool_span_string_response(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": "echo",
                "tool_response": "not json, just text",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["outputs"] == "not json, just text"

    def test_tool_does_not_override_chat_data(self, adapter):
        """If chat extraction already populated features.data, tool extraction skips."""
        bag = _make_bag(
            {
                "gen_ai.operation.name": "chat",
                "gen_ai.system": "openai",
                "gen_ai.input.messages": dumps(
                    [{"role": "user", "parts": [{"type": "text", "content": "hi"}]}]
                ),
                "gen_ai.tool.name": "some_tool",
                "tool_arguments": '{"key": "value"}',
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert "prompt" in features.data["inputs"]
        assert "name" not in features.data["inputs"]


# ── Agent Span Data Extraction ──────────────────────────────────────


class TestAgentSpanData:
    def test_agent_with_all_messages_and_final_result(self, adapter):
        all_messages = [
            {
                "role": "system",
                "parts": [{"type": "text", "content": "You are helpful."}],
            },
            {"role": "user", "parts": [{"type": "text", "content": "hi"}]},
            {
                "role": "assistant",
                "parts": [{"type": "text", "content": "Hello!"}],
                "finish_reason": "stop",
            },
        ]
        bag = _make_bag(
            {
                "gen_ai.operation.name": "invoke_agent",
                "pydantic_ai.all_messages": dumps(all_messages),
                "final_result": "Hello!",
                "agent_name": "agent",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"]["prompt"] == [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "hi"},
        ]
        assert features.data["outputs"]["completion"] == [
            {"role": "assistant", "content": "Hello!", "finish_reason": "stop"}
        ]

    def test_agent_with_final_result_only(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "invoke_agent",
                "final_result": "Some response",
                "agent_name": "agent",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["outputs"]["completion"] == "Some response"
        assert "inputs" not in features.data

    def test_agent_extracts_last_assistant_as_output(self, adapter):
        all_messages = [
            {"role": "user", "parts": [{"type": "text", "content": "hello"}]},
            {"role": "assistant", "parts": [{"type": "text", "content": "first"}]},
            {"role": "user", "parts": [{"type": "text", "content": "again"}]},
            {"role": "assistant", "parts": [{"type": "text", "content": "second"}]},
        ]
        bag = _make_bag(
            {
                "gen_ai.operation.name": "invoke_agent",
                "pydantic_ai.all_messages": dumps(all_messages),
                "agent_name": "agent",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"]["prompt"] == [
            {"role": "user", "content": "hello"},
            {"role": "user", "content": "again"},
        ]
        assert features.data["outputs"]["completion"] == [
            {"role": "assistant", "content": "first"},
            {"role": "assistant", "content": "second"},
        ]

    def test_agent_with_unknown_message_format_falls_back(self, adapter):
        """Messages that don't match {role, parts} format are stored raw."""
        unknown_messages = [
            {
                "kind": "request",
                "parts": [{"part_kind": "user-prompt", "content": "hi"}],
            },
            {"kind": "response", "parts": [{"part_kind": "text", "content": "hello"}]},
        ]
        bag = _make_bag(
            {
                "gen_ai.operation.name": "invoke_agent",
                "pydantic_ai.all_messages": dumps(unknown_messages),
                "agent_name": "agent",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"]["messages"] == unknown_messages

    def test_agent_does_not_override_chat_data(self, adapter):
        """If chat extraction already populated features.data, agent extraction skips."""
        bag = _make_bag(
            {
                "gen_ai.operation.name": "invoke_agent",
                "gen_ai.input.messages": dumps(
                    [{"role": "user", "parts": [{"type": "text", "content": "hi"}]}]
                ),
                "gen_ai.output.messages": dumps(
                    [
                        {
                            "role": "assistant",
                            "parts": [{"type": "text", "content": "hello"}],
                            "finish_reason": "stop",
                        }
                    ]
                ),
                "pydantic_ai.all_messages": dumps([]),
                "final_result": "hello",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert "prompt" in features.data["inputs"]
        assert "completion" in features.data["outputs"]


# ── Message Normalization ───────────────────────────────────────────


class TestMessageNormalization:
    def test_single_text_part(self):
        messages = [{"role": "user", "parts": [{"type": "text", "content": "hello"}]}]
        result = _normalize_pydantic_messages(messages)
        assert result == [{"role": "user", "content": "hello"}]

    def test_passthrough_standard_format(self):
        messages = [{"role": "user", "content": "already standard"}]
        result = _normalize_pydantic_messages(messages)
        assert result == [{"role": "user", "content": "already standard"}]

    def test_tool_call_parts(self):
        messages = [
            {
                "role": "assistant",
                "parts": [
                    {"type": "text", "content": "Let me check"},
                    {
                        "type": "tool_call",
                        "id": "call_1",
                        "name": "search",
                        "arguments": {"q": "test"},
                    },
                ],
            }
        ]
        result = _normalize_pydantic_messages(messages)
        assert len(result) == 1
        assert result[0]["content"] == "Let me check"
        assert result[0]["tool_calls"][0]["function"]["name"] == "search"

    def test_tool_response_parts(self):
        messages = [
            {
                "role": "user",
                "parts": [
                    {
                        "type": "tool_call_response",
                        "id": "call_1",
                        "name": "search",
                        "result": [{"found": True}],
                    }
                ],
            }
        ]
        result = _normalize_pydantic_messages(messages)
        assert result == [
            {
                "role": "tool",
                "content": [{"found": True}],
                "tool_call_id": "call_1",
                "name": "search",
            }
        ]

    def test_thinking_parts(self):
        messages = [
            {
                "role": "assistant",
                "parts": [
                    {"type": "thinking", "content": "Let me reason..."},
                    {"type": "text", "content": "Here's my answer"},
                ],
            }
        ]
        result = _normalize_pydantic_messages(messages)
        assert len(result) == 1
        assert result[0]["content"] == "Here's my answer"
        assert result[0]["thinking"] == "Let me reason..."

    def test_empty_parts(self):
        messages = [{"role": "user", "parts": []}]
        result = _normalize_pydantic_messages(messages)
        assert result == [{"role": "user", "content": ""}]

    def test_non_dict_messages_skipped(self):
        messages = ["not a dict", 42, {"role": "user", "content": "valid"}]
        result = _normalize_pydantic_messages(messages)
        assert result == [{"role": "user", "content": "valid"}]

    def test_finish_reason_preserved(self):
        messages = [
            {
                "role": "assistant",
                "parts": [{"type": "text", "content": "done"}],
                "finish_reason": "stop",
            }
        ]
        result = _normalize_pydantic_messages(messages)
        assert result[0]["finish_reason"] == "stop"


# ── V1 Events Fallback ─────────────────────────────────────────────


class TestV1EventsFallback:
    def test_events_based_extraction(self, adapter):
        events = [
            {
                "event.name": "gen_ai.system.message",
                "role": "system",
                "content": "Be helpful",
            },
            {"event.name": "gen_ai.user.message", "role": "user", "content": "hi"},
            {
                "event.name": "gen_ai.choice",
                "message": {"role": "assistant", "content": "Hello!"},
            },
        ]
        bag = _make_bag(
            {
                "gen_ai.system": "openai",
                "events": dumps(events),
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"]["prompt"] == [
            {"role": "system", "content": "Be helpful"},
            {"role": "user", "content": "hi"},
        ]
        assert features.data["outputs"]["completion"] == [
            {"role": "assistant", "content": "Hello!"}
        ]

    def test_v2_takes_precedence_over_v1(self, adapter):
        """When both v2 and v1 data exist, v2 wins."""
        bag = _make_bag(
            {
                "gen_ai.operation.name": "chat",
                "gen_ai.system": "openai",
                "gen_ai.input.messages": dumps(
                    [
                        {
                            "role": "user",
                            "parts": [{"type": "text", "content": "v2 data"}],
                        }
                    ]
                ),
                "events": dumps(
                    [
                        {
                            "event.name": "gen_ai.user.message",
                            "role": "user",
                            "content": "v1 data",
                        },
                    ]
                ),
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"]["prompt"][0]["content"] == "v2 data"


# ── Attribute Map Updates ───────────────────────────────────────────


class TestAttributeMapUpdates:
    def test_tool_response_mapped_to_meta(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.tool.name": "test_tool",
                "tool_response": '{"result": "ok"}',
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["tool_response"] == '{"result": "ok"}'

    def test_v3_tool_call_arguments_mapped(self, adapter):
        bag = _make_bag({"gen_ai.tool.call.arguments": '{"key": "value"}'})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["tool.call.arguments"] == '{"key": "value"}'

    def test_v3_tool_call_result_mapped(self, adapter):
        bag = _make_bag({"gen_ai.tool.call.result": '{"data": 42}'})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["tool.call.result"] == '{"data": 42}'

    def test_cache_read_tokens_mapped(self, adapter):
        bag = _make_bag({"gen_ai.usage.cache_read.input_tokens": 2304})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.metrics["unit.tokens.cache_read"] == 2304

    def test_provider_name_mapped(self, adapter):
        bag = _make_bag({"gen_ai.provider.name": "openai"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["provider.name"] == "openai"


# ── Edge Cases ──────────────────────────────────────────────────────


class TestEdgeCases:
    def test_no_pydanticai_data_returns_early(self, adapter):
        bag = _make_bag({"some.other.attribute": "value"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data == {}
        assert features.meta == {}

    def test_malformed_json_messages(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "chat",
                "gen_ai.system": "openai",
                "gen_ai.input.messages": "{not valid json",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert "inputs" not in features.data

    def test_malformed_json_tool_args(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": "broken",
                "tool_arguments": "{bad json",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"]["arguments"] == "{bad json"


# ── Full Realistic Spans (from raw-data.md) ─────────────────────────


class TestRealisticSpans:
    def test_chat_span_from_raw_data(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "chat",
                "gen_ai.system": "openai",
                "gen_ai.request.model": "gpt-4o-mini",
                "gen_ai.response.model": "gpt-4o-mini-2024-07-18",
                "gen_ai.response.finish_reasons": ["stop"],
                "gen_ai.usage.input_tokens": 2351,
                "gen_ai.usage.output_tokens": 12,
                "gen_ai.provider.name": "openai",
                "gen_ai.input.messages": dumps(
                    [
                        {
                            "role": "system",
                            "parts": [
                                {
                                    "type": "text",
                                    "content": "You are the concierge agent for **The Agenta Grand Hotel**...",
                                },
                                {
                                    "type": "text",
                                    "content": "  # Runtime context - Current guest: Sarah (tier: standard, id: guest_sarah) - Today: 2026-05-15 ",
                                },
                            ],
                        },
                        {
                            "role": "user",
                            "parts": [{"type": "text", "content": "hi"}],
                        },
                    ]
                ),
                "gen_ai.output.messages": dumps(
                    [
                        {
                            "role": "assistant",
                            "parts": [
                                {
                                    "type": "text",
                                    "content": "Hello, Sarah! How can I assist you today?",
                                }
                            ],
                            "finish_reason": "stop",
                        }
                    ]
                ),
            },
            span_name="chat gpt-4o-mini",
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert len(features.data["inputs"]["prompt"]) == 2
        system_msg = features.data["inputs"]["prompt"][0]
        assert system_msg["role"] == "system"
        assert "Agenta Grand Hotel" in system_msg["content"]
        assert "Runtime context" in system_msg["content"]

        user_msg = features.data["inputs"]["prompt"][1]
        assert user_msg == {"role": "user", "content": "hi"}

        completion = features.data["outputs"]["completion"]
        assert len(completion) == 1
        assert completion[0]["content"] == "Hello, Sarah! How can I assist you today?"
        assert completion[0]["finish_reason"] == "stop"

        assert features.meta["request.model"] == "gpt-4o-mini"
        assert features.metrics["unit.tokens.prompt"] == 2351
        assert features.type["node"] == "chat"

    def test_tool_span_from_raw_data(self, adapter):
        bag = _make_bag(
            {
                "gen_ai.operation.name": "execute_tool",
                "gen_ai.tool.name": "search_availability",
                "gen_ai.tool.call.id": "call_DGIZ4OAH9bP9eKpypXmYwTHG",
                "tool_arguments": '{"check_in": "2026-05-16", "check_out": "2026-05-17", "guests": 1}',
                "tool_response": '[{"room_type":"STD","rate_plan":"FLEX","nightly_rate":"180.00","available_units":6},{"room_type":"STD","rate_plan":"ADV","nightly_rate":"153.00","available_units":6},{"room_type":"DLX","rate_plan":"FLEX","nightly_rate":"260.00","available_units":5},{"room_type":"STE","rate_plan":"FLEX","nightly_rate":"420.00","available_units":3}]',
            },
            span_name="running tool",
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"]["name"] == "search_availability"
        assert features.data["inputs"]["arguments"]["check_in"] == "2026-05-16"
        assert features.data["inputs"]["arguments"]["guests"] == 1
        assert len(features.data["outputs"]) == 4
        assert features.data["outputs"][0]["room_type"] == "STD"
        assert features.type["node"] == "tool"

    def test_agent_span_from_raw_data(self, adapter):
        all_messages = [
            {
                "role": "system",
                "parts": [
                    {"type": "text", "content": "You are the concierge agent..."}
                ],
            },
            {
                "role": "user",
                "parts": [{"type": "text", "content": "hi"}],
            },
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "text",
                        "content": "Hello, Sarah! How can I assist you today?",
                    }
                ],
                "finish_reason": "stop",
            },
            {
                "role": "user",
                "parts": [{"type": "text", "content": "I wanted to know your name"}],
            },
            {
                "role": "assistant",
                "parts": [
                    {
                        "type": "text",
                        "content": "I'm your concierge agent here at The Agenta Grand Hotel.",
                    }
                ],
                "finish_reason": "stop",
            },
        ]
        bag = _make_bag(
            {
                "gen_ai.operation.name": "invoke_agent",
                "agent_name": "agent",
                "model_name": "gpt-4o-mini",
                "final_result": "I'm your concierge agent here at The Agenta Grand Hotel.",
                "pydantic_ai.all_messages": dumps(all_messages),
                "pydantic_ai.new_message_index": 2,
            },
            span_name="agent run",
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"]["prompt"] == [
            {"role": "system", "content": "You are the concierge agent..."},
            {"role": "user", "content": "hi"},
            {"role": "user", "content": "I wanted to know your name"},
        ]
        assert features.data["outputs"]["completion"] == [
            {
                "role": "assistant",
                "content": "Hello, Sarah! How can I assist you today?",
                "finish_reason": "stop",
            },
            {
                "role": "assistant",
                "content": "I'm your concierge agent here at The Agenta Grand Hotel.",
                "finish_reason": "stop",
            },
        ]
        assert features.type["node"] == "agent"
        assert features.meta["agent_name"] == "agent"
        assert (
            features.meta["final_result"]
            == "I'm your concierge agent here at The Agenta Grand Hotel."
        )
