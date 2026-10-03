"""Unit tests for static field rewrites.

Nothing running: pure functions over bytes, no I/O.
"""

import inspect
import json

import pytest

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind, LLMProtocol
from oss.src.core.gateways.llms.providers.passthrough.static_fields import (
    LLMStaticFieldRewrite,
    STATIC_FIELD_REWRITES,
    apply_static_fields,
)

_LITERAL_TYPES = (str, int, float, bool, type(None))


def _messages_body(**extra) -> bytes:
    payload = {
        "model": "claude-3-5-sonnet",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "hi"}],
    }
    payload.update(extra)
    return json.dumps(payload).encode()


def test_vertex_adds_anthropic_version_and_removes_model():
    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.VERTEX,
        protocol=LLMProtocol.MESSAGES,
        body=_messages_body(),
    )

    payload = json.loads(result)
    assert payload["anthropic_version"] == "vertex-2023-10-16"
    assert "model" not in payload


def test_existing_anthropic_version_is_not_overwritten():
    """setdefault semantics, mirroring the vendor SDKs: the caller's own value stands."""
    body = _messages_body(anthropic_version="caller-supplied-value")

    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.VERTEX,
        protocol=LLMProtocol.MESSAGES,
        body=body,
    )

    assert json.loads(result)["anthropic_version"] == "caller-supplied-value"


def test_vertex_rewrite_preserves_json_meaning_not_source_formatting():
    body = b'{  "model" : "claude-3-5-sonnet", "note": "\\u00e9", "messages" : [] }'

    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.VERTEX,
        protocol=LLMProtocol.MESSAGES,
        body=body,
    )

    assert result != body
    assert json.loads(result) == {
        "note": "é",
        "messages": [],
        "anthropic_version": "vertex-2023-10-16",
    }


def test_non_messages_protocol_leaves_vertex_body_untouched():
    body = _messages_body()

    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.VERTEX,
        protocol=LLMProtocol.CHAT_COMPLETIONS,
        body=body,
    )

    assert result == body


@pytest.mark.parametrize(
    "deployment_kind",
    [
        LLMDeploymentKind.DIRECT,
        LLMDeploymentKind.CUSTOM,
        LLMDeploymentKind.AZURE,
        LLMDeploymentKind.BEDROCK,
        LLMDeploymentKind.SAGEMAKER,
        LLMDeploymentKind.MOCK,
    ],
)
def test_every_other_deployment_kind_is_untouched_on_the_messages_door(deployment_kind):
    body = _messages_body()

    result = apply_static_fields(
        deployment_kind=deployment_kind, protocol=LLMProtocol.MESSAGES, body=body
    )

    assert result == body


def test_unparsable_body_is_returned_unchanged():
    body = b"not json"

    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.VERTEX,
        protocol=LLMProtocol.MESSAGES,
        body=body,
    )

    assert result == body


def test_non_object_body_is_returned_unchanged():
    body = json.dumps([1, 2, 3]).encode()

    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.VERTEX,
        protocol=LLMProtocol.MESSAGES,
        body=body,
    )

    assert result == body


def test_table_has_exactly_vertex():
    """OD19: Bedrock's entry came out — its Messages door moved to bedrock-mantle, which
    needs no rewrite."""
    assert set(STATIC_FIELD_REWRITES.keys()) == {LLMDeploymentKind.VERTEX}


def test_rewrite_defaults_are_not_shared_between_instances():
    first = LLMStaticFieldRewrite()
    second = LLMStaticFieldRewrite()

    first.fields_added["field"] = "value"
    first.fields_removed.append("other_field")

    assert second.fields_added == {}
    assert second.fields_removed == []


def test_table_entries_are_literal_data_only():
    """D40: 'nothing in the table may be computed from the request'. Checkable by reading
    the table — every value is a plain literal, never a callable or a derived expression."""
    for rewrite in STATIC_FIELD_REWRITES.values():
        for value in rewrite.fields_added.values():
            assert isinstance(value, _LITERAL_TYPES), (
                f"fields_added value {value!r} is not a literal"
            )
            assert not callable(value)
        for name in rewrite.fields_removed:
            assert isinstance(name, str)


