from agenta.sdk.engines.tracing.attributes import serialize


def test_serialize_handles_nested_lists_in_message_payloads():
    attributes = {
        "inputs": {
            "prompt": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "hello"},
                        {
                            "type": "tool_result",
                            "content": [
                                {"kind": "json", "value": {"ok": True}},
                                ["nested", "list"],
                            ],
                        },
                    ],
                }
            ]
        }
    }

    serialized = serialize(namespace="data", attributes=attributes)

    assert serialized["ag.data.inputs.prompt.0.role"] == "user"
    assert serialized["ag.data.inputs.prompt.0.content.0.type"] == "text"
    assert serialized["ag.data.inputs.prompt.0.content.0.text"] == "hello"
    assert serialized["ag.data.inputs.prompt.0.content.1.content.0.value.ok"] is True
    assert serialized["ag.data.inputs.prompt.0.content.1.content.1.0"] == "nested"
    assert serialized["ag.data.inputs.prompt.0.content.1.content.1.1"] == "list"
