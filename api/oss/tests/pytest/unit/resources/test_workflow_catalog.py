from oss.src.resources.workflows.catalog import get_workflow_catalog_preset


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
