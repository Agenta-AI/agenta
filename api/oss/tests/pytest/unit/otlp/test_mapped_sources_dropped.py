"""Raw OpenInference keys are not stored when their ag.* copy is.

The OTLP ingest copies each mapped `llm.*` / `input.*` / `output.*` attribute
into `ag.*`. Storing both doubled the size of CHAT and TOOL spans, so the span
builder drops a raw key once its content is stored, unchanged, under `ag.*`.
"""

from datetime import datetime, timezone
from json import dumps

from oss.src.apis.fastapi.otlp.utils.processing import parse_from_otel_span_dto
from oss.src.core.otel.dtos import (
    OTelContextDTO,
    OTelSpanDTO,
    OTelSpanKind,
    OTelStatusCode,
)


TRACE_ID = "0x31d6cfe04b9011ec800142010a8000b0"
SPAN_ID = "0x31d6cfe04b9011ec"


def _ingest(attributes: dict) -> dict:
    span = parse_from_otel_span_dto(
        OTelSpanDTO(
            context=OTelContextDTO(trace_id=TRACE_ID, span_id=SPAN_ID),
            name="span",
            kind=OTelSpanKind.SPAN_KIND_INTERNAL,
            start_time=datetime(2026, 1, 1, tzinfo=timezone.utc),
            end_time=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
            status_code=OTelStatusCode.STATUS_CODE_OK,
            attributes=attributes,
        )
    )
    assert span is not None
    return span.attributes


def test_chat_span_stores_messages_only_under_ag():
    stored = _ingest(
        {
            "openinference.span.kind": "LLM",
            "gen_ai.request.model": "gpt-5.4-nano",
            "llm.input_messages.0.message.role": "user",
            "llm.input_messages.0.message.content": "hi",
            "llm.output_messages.0.message.role": "assistant",
            "llm.output_messages.0.message.tool_calls.0.tool_call.id": "call_1",
            "llm.output_messages.0.message.tool_calls.0.tool_call.function.name": "f",
        }
    )

    assert "llm" not in stored
    assert stored["ag"]["data"]["inputs"]["prompt"] == [
        {"role": "user", "content": "hi"}
    ]
    assert stored["ag"]["data"]["outputs"]["completion"] == [
        {
            "role": "assistant",
            "tool_calls": [{"id": "call_1", "function": {"name": "f"}}],
        }
    ]
    # Keys no adapter maps away are kept.
    assert stored["openinference"]["span"]["kind"] == "LLM"
    assert stored["gen_ai"]["request"]["model"] == "gpt-5.4-nano"


def test_tool_span_stores_input_and_output_only_under_ag():
    stored = _ingest(
        {
            "openinference.span.kind": "TOOL",
            "gen_ai.tool.name": "read",
            "input.value": dumps({"path": "a.txt"}),
            "input.mime_type": "application/json",
            "output.value": "file body",
        }
    )

    assert "input" not in stored
    assert "output" not in stored
    assert stored["ag"]["data"]["inputs"] == {"path": "a.txt"}
    assert stored["ag"]["data"]["outputs"] == "file body"
    assert stored["ag"]["meta"]["input"]["mime_type"] == "application/json"


def test_tool_definitions_stored_only_under_ag():
    tool = {"type": "function", "function": {"name": "f", "parameters": {}}}
    stored = _ingest(
        {
            "openinference.span.kind": "LLM",
            "llm.tools.0.tool.json_schema": dumps(tool),
        }
    )

    assert "llm" not in stored
    assert stored["ag"]["data"]["inputs"]["tools"] == [tool]


def test_invocation_parameters_kept_for_the_playground():
    params = dumps({"model": "gpt-5.4-nano", "temperature": 0})
    stored = _ingest(
        {
            "openinference.span.kind": "LLM",
            "llm.invocation_parameters": params,
            "llm.input_messages.0.message.role": "user",
        }
    )

    assert stored["llm"] == {"invocation_parameters": params}


