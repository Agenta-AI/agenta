"""Unit tests for parse_llm_call_context (entities.md §9, workstreams/specs-wp6.md).

Nothing running: the parser is exercised as a plain function over bytes.
"""

import json

import pytest

from oss.src.core.gateways.llms.dtos import LlmCallContext
from oss.src.apis.fastapi.gateways.llms.utils import parse_llm_call_context


def _encode(payload: dict) -> bytes:
    return json.dumps(payload).encode()


def test_streaming_body_extracts_model_and_stream():
    body = _encode(
        {
            "model": "gpt-4o",
            "stream": True,
            "messages": [{"role": "user", "content": "hi"}],
        }
    )

    context = parse_llm_call_context(body=body)

    assert context == LlmCallContext(model="gpt-4o", stream=True)


def test_non_streaming_body_defaults_stream_false():
    body = _encode({"model": "gpt-4o", "messages": []})

    context = parse_llm_call_context(body=body)

    assert context == LlmCallContext(model="gpt-4o", stream=False)


def test_missing_model_raises_value_error():
    body = _encode({"stream": True, "messages": []})

    with pytest.raises(ValueError):
        parse_llm_call_context(body=body)


def test_empty_model_raises_value_error():
    body = _encode({"model": "", "messages": []})

    with pytest.raises(ValueError):
        parse_llm_call_context(body=body)


def test_malformed_json_raises_value_error():
    with pytest.raises(ValueError):
        parse_llm_call_context(body=b"{not json")


def test_does_not_mutate_or_wrap_input_bytes():
    original = _encode({"model": "gpt-4o", "stream": True})
    body = bytes(original)

    context = parse_llm_call_context(body=body)

    assert body == original
    assert context.model == "gpt-4o"
