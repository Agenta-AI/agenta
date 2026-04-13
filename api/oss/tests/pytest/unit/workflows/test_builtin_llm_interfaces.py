from agenta.sdk.engines.running.interfaces import (
    auto_custom_code_run_v0_interface,
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
    assert prompt["x-ag-type-ref"] == "prompt-template"
    assert "x-ag-type" not in prompt
    assert prompt["type"] == "object"
    assert prompt["default"]["messages"][0]["role"] == "system"
    assert prompt["default"]["llm_config"]["model"] == "gpt-4o-mini"


def test_chat_v0_interface_inputs_allow_any_variables_and_messages():
    inputs = chat_v0_interface.schemas.inputs

    assert inputs["additionalProperties"] is True
    assert "$defs" not in inputs
    assert inputs["properties"]["messages"]["x-ag-type-ref"] == "messages"
    assert "x-ag-type" not in inputs["properties"]["messages"]
    assert inputs["properties"]["messages"]["type"] == "array"
    assert "default" not in inputs["properties"]["messages"]


def test_completion_v0_interface_uses_prompt_template_parameters_schema():
    parameters = completion_v0_interface.schemas.parameters

    assert "prompt_system" not in parameters["properties"]
    assert "prompt_user" not in parameters["properties"]

    prompt = parameters["properties"]["prompt"]
    assert prompt["x-ag-type-ref"] == "prompt-template"
    assert "x-ag-type" not in prompt
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

    assert outputs["x-ag-type-ref"] == "message"
    assert "x-ag-type" not in outputs
    assert outputs["type"] == "object"


def test_match_v0_interface_exposes_recursive_matchers_parameters_schema():
    parameters = match_v0_interface.schemas.parameters

    assert parameters["required"] == ["matchers"]
    assert parameters["properties"]["matchers"]["items"] == {"$ref": "#/$defs/matcher"}

    matcher = parameters["$defs"]["matcher"]
    assert matcher["required"] == ["target"]
    assert matcher["properties"]["mode"]["enum"] == ["text", "json"]
    assert matcher["properties"]["match"]["enum"] == [
        "valid",
        "exact",
        "starts_with",
        "ends_with",
        "contains",
        "regex",
        "similarity",
        "diff",
    ]
    assert matcher["properties"]["score"]["enum"] == ["weighted", "min", "max"]
    assert matcher["properties"]["success"]["enum"] == ["all", "any", "threshold"]

    root = parameters["properties"]
    assert root["score"]["enum"] == ["weighted", "min", "max"]
    assert root["score"]["default"] == "weighted"
    assert root["success"]["enum"] == ["all", "any", "threshold"]
    assert root["success"]["default"] == "threshold"
    assert root["threshold"]["default"] == 1.0


def test_score_success_outputs_preserve_empty_required_list():
    outputs = auto_custom_code_run_v0_interface.schemas.outputs

    assert outputs["required"] == []
