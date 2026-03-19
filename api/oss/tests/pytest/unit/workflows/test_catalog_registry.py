from oss.src.resources.workflows.catalog import (
    get_all_workflow_catalog_templates,
    get_filtered_workflow_catalog_templates,
    get_workflow_catalog_template,
)


def test_workflow_catalog_contains_application_and_evaluator_templates():
    templates = get_all_workflow_catalog_templates()
    keys = {template["key"] for template in templates}

    assert "chat" in keys
    assert "auto_ai_critique" in keys


def test_sdk_catalog_registry_is_connected():
    template = get_workflow_catalog_template(template_key="chat", is_application=True)

    assert template is not None
    assert "name" in template
    assert "description" in template
    assert "categories" in template
    assert "flags" in template


def test_application_catalog_filter_uses_flags():
    templates = get_filtered_workflow_catalog_templates(is_application=True)

    assert templates
    assert all(
        template.get("flags", {}).get("is_application") is True
        for template in templates
    )


def test_evaluator_catalog_filter_uses_flags():
    templates = get_filtered_workflow_catalog_templates(is_evaluator=True)

    assert templates
    assert all(
        template.get("flags", {}).get("is_evaluator") is True for template in templates
    )


def test_evaluator_catalog_uses_evaluator_metadata_for_parameter_content():
    template = get_workflow_catalog_template(
        template_key="auto_ai_critique",
        is_evaluator=True,
    )

    assert template is not None
    parameters = template["data"]["schemas"]["parameters"]
    assert parameters["prompt_template"]["type"] == "messages"
    assert parameters["model"]["default"] == "gpt-4o"


def test_snippet_catalog_filter_uses_flags():
    template = get_workflow_catalog_template(
        template_key="snippet",
        is_snippet=True,
    )

    assert template is not None
    assert template.get("flags", {}).get("is_snippet") is True
