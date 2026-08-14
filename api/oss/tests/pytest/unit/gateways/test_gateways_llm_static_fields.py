"""Unit tests for the D40 static field rewrite (specs-wp27.md).

Nothing running: pure functions over bytes, no I/O.
"""

import inspect
import json

import pytest

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind, LLMProtocol
from oss.src.core.gateways.llms.providers.passthrough.static_fields import (
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


def test_bedrock_adds_anthropic_version_and_removes_model():
    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.BEDROCK,
        protocol=LLMProtocol.MESSAGES,
        body=_messages_body(),
    )

    payload = json.loads(result)
    assert payload["anthropic_version"] == "bedrock-2023-05-31"
    assert "model" not in payload


def test_vertex_adds_anthropic_version_and_removes_model():
    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.VERTEX,
        protocol=LLMProtocol.MESSAGES,
        body=_messages_body(),
    )

    payload = json.loads(result)
    assert payload["anthropic_version"] == "vertex-2023-10-16"
    assert "model" not in payload


@pytest.mark.parametrize(
    "deployment_kind",
    [LLMDeploymentKind.BEDROCK, LLMDeploymentKind.VERTEX],
)
def test_existing_anthropic_version_is_not_overwritten(deployment_kind):
    """setdefault semantics, mirroring the vendor SDKs: the caller's own value stands."""
    body = _messages_body(anthropic_version="caller-supplied-value")

    result = apply_static_fields(
        deployment_kind=deployment_kind, protocol=LLMProtocol.MESSAGES, body=body
    )

    assert json.loads(result)["anthropic_version"] == "caller-supplied-value"


@pytest.mark.parametrize(
    "deployment_kind",
    [LLMDeploymentKind.BEDROCK, LLMDeploymentKind.VERTEX],
)
def test_non_messages_protocol_leaves_body_untouched(deployment_kind):
    body = _messages_body()

    result = apply_static_fields(
        deployment_kind=deployment_kind,
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
        deployment_kind=LLMDeploymentKind.BEDROCK,
        protocol=LLMProtocol.MESSAGES,
        body=body,
    )

    assert result == body


def test_non_object_body_is_returned_unchanged():
    body = json.dumps([1, 2, 3]).encode()

    result = apply_static_fields(
        deployment_kind=LLMDeploymentKind.BEDROCK,
        protocol=LLMProtocol.MESSAGES,
        body=body,
    )

    assert result == body


def test_table_has_exactly_bedrock_and_vertex():
    assert set(STATIC_FIELD_REWRITES.keys()) == {
        LLMDeploymentKind.BEDROCK,
        LLMDeploymentKind.VERTEX,
    }


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