def test_apply_static_fields_signature_cannot_see_request_semantics():
    """The function's signature is the proof (specs-wp27.md): only the table lookup keys
    (`deployment_kind`, `protocol`) and the raw `body` — nothing that could carry a parsed
    view of the request's content, so there is nothing for a future edit to read."""
    params = list(inspect.signature(apply_static_fields).parameters)
    assert params == ["deployment_kind", "protocol", "body"]


def _chat_with_tool_calls(*calls) -> bytes:
    return json.dumps(
        {
            "model": "google/gemini-3.8-flash",
            "messages": [
                {"role": "user", "content": "run echo hi"},
                {"role": "assistant", "content": None, "tool_calls": list(calls)},
                {"role": "tool", "tool_call_id": "call_1", "content": "hi"},
            ],
        }
    ).encode()


def _call(call_id: str, **extra) -> dict:
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": "bash", "arguments": "{}"},
        **extra,
    }


def test_vertex_chat_gives_an_unsigned_tool_call_the_skip_signature():
    """Gemini refuses a history whose tool call lost its thought signature (HTTP 400)."""
    signed = _call(
        "call_2", extra_content={"google": {"thought_signature": "real-signature"}}
    )
    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.VERTEX,
        protocol=LLMProtocol.CHAT_COMPLETIONS,
        body=_chat_with_tool_calls(_call("call_1"), signed),
    )

    calls = json.loads(result)["messages"][1]["tool_calls"]
    assert calls[0]["extra_content"] == {
        "google": {"thought_signature": "skip_thought_signature_validator"}
    }
    assert calls[1]["extra_content"] == {
        "google": {"thought_signature": "real-signature"}
    }


def test_a_vertex_chat_without_tool_calls_relays_byte_for_byte():
    body = json.dumps(
        {
            "model": "google/gemini-3.8-flash",
            "messages": [{"role": "user", "content": "hi"}],
        }
    ).encode()

    assert (
        apply_static_fields(
            deployment_kind=LLMDeploymentKind.VERTEX,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
            body=body,
        )
        is body
    )


def test_other_deployments_keep_unsigned_tool_calls_as_they_are():
    body = _chat_with_tool_calls(_call("call_1"))

    assert (
        apply_static_fields(
            deployment_kind=LLMDeploymentKind.DIRECT,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
            body=body,
        )
        is body
    )


def _chat_with_parts(*parts):
    return json.dumps(
        {
            "model": "google/gemini-3.8-flash",
            "messages": [{"role": "user", "content": [*parts]}],
        }
    ).encode()


@pytest.mark.parametrize(
    "file, url",
    [
        (
            {
                "filename": "doc.pdf",
                "file_data": "data:application/pdf;base64,JVBERi0x",
            },
            "data:application/pdf;base64,JVBERi0x",
        ),
        (
            {"filename": "doc.pdf", "file_data": "JVBERi0x"},
            "data:application/pdf;base64,JVBERi0x",
        ),
    ],
    ids=["data-url", "bare-base64"],
)
def test_vertex_chat_sends_a_file_part_as_the_data_url_gemini_reads(file, url):
    """Vertex refuses an OpenAI `file` part (HTTP 400) but reads a PDF data URL."""
    text = {"type": "text", "text": "What is in this file?"}
    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.VERTEX,
        protocol=LLMProtocol.CHAT_COMPLETIONS,
        body=_chat_with_parts(text, {"type": "file", "file": file}),
    )

    assert json.loads(result)["messages"][0]["content"] == [
        text,
        {"type": "image_url", "image_url": {"url": url}},
    ]


def test_a_file_part_with_no_data_and_other_deployments_are_relayed_as_they_came():
    by_id = _chat_with_parts({"type": "file", "file": {"file_id": "file-abc"}})
    inline = _chat_with_parts(
        {"type": "file", "file": {"file_data": "data:application/pdf;base64,JVBE"}}
    )

    assert (
        apply_static_fields(
            deployment_kind=LLMDeploymentKind.VERTEX,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
            body=by_id,
        )
        is by_id
    )
    assert (
        apply_static_fields(
            deployment_kind=LLMDeploymentKind.DIRECT,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
            body=inline,
        )
        is inline
    )
