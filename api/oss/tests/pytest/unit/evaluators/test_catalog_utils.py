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
        "archived": False,
        "tags": ["llm_judge"],
        "settings_template": {"model": {"type": "string"}},
        "outputs_schema": {"score": {"type": "number"}},
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
        _make_entry(tags=["llm_judge", "rag"])
    )
    assert template.categories == ["llm_judge", "rag"]


def test_registry_entry_to_catalog_template_archived_false():
    template = _registry_entry_to_catalog_template(_make_entry(archived=False))
    assert template.archived is False


def test_registry_entry_to_catalog_template_archived_true():
    template = _registry_entry_to_catalog_template(_make_entry(archived=True))
    assert template.archived is True


def test_registry_entry_to_catalog_template_data_uri():
    template = _registry_entry_to_catalog_template(_make_entry())
    assert template.data["uri"] == "agenta:builtin:auto_ai_critique:v0"


def test_registry_entry_to_catalog_template_data_schemas_parameters():
    settings_template = {"model": {"type": "string"}, "prompt": {"type": "string"}}
    template = _registry_entry_to_catalog_template(
        _make_entry(settings_template=settings_template)
    )
    assert template.data["schemas"]["parameters"] == settings_template


def test_registry_entry_to_catalog_template_data_schemas_outputs():
    outputs_schema = {"score": {"type": "number"}}
    template = _registry_entry_to_catalog_template(
        _make_entry(outputs_schema=outputs_schema)
    )
    assert template.data["schemas"]["outputs"] == outputs_schema


def test_registry_entry_to_catalog_template_no_outputs_schema():
    entry = _make_entry()
    del entry["outputs_schema"]
    template = _registry_entry_to_catalog_template(entry)
    assert "outputs" not in template.data["schemas"]


def test_registry_entry_to_catalog_template_empty_tags():
    template = _registry_entry_to_catalog_template(_make_entry(tags=[]))
    assert template.categories == []


def test_registry_entry_to_catalog_template_missing_tags_defaults_to_empty():
    entry = _make_entry()
    del entry["tags"]
    template = _registry_entry_to_catalog_template(entry)
    assert template.categories == []


def test_registry_entry_to_catalog_template_returns_correct_type():
    template = _registry_entry_to_catalog_template(_make_entry())
    assert isinstance(template, EvaluatorCatalogTemplate)


# _registry_preset_to_catalog_preset -------------------------------------------


def _make_preset(**kwargs):
    base = {
        "key": "hallucination",
        "name": "Hallucination Detection",
        "description": "Detects hallucinations in outputs.",
        "archived": False,
        "values": {"model": "gpt-4o-mini", "prompt_template": []},
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
        _make_preset(archived=False), uri="agenta:builtin:auto_ai_critique:v0"
    )
    assert preset.archived is False


def test_registry_preset_to_catalog_preset_archived_true():
    preset = _registry_preset_to_catalog_preset(
        _make_preset(archived=True), uri="agenta:builtin:auto_ai_critique:v0"
    )
    assert preset.archived is True


def test_registry_preset_to_catalog_preset_data_uri():
    uri = "agenta:builtin:auto_ai_critique:v0"
    preset = _registry_preset_to_catalog_preset(_make_preset(), uri=uri)
    assert preset.data["uri"] == uri


def test_registry_preset_to_catalog_preset_data_parameters_from_values():
    values = {"model": "gpt-4o-mini", "prompt_template": []}
    preset = _registry_preset_to_catalog_preset(_make_preset(values=values), uri="u")
    assert preset.data["parameters"] == values


def test_registry_preset_to_catalog_preset_empty_values():
    preset = _registry_preset_to_catalog_preset(_make_preset(values={}), uri="u")
    assert preset.data["parameters"] == {}


def test_registry_preset_to_catalog_preset_missing_values_defaults_to_empty():
    entry = _make_preset()
    del entry["values"]
    preset = _registry_preset_to_catalog_preset(entry, uri="u")
    assert preset.data["parameters"] == {}


def test_registry_preset_to_catalog_preset_returns_correct_type():
    preset = _registry_preset_to_catalog_preset(_make_preset(), uri="u")
    assert isinstance(preset, EvaluatorCatalogPreset)
