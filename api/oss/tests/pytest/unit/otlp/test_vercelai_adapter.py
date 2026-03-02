"""Unit tests for the VercelAI adapter.

Tests the mapping of Vercel AI SDK `ai.*` span attributes to Agenta's `ag.*`
canonical attributes.  These are the first adapter unit tests in the codebase
and establish the pattern for testing other adapters.

All tests are self-contained: they construct a ``CanonicalAttributes`` bag,
run the adapter, and assert the resulting ``SpanFeatures``.
"""

from datetime import datetime, timezone
from json import dumps

import pytest

from oss.src.apis.fastapi.otlp.extractors.adapters.vercelai_adapter import (
    VercelAIAdapter,
)
from oss.src.apis.fastapi.otlp.extractors.adapter_registry import AdapterRegistry
from oss.src.apis.fastapi.otlp.extractors.canonical_attributes import (
    CanonicalAttributes,
    SpanFeatures,
)
from oss.src.core.otel.dtos import OTelSpanKind, OTelStatusCode


# ── helpers ──────────────────────────────────────────────────────────


def _make_bag(
    span_attributes: dict, span_name: str = "test-span"
) -> CanonicalAttributes:
    """Build a minimal CanonicalAttributes bag for testing."""
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
def adapter() -> VercelAIAdapter:
    return VercelAIAdapter()


# ── Model Info ───────────────────────────────────────────────────────


