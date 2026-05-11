from agenta.sdk.types import Message, Messages


def test_message_schema_has_semantic_annotation():
    schema = Message.model_json_schema()

    assert schema["type"] == "object"
    assert schema["x-ag-type"] == "message"
    assert schema["properties"]["role"]["enum"] == [
        "developer",
        "system",
        "user",
        "assistant",
        "tool",
        "function",
    ]


def test_messages_schema_has_semantic_annotation():
    schema = Messages.model_json_schema()

    assert schema["type"] == "array"
    assert schema["x-ag-type"] == "messages"
    assert "$ref" in schema["items"]
    assert schema["$defs"]["Message"]["x-ag-type"] == "message"


def test_messages_round_trip_json():
    raw = """
    [
      {"role": "system", "content": "You are helpful."},
      {"role": "assistant", "content": "Hello", "tool_calls": null}
    ]
    """

    messages = Messages.model_validate_json(raw)

    assert len(messages.root) == 2
    assert isinstance(messages.root[0], Message)
    assert isinstance(messages.root[1], Message)

    dumped = messages.model_dump()
    assert dumped[0]["role"] == "system"
    assert dumped[1]["role"] == "assistant"

    dumped_json = messages.model_dump_json()
    assert '"role":"system"' in dumped_json
    assert '"role":"assistant"' in dumped_json
