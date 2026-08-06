from oss.src.resources.workflows.catalog import (
    get_workflow_catalog_types,
)


def test_catalog_types_include_message_messages_model_and_prompt_template():
    types = get_workflow_catalog_types()

    by_key = {item["key"]: item["json_schema"] for item in types}

    assert by_key["message"]["x-ag-type"] == "message"
    assert by_key["messages"]["x-ag-type"] == "messages"
    assert by_key["model"]["type"] == "string"
    assert by_key["model"]["x-ag-type"] == "grouped_choice"
    assert isinstance(by_key["model"]["choices"], dict)
    assert isinstance(by_key["model"]["x-ag-metadata"], dict)
    assert "openai" in by_key["model"]["choices"]
    assert by_key["prompt-template"]["x-ag-type"] == "prompt-template"
    assert (
        by_key["prompt-template"]["properties"]["llm_config"]["properties"]["model"][
            "x-ag-type-ref"
        ]
        == "model"
    )
    prompt_properties = by_key["prompt-template"]["properties"]
    fallback_schema = prompt_properties["fallback_configs"]
    retry_config_schema = prompt_properties["retry_config"]
    retry_policy_schema = prompt_properties["retry_policy"]
    fallback_policy_schema = prompt_properties["fallback_policy"]
    fallback_array_schema = next(
        option for option in fallback_schema["anyOf"] if option.get("type") == "array"
    )
    retry_object_schema = next(
        option
        for option in retry_config_schema["anyOf"]
        if option.get("type") == "object"
    )
    assert fallback_schema["default"] is None
    assert (
        fallback_array_schema["items"]["properties"]["model"]["x-ag-type-ref"]
        == "model"
    )
    assert fallback_policy_schema["x-ag-type"] == "choice"
    assert fallback_policy_schema["enum"] == [
        "off",
        "availability",
        "capacity",
        "access",
        "context",
        "any",
    ]
    assert set(retry_object_schema["properties"]) == {
        "max_retries",
        "base_delay",
    }
    assert retry_policy_schema["enum"] == [
        "off",
        "availability",
        "capacity",
        "transient",
        "any",
    ]
    assert "chat_template_kwargs" in prompt_properties["llm_config"]["properties"]
    assert by_key["llm"]["properties"]["model"]["x-ag-type-ref"] == "model"
    assert "chat_template_kwargs" in by_key["llm"]["properties"]
