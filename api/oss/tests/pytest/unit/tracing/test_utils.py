from oss.src.apis.fastapi.tracing.utils import (
    initialize_ag_attributes,
    _parse_span_from_request,
)
from oss.src.core.tracing.dtos import OTelSpan, TraceType, SpanType


def test_initialize_ag_attributes_parses_json_strings_for_dict_typed_ag_data_fields():
    attributes = {
        "ag": {
            "data": {
                "inputs": '{"prompt": "hello"}',
                "parameters": '{"temperature": 0.2}',
                "internals": '{"debug": true}',
                "outputs": '{"answer": "raw-string"}',
            }
        }
    }

    parsed = initialize_ag_attributes(attributes)
    ag_data = parsed["ag"]["data"]

    assert ag_data["inputs"] == '{"prompt": "hello"}'
    assert ag_data["parameters"] == {"temperature": 0.2}
    assert ag_data["internals"] == {"debug": True}
    assert ag_data["outputs"] == '{"answer": "raw-string"}'


def test_initialize_ag_attributes_keeps_ag_data_outputs_as_string():
    attributes = {
        "ag": {
            "data": {
                "outputs": '{"answer": "do-not-parse"}',
            }
        }
    }

    parsed = initialize_ag_attributes(attributes)

    assert parsed["ag"]["data"]["outputs"] == '{"answer": "do-not-parse"}'


def test_initialize_ag_attributes_keeps_ag_data_inputs_as_string():
    attributes = {
        "ag": {
            "data": {
                "inputs": '{"prompt": "do-not-parse"}',
            }
        }
    }

    parsed = initialize_ag_attributes(attributes)

    assert parsed["ag"]["data"]["inputs"] == '{"prompt": "do-not-parse"}'


def test_initialize_ag_attributes_keeps_json_primitives_as_strings_for_non_outputs():
    attributes = {
        "ag": {
            "data": {
                "inputs": "null",
                "internals": "true",
                "parameters": "42",
            }
        }
    }

    parsed = initialize_ag_attributes(attributes)
    ag = parsed["ag"]

    # inputs is Optional[Any], so keep primitive JSON-like strings unchanged
    assert ag["data"]["inputs"] == "null"

    # internals/parameters are dict-typed and invalid primitive strings are sanitized
    assert "internals" not in ag["data"]
    assert "parameters" not in ag["data"]
    assert ag["unsupported"]["data"]["internals"] == "true"
    assert ag["unsupported"]["data"]["parameters"] == "42"


def test_initialize_ag_attributes_moves_invalid_ag_data_subfield_to_unsupported():
    attributes = {
        "ag": {
            "data": {
                "inputs": {"prompt": "hello"},
                "parameters": ["not-a-dict"],
                "outputs": "ok",
            }
        }
    }

    parsed = initialize_ag_attributes(attributes)
    ag = parsed["ag"]

    assert ag["data"]["inputs"] == {"prompt": "hello"}
    assert ag["data"]["outputs"] == "ok"
    assert "parameters" not in ag["data"]
    assert ag["unsupported"]["data"]["parameters"] == ["not-a-dict"]


def test_initialize_ag_attributes_handles_non_dict_unsupported_payload():
    attributes = {
        "ag": {
            "unsupported": "oops",
            "data": {
                "inputs": '{"prompt": "hello"}',
            },
        }
    }

    parsed = initialize_ag_attributes(attributes)

    assert parsed["ag"]["data"]["inputs"] == '{"prompt": "hello"}'
    assert isinstance(parsed["ag"]["metrics"], dict)
    assert parsed["ag"]["unsupported"]["_unsupported"] == "oops"


def test_initialize_ag_attributes_handles_non_dict_ag_payload():
    parsed = initialize_ag_attributes({"ag": "bad-ag-payload"})

    assert isinstance(parsed["ag"]["type"], dict)
    assert isinstance(parsed["ag"]["data"], dict)
    assert isinstance(parsed["ag"]["metrics"], dict)
    assert parsed["ag"]["unsupported"]["_invalid"] == "bad-ag-payload"


def test_parse_span_from_request_falls_back_for_invalid_trace_and_span_type_values():
    raw_span = OTelSpan(
        trace_id="31d6cfe0-4b90-11ec-8001-42010a8000b0",
        span_id="31d6cfe0-4b90-11ec-31d6-cfe04b9011ec",
        span_name="test-span",
        attributes={
            "ag": {
                "type": {
                    "trace": "not-a-valid-trace-type",
                    "span": "not-a-valid-span-type",
                }
            }
        },
    )

    parsed_spans = _parse_span_from_request(raw_span)

    assert parsed_spans is not None
    assert parsed_spans[0].trace_type == TraceType.INVOCATION
    assert parsed_spans[0].span_type == SpanType.TASK
