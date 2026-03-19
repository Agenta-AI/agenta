from oss.src.apis.fastapi.evaluators.router import (
    _build_builtin_uri,
    _registry_entry_to_catalog_template,
    _registry_preset_to_catalog_preset,
)
from oss.src.core.evaluators.dtos import (
    EvaluatorCatalogTemplate,
    EvaluatorCatalogPreset,
)


# _build_builtin_uri -----------------------------------------------------------


def test_build_builtin_uri_format():
    assert (
        _build_builtin_uri("auto_ai_critique") == "agenta:builtin:auto_ai_critique:v0"
    )


def test_build_builtin_uri_arbitrary_key():
    assert _build_builtin_uri("my_key") == "agenta:builtin:my_key:v0"


# _registry_entry_to_catalog_template ------------------------------------------


def _make_entry(**kwargs):
    base = {
        "key": "auto_ai_critique",
        "name": "LLM-as-a-judge",
        "description": "Uses an LLM to critique outputs.",
        "categories": ["llm_judge"],
        "flags": {
            "is_archived": False,
            "is_recommended": False,
            "is_evaluator": True,
        },
        "data": {
            "uri": "agenta:builtin:auto_ai_critique:v0",
            "schemas": {
                "parameters": {"model": {"type": "string"}},
                "outputs": {"score": {"type": "number"}},
            },
        },
    }
    base.update(kwargs)
    return base


def test_registry_entry_to_catalog_template_key():
    template = _registry_entry_to_catalog_template(_make_entry())
    assert template.key == "auto_ai_critique"


def test_registry_entry_to_catalog_template_name_description():
    template = _registry_entry_to_catalog_template(_make_entry())
    assert template.name == "LLM-as-a-judge"
    assert template.description == "Uses an LLM to critique outputs."


def test_registry_entry_to_catalog_template_categories_from_tags():
    template = _registry_entry_to_catalog_template(
        _make_entry(categories=["llm_judge", "rag"])
    )
    assert template.categories == ["llm_judge", "rag"]


def test_registry_entry_to_catalog_template_archived_false():
    template = _registry_entry_to_catalog_template(
        _make_entry(flags={"is_archived": False, "is_evaluator": True})
    )
    assert template.flags.is_archived is False


def test_registry_entry_to_catalog_template_archived_true():
    template = _registry_entry_to_catalog_template(
        _make_entry(flags={"is_archived": True, "is_evaluator": True})
    )
    assert template.flags.is_archived is True


def test_registry_entry_to_catalog_template_data_uri():
    template = _registry_entry_to_catalog_template(_make_entry())
    assert template.data.uri == "agenta:builtin:auto_ai_critique:v0"


def test_registry_entry_to_catalog_template_data_schemas_parameters():
    settings_template = {"model": {"type": "string"}, "prompt": {"type": "string"}}
    template = _registry_entry_to_catalog_template(
        _make_entry(
            data={
                "uri": "agenta:builtin:auto_ai_critique:v0",
                "schemas": {
                    "parameters": settings_template,
                    "outputs": {"score": {"type": "number"}},
                },
            }
        )
    )
    assert template.data.schemas.parameters == settings_template


def test_registry_entry_to_catalog_template_data_schemas_outputs():
    outputs_schema = {"score": {"type": "number"}}
    template = _registry_entry_to_catalog_template(
        _make_entry(
            data={
                "uri": "agenta:builtin:auto_ai_critique:v0",
                "schemas": {
                    "parameters": {"model": {"type": "string"}},
                    "outputs": outputs_schema,
                },
            }
        )
    )
    assert template.data.schemas.outputs == outputs_schema


def test_registry_entry_to_catalog_template_no_outputs_schema():
    entry = _make_entry()
    entry["data"] = {
        "uri": "agenta:builtin:auto_ai_critique:v0",
        "schemas": {"parameters": {"model": {"type": "string"}}},
    }
    template = _registry_entry_to_catalog_template(entry)
    assert template.data.schemas.outputs is None


