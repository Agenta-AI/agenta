from agenta.sdk.engines.running.interfaces import (
    chat_v0_interface,
    completion_v0_interface,
)


def test_chat_v0_interface_uses_prompt_template_parameters_schema():
    parameters = chat_v0_interface.schemas.parameters

    assert parameters["properties"]["prompt"]["x-parameters"]["prompt"] is True
    assert "prompt_system" not in parameters["properties"]
    assert "prompt_user" not in parameters["properties"]

    prompt = parameters["properties"]["prompt"]
    assert prompt["properties"]["messages"]["x-ag-messages"] is True
    assert set(prompt["properties"]) >= {
        "messages",
        "template_format",
        "input_keys",
        "llm_config",
    }

    model = prompt["$defs"]["ModelConfig"]["properties"]["model"]
    assert model["x-ag-type"] == "grouped_choice"
    assert model["x-ag-type-ref"]["type"] == "model_catalog"


def test_chat_v0_interface_inputs_allow_string_variables_and_messages():
    inputs = chat_v0_interface.schemas.inputs

    assert inputs["additionalProperties"] == {"type": "string"}
    assert inputs["properties"]["messages"]["x-ag-messages"] is True
    assert inputs["properties"]["messages"]["items"]["$ref"] == "#/$defs/message"


def test_completion_v0_interface_uses_prompt_template_parameters_schema():
    parameters = completion_v0_interface.schemas.parameters

    assert parameters["properties"]["prompt"]["x-parameters"]["prompt"] is True
    assert "prompt_system" not in parameters["properties"]
    assert "prompt_user" not in parameters["properties"]

    prompt_default = parameters["properties"]["prompt"]["default"]
    assert prompt_default["messages"][0]["content"] == "You are an expert in geography"
    assert (
        prompt_default["messages"][1]["content"]
        == "What is the capital of {{country}}?"
    )


def test_completion_v0_interface_inputs_allow_string_variables_only():
    inputs = completion_v0_interface.schemas.inputs

    assert inputs["additionalProperties"] == {"type": "string"}
    assert inputs["properties"] == {}
