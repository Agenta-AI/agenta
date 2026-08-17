"""Unit tests for the front-door parsers (entities.md §9, D33, workstreams/specs-wp23.md).

Nothing running: each parser is exercised as a plain function over bytes.
"""

import json

import pytest

from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMProtocol
from oss.src.apis.fastapi.gateways.llms.utils import (
    parse_llm_call_context,
    parse_messages_call_context,
    parse_responses_call_context,
)


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

    assert context == LLMCallContext(model="gpt-4o", stream=True)


def test_non_streaming_body_defaults_stream_false():
    body = _encode({"model": "gpt-4o", "messages": []})

    context = parse_llm_call_context(body=body)

    assert context == LLMCallContext(model="gpt-4o", stream=False)


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


def test_chat_completions_context_is_tagged_with_its_protocol():
    context = parse_llm_call_context(body=_encode({"model": "gpt-4o"}))

    assert context.protocol == LLMProtocol.CHAT_COMPLETIONS


# --- parse_responses_call_context, parse_messages_call_context (D33, WP23) --------- #

_DOOR_PARSERS = [
    (parse_responses_call_context, LLMProtocol.RESPONSES),
    (parse_messages_call_context, LLMProtocol.MESSAGES),
]


@pytest.mark.parametrize("parser,protocol", _DOOR_PARSERS)
def test_door_parser_extracts_model_and_stream_and_tags_its_protocol(parser, protocol):
    body = _encode({"model": "claude-3", "stream": True, "input": []})

    context = parser(body=body)

    assert context == LLMCallContext(model="claude-3", stream=True, protocol=protocol)


@pytest.mark.parametrize("parser,protocol", _DOOR_PARSERS)
def test_door_parser_defaults_stream_false(parser, protocol):
    body = _encode({"model": "claude-3"})

    context = parser(body=body)

    assert context.stream is False
    assert context.protocol == protocol


@pytest.mark.parametrize("parser", [p for p, _ in _DOOR_PARSERS])
def test_door_parser_missing_model_raises_value_error(parser):
    with pytest.raises(ValueError):
        parser(body=_encode({"stream": True}))


@pytest.mark.parametrize("parser", [p for p, _ in _DOOR_PARSERS])
def test_door_parser_malformed_json_raises_value_error(parser):
    with pytest.raises(ValueError):
        parser(body=b"{not json")


@pytest.mark.parametrize("parser", [p for p, _ in _DOOR_PARSERS])
def test_door_parser_does_not_mutate_input_bytes(parser):
    original = _encode({"model": "claude-3", "stream": True})
    body = bytes(original)

    parser(body=body)

    assert body == original
