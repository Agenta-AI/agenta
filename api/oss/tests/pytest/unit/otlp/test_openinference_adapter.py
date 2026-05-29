"""Unit tests for the OpenInference adapter.

Tests the mapping of OpenInference `llm.*` / `*.value` span attributes to
Agenta's `ag.*` canonical attributes, with a focus on how LLM tool
definitions are parsed.

OpenInference encodes each tool as `llm.tools.{i}.tool.json_schema`, a JSON
string holding the full OpenAI tool object. The adapter parses it into a
structured object at `ag.data.inputs.tools.{i}` so consumers receive
`{type, function}` rather than a `{tool: {json_schema: "..."}}` wrapper.

All tests are self-contained: they construct a ``CanonicalAttributes`` bag,
run the adapter, and assert the resulting ``SpanFeatures``.
"""

from datetime import datetime, timezone
from json import dumps

import pytest

from oss.src.apis.fastapi.otlp.extractors.adapters.openinference_adapter import (
    OpenInferenceAdapter,
)
from oss.src.apis.fastapi.otlp.extractors.adapter_registry import AdapterRegistry
from oss.src.apis.fastapi.otlp.extractors.canonical_attributes import (
    CanonicalAttributes,
    SpanFeatures,
)
from oss.src.core.otel.dtos import OTelSpanKind, OTelStatusCode
from oss.src.core.tracing.utils.attributes import unmarshall_attributes


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


def _openai_tool(name: str = "HTTP_Request1") -> dict:
    """A realistic OpenAI-format tool object (note the empty `properties`)."""
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": "Makes an HTTP request and returns the response data",
            "parameters": {
                "type": "object",
                "properties": {},
                "additionalProperties": False,
                "$schema": "http://json-schema.org/draft-07/schema#",
            },
            "strict": False,
        },
    }


@pytest.fixture
def adapter() -> OpenInferenceAdapter:
    return OpenInferenceAdapter()


# ── Tool Definition Parsing ──────────────────────────────────────────


