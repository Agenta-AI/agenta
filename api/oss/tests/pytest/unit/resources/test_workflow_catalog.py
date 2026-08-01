from agenta.sdk.agents.pi_builtins import PI_DEFAULT_ACTIVE_BUILTINS
from agenta.sdk.engines.running.catalog import get_all_catalog_templates

from oss.src.resources.workflows.catalog import (
    _build_template_data,
    get_workflow_catalog_preset,
)


def test_feedback_quality_rating_preset_is_preserved_from_sdk_catalog():
    preset = get_workflow_catalog_preset(
        template_key="feedback",
        preset_key="quality-rating",
        is_evaluator=True,
    )

    assert preset is not None
    assert preset.key == "quality-rating"
    assert preset.data is not None
    assert preset.data.uri == "agenta:custom:feedback:v0"
    assert preset.data.schemas is not None
    assert preset.data.schemas.outputs is not None


def test_agent_template_data_materializes_the_default_builtin_tools():
    """The agent template a new agent is created from must carry Pi's built-ins (issue #5590).

    `_build_template_data` hoists the `agent` property's JSON-Schema default into a materialized
    `data["parameters"]` block, then strips that non-primitive default back off the schema. That
    hoist is the only thing that carries the shipped default into a newly created agent's
    parameters, and the strip means the schema can no longer be the fallback source. Without this
    test, an empty or dropped `tools` list would pass every builder-level test and still reach the
    runner as "grant nothing", leaving saved agents with no read, bash, edit or write.
    """
    expected_tools = [
        {"type": "builtin", "name": name} for name in PI_DEFAULT_ACTIVE_BUILTINS
    ]

    entry = next(
        entry for entry in get_all_catalog_templates() if entry["key"] == "agent"
    )
    data = _build_template_data(entry["data"], settings_template=None)

    assert data is not None
    assert data["parameters"]["agent"]["tools"] == expected_tools
    assert "default" not in data["schemas"]["parameters"]["properties"]["agent"]
