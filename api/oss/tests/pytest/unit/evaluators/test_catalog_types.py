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
    assert by_key["llm"]["properties"]["model"]["x-ag-type-ref"] == "model"
