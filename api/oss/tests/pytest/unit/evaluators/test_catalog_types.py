from oss.src.resources.workflows.catalog import (
    get_workflow_catalog_types,
)


def test_catalog_types_include_message_messages_and_prompt_template():
    types = get_workflow_catalog_types()

    by_key = {item["key"]: item["schema"] for item in types}

    assert by_key["message"]["x-ag-type"] == "message"
    assert by_key["messages"]["x-ag-type"] == "messages"
    assert by_key["prompt-template"]["x-ag-type"] == "prompt-template"