def test_token_counts_kept_since_metrics_are_renamed():
    stored = _ingest(
        {
            "openinference.span.kind": "LLM",
            "llm.token_count.prompt": 10,
        }
    )

    assert stored["llm"]["token_count"]["prompt"] == 10


def test_chat_input_value_kept_when_messages_replace_it():
    """On a chat span the messages win, so `input.value` has no ag.* copy."""
    raw = dumps({"messages": [{"role": "user", "content": "hi"}], "seed": 1})
    stored = _ingest(
        {
            "openinference.span.kind": "LLM",
            "input.value": raw,
            "llm.input_messages.0.message.role": "user",
            "llm.input_messages.0.message.content": "hi",
        }
    )

    assert stored["input"]["value"] == raw
    assert "input_messages" not in stored.get("llm", {})


def test_raw_key_kept_when_span_overrides_the_ag_copy():
    """A span's own `ag.data.outputs` wins, so `output.value` is kept."""
    stored = _ingest(
        {
            "openinference.span.kind": "TOOL",
            "output.value": "from openinference",
            "ag.data.outputs": "from agenta",
        }
    )

    assert stored["output"]["value"] == "from openinference"
    assert stored["ag"]["data"]["outputs"] == "from agenta"


def test_raw_key_kept_when_another_key_would_overwrite_the_copy():
    """`ag.data.inputs` from `input.value` and `ag.data.inputs.x` collide."""
    stored = _ingest(
        {
            "openinference.span.kind": "AGENT",
            "input.value": dumps({"prompt": "hi"}),
            "ag.data.inputs.extra": "x",
        }
    )

    assert stored["input"]["value"] == dumps({"prompt": "hi"})


def test_raw_key_kept_when_another_raw_key_nests_under_it():
    """`tool.name` and `tool.name.foo` collide, so the raw shape is kept."""
    stored = _ingest(
        {
            "openinference.span.kind": "TOOL",
            "tool.name": "read",
            "tool.name.foo": "nested",
        }
    )

    assert stored["tool"]["name"] == "read"
    assert stored["ag"]["meta"]["tool"]["name"] == "read"


def test_raw_key_kept_when_parsing_the_json_loses_digits():
    """Ingest parses `ag.data.inputs` from JSON, which rounds long decimals."""
    raw = '{"amount": 0.1234567890123456789}'
    stored = _ingest({"openinference.span.kind": "TOOL", "input.value": raw})

    assert stored["input"]["value"] == raw


def test_raw_key_kept_when_parsing_the_json_drops_duplicate_keys():
    raw = '{"a": 1, "a": 2}'
    stored = _ingest({"openinference.span.kind": "TOOL", "input.value": raw})

    assert stored["input"]["value"] == raw


def test_raw_tool_definition_kept_when_parsing_loses_digits():
    raw = '{"type": "function", "function": {"x": 0.1234567890123456789}}'
    stored = _ingest(
        {"openinference.span.kind": "LLM", "llm.tools.0.tool.json_schema": raw}
    )

    assert stored["llm"]["tools"][0]["tool"]["json_schema"] == raw


def test_raw_key_kept_when_decoding_rewrites_literal_text():
    """`@ag.type=...` text is decoded on the ag.* copy, so the raw text stays."""
    stored = _ingest(
        {
            "openinference.span.kind": "TOOL",
            "output.value": "@ag.type=none:",
            "llm.input_messages.0.message.content": '@ag.type=json:{"answer": 42}',
        }
    )

    assert stored["output"]["value"] == "@ag.type=none:"
    assert (
        stored["llm"]["input_messages"][0]["message"]["content"]
        == '@ag.type=json:{"answer": 42}'
    )


def test_short_decimals_still_dropped():
    stored = _ingest(
        {"openinference.span.kind": "TOOL", "input.value": '{"temperature": 0.7}'}
    )

    assert "input" not in stored
    assert stored["ag"]["data"]["inputs"] == {"temperature": 0.7}