class TestModelInfo:
    def test_maps_model_id(self, adapter):
        bag = _make_bag({"ai.model.id": "gpt-4o-mini"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.model"] == "gpt-4o-mini"

    def test_maps_model_provider(self, adapter):
        bag = _make_bag({"ai.model.provider": "openai.chat"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["system"] == "openai.chat"

    def test_maps_response_model(self, adapter):
        bag = _make_bag({"ai.response.model": "gpt-4o-mini-2024-07-18"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["response.model"] == "gpt-4o-mini-2024-07-18"

    def test_maps_response_id(self, adapter):
        bag = _make_bag({"ai.response.id": "chatcmpl-abc123"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["response.id"] == "chatcmpl-abc123"

    def test_maps_response_timestamp(self, adapter):
        bag = _make_bag({"ai.response.timestamp": "2026-01-01T00:00:00Z"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["response.timestamp"] == "2026-01-01T00:00:00Z"


# ── Input Extraction ─────────────────────────────────────────────────


class TestInputExtraction:
    def test_maps_prompt_json(self, adapter):
        """ai.prompt is a JSON string with {system?, prompt?, messages?}."""
        prompt_data = {
            "system": "You are helpful.",
            "messages": [{"role": "user", "content": "Hello"}],
        }
        bag = _make_bag({"ai.prompt": dumps(prompt_data)})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"] == prompt_data

    def test_maps_prompt_messages_json(self, adapter):
        """ai.prompt.messages (inner span) is a JSON array."""
        messages = [{"role": "user", "content": [{"type": "text", "text": "Hi"}]}]
        bag = _make_bag({"ai.prompt.messages": dumps(messages)})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs.prompt"] == messages

    def test_maps_toolcall_name(self, adapter):
        bag = _make_bag({"ai.toolCall.name": "get_weather"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs.name"] == "get_weather"

    def test_maps_toolcall_args_json(self, adapter):
        args = {"location": "Berlin", "units": "celsius"}
        bag = _make_bag({"ai.toolCall.args": dumps(args)})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs.args"] == args


# ── Output Extraction ────────────────────────────────────────────────


class TestOutputExtraction:
    def test_maps_response_text(self, adapter):
        bag = _make_bag({"ai.response.text": "Hello there!"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["outputs"] == "Hello there!"

    def test_maps_response_object_json(self, adapter):
        obj = {"name": "Berlin", "country": "Germany"}
        bag = _make_bag({"ai.response.object": dumps(obj)})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["outputs"] == obj

    def test_maps_response_toolcalls_json(self, adapter):
        tool_calls = [
            {
                "toolCallId": "tc1",
                "toolName": "get_weather",
                "input": {"city": "Berlin"},
            }
        ]
        bag = _make_bag({"ai.response.toolCalls": dumps(tool_calls)})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["outputs.toolCalls"] == tool_calls

    def test_maps_response_reasoning(self, adapter):
        bag = _make_bag({"ai.response.reasoning": "Let me think about this..."})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["outputs.reasoning"] == "Let me think about this..."

    def test_maps_toolcall_result_json(self, adapter):
        result = {"temperature": 22, "condition": "sunny"}
        bag = _make_bag({"ai.toolCall.result": dumps(result)})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["outputs"] == result

    def test_maps_toolcall_result_plain_string(self, adapter):
        """Tool result that is not valid JSON stays as string."""
        bag = _make_bag({"ai.toolCall.result": "plain text result"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["outputs"] == "plain text result"


# ── Token Usage — generateText naming ────────────────────────────────


class TestTokenUsageGenerateText:
    def test_maps_prompt_tokens(self, adapter):
        bag = _make_bag({"ai.usage.promptTokens": 42})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.metrics["unit.tokens.prompt"] == 42

    def test_maps_completion_tokens(self, adapter):
        bag = _make_bag({"ai.usage.completionTokens": 128})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.metrics["unit.tokens.completion"] == 128


# ── Token Usage — streamText naming ──────────────────────────────────


class TestTokenUsageStreamText:
    def test_maps_input_tokens(self, adapter):
        bag = _make_bag({"ai.usage.inputTokens": 55})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.metrics["unit.tokens.prompt"] == 55

    def test_maps_output_tokens(self, adapter):
        bag = _make_bag({"ai.usage.outputTokens": 200})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.metrics["unit.tokens.completion"] == 200

    def test_maps_total_tokens(self, adapter):
        bag = _make_bag({"ai.usage.totalTokens": 255})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.metrics["unit.tokens.total"] == 255

    def test_maps_reasoning_tokens(self, adapter):
        bag = _make_bag({"ai.usage.reasoningTokens": 30})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.metrics["unit.tokens.reasoning"] == 30

    def test_maps_cached_input_tokens(self, adapter):
        bag = _make_bag({"ai.usage.cachedInputTokens": 10})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.metrics["unit.tokens.cached"] == 10


# ── Settings Mapping ─────────────────────────────────────────────────


class TestSettingsMapping:
    def test_maps_temperature(self, adapter):
        bag = _make_bag({"ai.settings.temperature": 0.7})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.temperature"] == 0.7

    def test_maps_top_p(self, adapter):
        bag = _make_bag({"ai.settings.topP": 0.9})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.top_p"] == 0.9

    def test_maps_top_k(self, adapter):
        bag = _make_bag({"ai.settings.topK": 40})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.top_k"] == 40

    def test_maps_max_output_tokens(self, adapter):
        bag = _make_bag({"ai.settings.maxOutputTokens": 1024})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.max_tokens"] == 1024

    def test_maps_frequency_penalty(self, adapter):
        bag = _make_bag({"ai.settings.frequencyPenalty": 0.5})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.frequency_penalty"] == 0.5

    def test_maps_presence_penalty(self, adapter):
        bag = _make_bag({"ai.settings.presencePenalty": 0.3})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.presence_penalty"] == 0.3

    def test_maps_stop_sequences(self, adapter):
        bag = _make_bag({"ai.settings.stopSequences": ["END", "STOP"]})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.stop_sequences"] == ["END", "STOP"]

    def test_maps_seed(self, adapter):
        bag = _make_bag({"ai.settings.seed": 42})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.seed"] == 42

    def test_maps_max_retries(self, adapter):
        bag = _make_bag({"ai.settings.maxRetries": 3})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.max_retries"] == 3


# ── Operation Type Mapping ───────────────────────────────────────────


class TestOperationTypeMapping:
    @pytest.mark.parametrize(
        "operation_id,expected_type",
        [
            ("ai.generateText", "task"),
            ("ai.generateText.doGenerate", "task"),
            ("ai.streamText", "task"),
            ("ai.streamText.doStream", "task"),
            ("ai.toolCall", "tool"),
            ("ai.embed", "embedding"),
            ("ai.embedMany", "embedding"),
        ],
    )
    def test_maps_operation_id_to_node_type(self, adapter, operation_id, expected_type):
        bag = _make_bag({"ai.operationId": operation_id})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.type["node"] == expected_type

    def test_unknown_operation_defaults_to_task(self, adapter):
        bag = _make_bag({"ai.operationId": "ai.someNewOperation"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.type["node"] == "task"


# ── Finish Reason ────────────────────────────────────────────────────


class TestFinishReason:
    def test_wraps_finish_reason_in_array(self, adapter):
        bag = _make_bag({"ai.response.finishReason": "stop"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["response.finish_reasons"] == ["stop"]

    def test_tool_calls_finish_reason(self, adapter):
        bag = _make_bag({"ai.response.finishReason": "tool-calls"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["response.finish_reasons"] == ["tool-calls"]


# ── Metadata (User / Session) ───────────────────────────────────────


class TestMetadataExtraction:
    def test_maps_user_id(self, adapter):
        bag = _make_bag({"ai.telemetry.metadata.userId": "user-123"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.user["id"] == "user-123"

    def test_maps_session_id(self, adapter):
        bag = _make_bag({"ai.telemetry.metadata.sessionId": "sess-456"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.session["id"] == "sess-456"


# ── JSON Parsing Edge Cases ──────────────────────────────────────────


class TestJsonParsing:
    def test_malformed_json_prompt_kept_as_string(self, adapter):
        """Unparseable JSON in ai.prompt is kept as the raw string."""
        bag = _make_bag({"ai.prompt": "{not valid json"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"] == "{not valid json"

    def test_malformed_json_toolcall_args_kept_as_string(self, adapter):
        bag = _make_bag({"ai.toolCall.args": "not json"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs.args"] == "not json"

    def test_non_string_value_not_parsed(self, adapter):
        """If ai.prompt is already a dict (shouldn't happen, but be safe)."""
        bag = _make_bag({"ai.prompt": {"already": "parsed"}})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs"] == {"already": "parsed"}


# ── Ignoring Unrelated Attributes ────────────────────────────────────


class TestIgnoresUnrelatedAttributes:
    def test_ignores_gen_ai_attributes(self, adapter):
        """gen_ai.* is handled by OpenLLMetry/Logfire, not this adapter."""
        bag = _make_bag(
            {
                "gen_ai.system": "openai",
                "gen_ai.request.model": "gpt-4o",
                "gen_ai.usage.input_tokens": 100,
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta == {}
        assert features.metrics == {}

    def test_ignores_llm_attributes(self, adapter):
        bag = _make_bag({"llm.request.type": "chat", "llm.usage.total_tokens": 50})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta == {}
        assert features.metrics == {}

    def test_ignores_ag_attributes(self, adapter):
        """ag.* is handled by DefaultAgentaAdapter, not this one."""
        bag = _make_bag({"ag.data.inputs": {"text": "hello"}})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data == {}

    def test_empty_bag_produces_empty_features(self, adapter):
        bag = _make_bag({})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data == {}
        assert features.meta == {}
        assert features.metrics == {}
        assert features.type == {}


# ── Full Realistic Spans ─────────────────────────────────────────────


class TestRealisticSpans:
    def test_generate_text_outer_span(self, adapter):
        """Simulate a full ai.generateText outer span with all typical attributes."""
        prompt = {
            "system": "You are a helpful assistant.",
            "messages": [{"role": "user", "content": "Write a short story."}],
        }
        bag = _make_bag(
            {
                "ai.operationId": "ai.generateText",
                "ai.model.id": "gpt-4o-mini",
                "ai.model.provider": "openai.chat",
                "ai.prompt": dumps(prompt),
                "ai.response.text": "Once upon a time...",
                "ai.response.finishReason": "stop",
                "ai.usage.promptTokens": 25,
                "ai.usage.completionTokens": 100,
                "ai.settings.temperature": 0.7,
                "ai.settings.maxRetries": 2,
                "ai.telemetry.metadata.userId": "user-abc",
                # These should be ignored by this adapter
                "ai.telemetry.functionId": "generate-story",
                "operation.name": "ai.generateText generate-story",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        # Data
        assert features.data["inputs"] == prompt
        assert features.data["outputs"] == "Once upon a time..."

        # Meta
        assert features.meta["request.model"] == "gpt-4o-mini"
        assert features.meta["system"] == "openai.chat"
        assert features.meta["request.temperature"] == 0.7
        assert features.meta["request.max_retries"] == 2
        assert features.meta["response.finish_reasons"] == ["stop"]

        # Metrics
        assert features.metrics["unit.tokens.prompt"] == 25
        assert features.metrics["unit.tokens.completion"] == 100

        # Type
        assert features.type["node"] == "task"

        # User
        assert features.user["id"] == "user-abc"

    def test_tool_call_span(self, adapter):
        """Simulate a full ai.toolCall span."""
        args = {"city": "Berlin"}
        result = {"temperature": 22, "unit": "celsius", "condition": "sunny"}
        bag = _make_bag(
            {
                "ai.operationId": "ai.toolCall",
                "ai.toolCall.name": "get_weather",
                "ai.toolCall.id": "call_abc123",
                "ai.toolCall.args": dumps(args),
                "ai.toolCall.result": dumps(result),
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs.name"] == "get_weather"
        assert features.data["inputs.args"] == args
        assert features.data["outputs"] == result
        assert features.type["node"] == "tool"

    def test_stream_text_outer_span(self, adapter):
        """Simulate a full ai.streamText outer span with stream-style token naming."""
        bag = _make_bag(
            {
                "ai.operationId": "ai.streamText",
                "ai.model.id": "claude-3-5-sonnet",
                "ai.model.provider": "anthropic.messages",
                "ai.prompt": dumps({"messages": [{"role": "user", "content": "Hi"}]}),
                "ai.response.text": "Hello!",
                "ai.response.finishReason": "stop",
                "ai.usage.inputTokens": 10,
                "ai.usage.outputTokens": 5,
                "ai.usage.totalTokens": 15,
                # Streaming metrics — not mapped, should be ignored
                "ai.response.msToFirstChunk": 120,
                "ai.response.msToFinish": 800,
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request.model"] == "claude-3-5-sonnet"
        assert features.meta["system"] == "anthropic.messages"
        assert features.metrics["unit.tokens.prompt"] == 10
        assert features.metrics["unit.tokens.completion"] == 5
        assert features.metrics["unit.tokens.total"] == 15
        assert features.type["node"] == "task"


# ── Integration: AdapterRegistry ─────────────────────────────────────


class TestRegistryIntegration:
    def test_vercelai_in_registry(self):
        """Verify the adapter works within the full registry pipeline."""
        registry = AdapterRegistry()
        bag = _make_bag(
            {
                "ai.model.id": "gpt-4o-mini",
                "ai.response.text": "Hello!",
                "ai.usage.promptTokens": 10,
                "ai.usage.completionTokens": 5,
            }
        )
        features = registry.extract_features(bag)

        assert features.meta["request.model"] == "gpt-4o-mini"
        assert features.data["outputs"] == "Hello!"
        assert features.metrics["unit.tokens.prompt"] == 10
        assert features.metrics["unit.tokens.completion"] == 5

    def test_registry_adapter_order(self):
        """Verify VercelAIAdapter is registered and in the right position."""
        registry = AdapterRegistry()
        adapter_names = [a.__class__.__name__ for a in registry._adapters]

        assert "VercelAIAdapter" in adapter_names
        vercel_idx = adapter_names.index("VercelAIAdapter")
        default_idx = adapter_names.index("DefaultAgentaAdapter")

        # VercelAI must be before DefaultAgenta
        assert vercel_idx < default_idx