def test_registry_entry_to_catalog_template_empty_tags():
    template = _registry_entry_to_catalog_template(_make_entry(categories=[]))
    assert template.categories == []


def test_registry_entry_to_catalog_template_missing_tags_defaults_to_empty():
    entry = _make_entry()
    entry["categories"] = []
    template = _registry_entry_to_catalog_template(entry)
    assert template.categories == []


def test_registry_entry_to_catalog_template_returns_correct_type():
    template = _registry_entry_to_catalog_template(_make_entry())
    assert isinstance(template, EvaluatorCatalogTemplate)
    assert template.flags.is_evaluator is True


# _registry_preset_to_catalog_preset -------------------------------------------


def _make_preset(**kwargs):
    base = {
        "key": "hallucination",
        "name": "Hallucination Detection",
        "description": "Detects hallucinations in outputs.",
        "categories": ["llm_judge"],
        "flags": {
            "is_archived": False,
            "is_recommended": False,
            "is_evaluator": True,
        },
        "data": {
            "uri": "agenta:builtin:auto_ai_critique:v0",
            "parameters": {"model": "gpt-4o-mini", "prompt_template": []},
        },
    }
    base.update(kwargs)
    return base


def test_registry_preset_to_catalog_preset_key():
    preset = _registry_preset_to_catalog_preset(
        _make_preset(), uri="agenta:builtin:auto_ai_critique:v0"
    )
    assert preset.key == "hallucination"


def test_registry_preset_to_catalog_preset_name_description():
    preset = _registry_preset_to_catalog_preset(
        _make_preset(), uri="agenta:builtin:auto_ai_critique:v0"
    )
    assert preset.name == "Hallucination Detection"
    assert preset.description == "Detects hallucinations in outputs."


def test_registry_preset_to_catalog_preset_archived_false():
    preset = _registry_preset_to_catalog_preset(
        _make_preset(
            flags={
                "is_archived": False,
                "is_recommended": False,
                "is_evaluator": True,
            }
        ),
        uri="agenta:builtin:auto_ai_critique:v0",
    )
    assert preset.flags.is_archived is False


def test_registry_preset_to_catalog_preset_archived_true():
    preset = _registry_preset_to_catalog_preset(
        _make_preset(
            flags={
                "is_archived": True,
                "is_recommended": False,
                "is_evaluator": True,
            }
        ),
        uri="agenta:builtin:auto_ai_critique:v0",
    )
    assert preset.flags.is_archived is True


def test_registry_preset_to_catalog_preset_data_uri():
    uri = "agenta:builtin:auto_ai_critique:v0"
    preset = _registry_preset_to_catalog_preset(_make_preset(), uri=uri)
    assert preset.data.uri == uri


def test_registry_preset_to_catalog_preset_data_parameters_from_values():
    values = {"model": "gpt-4o-mini", "prompt_template": []}
    preset = _registry_preset_to_catalog_preset(
        _make_preset(data={"uri": "u", "parameters": values}),
        uri="u",
    )
    assert preset.data.parameters == values


def test_registry_preset_to_catalog_preset_empty_values():
    preset = _registry_preset_to_catalog_preset(
        _make_preset(data={"uri": "u", "parameters": {}}),
        uri="u",
    )
    assert preset.data.parameters == {}


def test_registry_preset_to_catalog_preset_missing_values_defaults_to_empty():
    entry = _make_preset()
    entry["data"] = {"uri": "u", "parameters": {}}
    preset = _registry_preset_to_catalog_preset(entry, uri="u")
    assert preset.data.parameters == {}


def test_registry_preset_to_catalog_preset_returns_correct_type():
    preset = _registry_preset_to_catalog_preset(_make_preset(), uri="u")
    assert isinstance(preset, EvaluatorCatalogPreset)
    assert preset.flags.is_evaluator is True
