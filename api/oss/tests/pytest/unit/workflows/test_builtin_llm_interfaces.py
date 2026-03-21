from agenta.sdk.engines.running.interfaces import (
    chat_v0_interface,
    completion_v0_interface,
    match_v0_interface,
)


def test_chat_v0_interface_uses_prompt_template_parameters_schema():
    parameters = chat_v0_interface.schemas.parameters

    assert "prompt_system" not in parameters["properties"]
    assert "prompt_user" not in parameters["properties"]
    assert "$defs" not in parameters

    prompt = parameters["properties"]["prompt"]
    assert prompt["x-ag-type"] == "prompt-template"
    assert prompt["type"] == "object"
    assert prompt["default"]["messages"][0]["role"] == "system"
    assert prompt["default"]["llm_config"]["model"] == "gpt-4o-mini"


def test_chat_v0_interface_inputs_allow_any_variables_and_messages():
    inputs = chat_v0_interface.schemas.inputs

    assert inputs["additionalProperties"] is True
    assert "$defs" not in inputs
    assert inputs["properties"]["messages"]["x-ag-type"] == "messages"
    assert inputs["properties"]["messages"]["type"] == "array"
    assert "default" not in inputs["properties"]["messages"]


def test_completion_v0_interface_uses_prompt_template_parameters_schema():
    parameters = completion_v0_interface.schemas.parameters

    assert "prompt_system" not in parameters["properties"]
    assert "prompt_user" not in parameters["properties"]

    prompt = parameters["properties"]["prompt"]
    assert prompt["x-ag-type"] == "prompt-template"
    prompt_default = prompt["default"]
    assert prompt_default["messages"][0]["content"] == "You are an expert in geography"
    assert (
        prompt_default["messages"][1]["content"]
        == "What is the capital of {{country}}?"
    )


def test_completion_v0_interface_inputs_allow_any_variables_only():
    inputs = completion_v0_interface.schemas.inputs

    assert inputs["additionalProperties"] is True
    assert inputs["properties"] == {}


def test_chat_v0_interface_outputs_use_message_semantic_type():
    outputs = chat_v0_interface.schemas.outputs

    assert outputs["x-ag-type"] == "message"
    assert outputs["type"] == "object"


def test_match_v0_interface_exposes_recursive_matchers_parameters_schema():
    parameters = match_v0_interface.schemas.parameters

    assert parameters["required"] == ["matchers"]
    assert parameters["properties"]["matchers"]["items"] == {"$ref": "#/$defs/matcher"}

    matcher = parameters["$defs"]["matcher"]
    assert matcher["required"] == ["path"]
    assert matcher["properties"]["kind"]["enum"] == ["text", "json"]
    assert matcher["properties"]["mode"]["enum"] == [
        "valid",
        "exact",
        "starts_with",
        "ends_with",
        "contains",
        "regex",
        "similarity",
        "overlap",
    ]