class TestToolParsing:
    def test_single_tool_parsed_into_object(self, adapter):
        """`llm.tools.0.tool.json_schema` becomes a structured object."""
        tool = _openai_tool()
        bag = _make_bag({"llm.tools.0.tool.json_schema": dumps(tool)})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs.tools.0"] == tool

    def test_parsed_tool_exposes_type_and_function(self, adapter):
        """The frontend reads `tool.type` and `tool.function.name` directly."""
        tool = _openai_tool("get_weather")
        bag = _make_bag({"llm.tools.0.tool.json_schema": dumps(tool)})
        features = SpanFeatures()
        adapter.process(bag, features)

        parsed = features.data["inputs.tools.0"]
        assert parsed["type"] == "function"
        assert parsed["function"]["name"] == "get_weather"

    def test_does_not_emit_wrapped_json_schema_shape(self, adapter):
        """The old `{tool: {json_schema}}` wrapper must not be produced."""
        bag = _make_bag({"llm.tools.0.tool.json_schema": dumps(_openai_tool())})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert "inputs.tools.0.tool.json_schema" not in features.data

    def test_multiple_tools_parsed(self, adapter):
        first = _openai_tool("tool_one")
        second = _openai_tool("tool_two")
        bag = _make_bag(
            {
                "llm.tools.0.tool.json_schema": dumps(first),
                "llm.tools.1.tool.json_schema": dumps(second),
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs.tools.0"] == first
        assert features.data["inputs.tools.1"] == second

    def test_unparseable_schema_kept_as_raw_string(self, adapter):
        """An unparseable schema is preserved rather than dropped."""
        bag = _make_bag({"llm.tools.0.tool.json_schema": "{not valid json"})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs.tools.0.tool.json_schema"] == "{not valid json"
        assert "inputs.tools.0" not in features.data

    def test_round_trip_produces_clean_tools_list(self, adapter):
        """End-to-end: parsed tools unmarshall into a clean `tools` list.

        This mirrors how the span builder assembles flat `ag.data.*` keys and
        how `_parse_span_from_request` unmarshalls them before storage.
        """
        tool = _openai_tool()
        bag = _make_bag({"llm.tools.0.tool.json_schema": dumps(tool)})
        features = SpanFeatures()
        adapter.process(bag, features)

        flat_attributes = {f"ag.data.{k}": v for k, v in features.data.items()}
        nested = unmarshall_attributes(flat_attributes)

        tools = nested["ag"]["data"]["inputs"]["tools"]
        assert tools == [tool]
        # Empty objects such as `properties: {}` must survive the round trip.
        assert tools[0]["function"]["parameters"]["properties"] == {}

    def test_round_trip_with_two_tools(self, adapter):
        """Two tools unmarshall into a clean two-element list, not wrappers."""
        first = _openai_tool("AI_Agent_Tool")
        second = _openai_tool("HTTP_Request")
        bag = _make_bag(
            {
                "llm.tools.0.tool.json_schema": dumps(first),
                "llm.tools.1.tool.json_schema": dumps(second),
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        flat_attributes = {f"ag.data.{k}": v for k, v in features.data.items()}
        nested = unmarshall_attributes(flat_attributes)

        tools = nested["ag"]["data"]["inputs"]["tools"]
        assert tools == [first, second]
        # The legacy `{tool: {json_schema}}` wrapper must not appear.
        assert "tool" not in tools[0]
        assert "tool" not in tools[1]


# ── Tool Spans (singular tool.* attributes) ──────────────────────────


class TestSingularToolAttributes:
    def test_singular_tool_json_schema_goes_to_meta(self, adapter):
        """A TOOL span's own `tool.json_schema` is unrelated to `llm.tools`."""
        bag = _make_bag({"tool.json_schema": dumps(_openai_tool())})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert "tool.json_schema" in features.meta
        assert features.data == {}


# ── Existing mappings still work ─────────────────────────────────────


class TestUnaffectedMappings:
    def test_input_messages_still_mapped(self, adapter):
        bag = _make_bag(
            {
                "openinference.span.kind": "LLM",
                "llm.input_messages.0.message.role": "user",
                "llm.input_messages.0.message.content": "hi",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.data["inputs.prompt.0.role"] == "user"
        assert features.data["inputs.prompt.0.content"] == "hi"

    def test_invocation_parameters_mapped_to_meta_request(self, adapter):
        """`llm.invocation_parameters` is kept verbatim (a JSON string)."""
        raw = dumps({"model": "gpt-5.4-nano"})
        bag = _make_bag({"llm.invocation_parameters": raw})
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.meta["request"] == raw


# ── Full Realistic Span ──────────────────────────────────────────────


class TestRealisticSpan:
    def test_langchain_chat_span_with_tool(self, adapter):
        """A LangChain ChatOpenAI span carrying one tool and a user prompt."""
        tool = _openai_tool()
        bag = _make_bag(
            {
                "openinference.span.kind": "LLM",
                "llm.model_name": "gpt-5.4-nano",
                "llm.invocation_parameters": dumps(
                    {"model": "gpt-5.4-nano", "stream": False, "tools": [tool]}
                ),
                "llm.tools.0.tool.json_schema": dumps(tool),
                "llm.input_messages.0.message.role": "user",
                "llm.input_messages.0.message.content": "Answer in arabic:\n\nhi",
            }
        )
        features = SpanFeatures()
        adapter.process(bag, features)

        assert features.type["node"] == "chat"
        assert features.data["inputs.tools.0"] == tool
        assert features.data["inputs.prompt.0.role"] == "user"
        assert features.meta["response.model"] == "gpt-5.4-nano"


# ── Integration: AdapterRegistry ─────────────────────────────────────


class TestRegistryIntegration:
    def test_openinference_in_registry(self):
        """Verify tool parsing works within the full registry pipeline."""
        tool = _openai_tool()
        registry = AdapterRegistry()
        bag = _make_bag(
            {
                "openinference.span.kind": "LLM",
                "llm.tools.0.tool.json_schema": dumps(tool),
            }
        )
        features = registry.extract_features(bag)

        assert features.data["inputs.tools.0"] == tool
