from copy import deepcopy

import pytest

from agenta.sdk.utils.rendering import (
    StructuredRenderingError,
    render_json_like,
    render_messages,
)
from agenta.sdk.utils.types import Message


def test_render_messages_renders_message_objects_and_preserves_fields():
    messages = [
        Message(
            role="user",
            content="Hello {{name}}",
            name="speaker",
            tool_call_id="call-1",
        )
    ]

    rendered = render_messages(
        messages=messages,
        mode="curly",
        context={"name": "Ada"},
    )

    assert rendered[0] is not messages[0]
    assert rendered[0].content == "Hello Ada"
    assert rendered[0].role == "user"
    assert rendered[0].name == "speaker"
    assert rendered[0].tool_call_id == "call-1"
    assert messages[0].content == "Hello {{name}}"


def test_render_messages_renders_dict_messages_and_preserves_extra_fields():
    messages = [{"role": "user", "content": "Hello {name}", "extra": {"x": 1}}]

    rendered = render_messages(
        messages=messages,
        mode="fstring",
        context={"name": "Ada"},
    )

    assert rendered == [{"role": "user", "content": "Hello Ada", "extra": {"x": 1}}]
    assert messages == [{"role": "user", "content": "Hello {name}", "extra": {"x": 1}}]


def test_render_messages_renders_text_parts_and_preserves_non_text_parts():
    image_part = {
        "type": "image_url",
        "image_url": {"url": "https://example.com/image.png"},
    }
    audio_part = {
        "type": "input_audio",
        "input_audio": {"data": "base64", "format": "wav"},
    }
    file_part = {"type": "file", "file": {"file_id": "file-1"}}
    refusal_part = {"type": "refusal", "refusal": "I cannot help with that."}
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Hello {{name}}"},
                image_part,
                audio_part,
                {"type": "text", "text": "Bye {{name}}"},
                file_part,
                refusal_part,
            ],
        }
    ]

    rendered = render_messages(
        messages=messages,
        mode="curly",
        context={"name": "Ada"},
    )

    assert rendered[0]["content"] == [
        {"type": "text", "text": "Hello Ada"},
        image_part,
        audio_part,
        {"type": "text", "text": "Bye Ada"},
        file_part,
        refusal_part,
    ]
    assert messages[0]["content"][0]["text"] == "Hello {{name}}"


def test_render_messages_preserves_none_content():
    rendered = render_messages(
        messages=[Message(role="assistant", content=None)],
        mode="curly",
        context={},
    )

    assert rendered[0].content is None


@pytest.mark.parametrize(
    "messages,expected",
    [
        ([42], "messages[0]"),
        ([{"content": "hello"}], "messages[0].role"),
        ([{"role": 1, "content": "hello"}], "messages[0].role"),
        ([{"role": "user", "content": 1}], "messages[0].content"),
        ([{"role": "user", "content": [{}]}], "messages[0].content[0]"),
        (
            [{"role": "user", "content": [{"type": "text"}]}],
            "messages[0].content[0]",
        ),
        (
            [{"role": "user", "content": [{"type": "text", "text": 1}]}],
            "messages[0].content[0]",
        ),
        (
            [{"role": "user", "content": [{"type": "tool_use", "id": "x"}]}],
            "messages[0].content[0]",
        ),
    ],
)
def test_render_messages_rejects_malformed_messages(messages, expected):
    with pytest.raises(StructuredRenderingError) as exc_info:
        render_messages(messages=messages, mode="curly", context={})

    assert expected in str(exc_info.value)


def test_render_messages_jinja_errors_are_inspectable():
    with pytest.raises(StructuredRenderingError) as exc_info:
        render_messages(
            messages=[
                {
                    "role": "user",
                    "content": "{{ lipsum.__globals__['os'].popen('id').read() }}",
                }
            ],
            mode="jinja2",
            context={},
        )

    assert "messages[0].content" in str(exc_info.value)
    assert exc_info.value.error is not None


def test_render_json_like_renders_nested_values_and_keys_without_mutation():
    value = {
        "{{field}}": {
            "description": "Question: {{question}}",
            "items": ["{{answer}}", 1, True, None],
        }
    }
    original = deepcopy(value)

    rendered = render_json_like(
        json_like=value,
        mode="curly",
        context={"field": "verdict", "question": "2+2?", "answer": "4"},
        location="json_schema",
    )

    assert rendered == {
        "verdict": {
            "description": "Question: 2+2?",
            "items": ["4", 1, True, None],
        }
    }
    assert value == original


def test_render_json_like_can_preserve_keys():
    rendered = render_json_like(
        json_like={"{{field}}": "{{value}}"},
        mode="curly",
        context={"field": "name", "value": "Ada"},
        render_keys=False,
    )

    assert rendered == {"{{field}}": "Ada"}


def test_render_json_like_raises_on_key_collision():
    with pytest.raises(StructuredRenderingError) as exc_info:
        render_json_like(
            json_like={"{{field}}": 1, "name": 2},
            mode="curly",
            context={"field": "name"},
        )

    assert "rendered key collision" in str(exc_info.value)


def test_render_json_like_error_path_identifies_nested_value():
    with pytest.raises(StructuredRenderingError) as exc_info:
        render_json_like(
            json_like={"schema": {"properties": {"score": "{{missing}}"}}},
            mode="curly",
            context={},
            location="json_schema",
        )

    assert "json_schema.schema.properties.score" in str(exc_info.value)
