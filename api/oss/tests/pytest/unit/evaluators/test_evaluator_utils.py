"""Unit tests for build_evaluator_data in core/evaluators/utils.py."""

from oss.src.core.evaluators.utils import build_evaluator_data


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _data(key, **settings):
    return build_evaluator_data(evaluator_key=key, settings_values=settings or None)


# ---------------------------------------------------------------------------
# No legacy fields emitted
# ---------------------------------------------------------------------------


def test_build_evaluator_data_no_service_field():
    data = _data("auto_exact_match")
    assert not hasattr(data, "service") or data.service is None  # type: ignore[attr-defined]


def test_build_evaluator_data_no_configuration_field():
    data = _data("auto_exact_match")
    assert not hasattr(data, "configuration") or data.configuration is None  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# URI
# ---------------------------------------------------------------------------


def test_build_evaluator_data_uri_format():
    data = _data("auto_exact_match")
    assert data.uri == "agenta:builtin:auto_exact_match:v0"


def test_build_evaluator_data_uri_uses_evaluator_key():
    data = _data("auto_ai_critique")
    assert data.uri == "agenta:builtin:auto_ai_critique:v0"


# ---------------------------------------------------------------------------
# schemas.outputs — default (score+success or success-only)
# ---------------------------------------------------------------------------


def test_build_evaluator_data_score_and_success_outputs():
    # auto_levenshtein_distance is in _SCORE_AND_SUCCESS_EVALUATORS
    data = _data("auto_levenshtein_distance")
    outputs = data.schemas.outputs
    assert "score" in outputs["properties"]
    assert "success" in outputs["properties"]


def test_build_evaluator_data_success_only_outputs():
    # auto_exact_match is NOT in _SCORE_AND_SUCCESS_EVALUATORS
    data = _data("auto_exact_match")
    outputs = data.schemas.outputs
    assert "success" in outputs["properties"]
    assert "score" not in outputs["properties"]
    assert "success" in outputs["required"]


# ---------------------------------------------------------------------------
# schemas.outputs — auto_ai_critique (json_schema-driven)
# ---------------------------------------------------------------------------


def test_build_evaluator_data_ai_critique_with_json_schema():
    custom_schema = {
        "type": "object",
        "properties": {"relevance": {"type": "number"}},
        "required": ["relevance"],
    }
    data = _data("auto_ai_critique", json_schema={"schema": custom_schema})
    assert data.schemas.outputs == custom_schema


def test_build_evaluator_data_ai_critique_fallback_when_no_json_schema():
    # Falls back to default success-only output schema when json_schema missing
    data = _data("auto_ai_critique")
    outputs = data.schemas.outputs
    assert "success" in outputs["properties"]


# ---------------------------------------------------------------------------
# schemas.outputs — json_multi_field_match (fields-driven)
# ---------------------------------------------------------------------------


def test_build_evaluator_data_json_multi_field_match_basic():
    data = _data("json_multi_field_match", fields=["accuracy", "fluency"])
    outputs = data.schemas.outputs
    assert "aggregate_score" in outputs["properties"]
    assert "accuracy" in outputs["properties"]
    assert "fluency" in outputs["properties"]
    assert outputs["required"] == ["aggregate_score"]


def test_build_evaluator_data_json_multi_field_match_no_fields():
    data = _data("json_multi_field_match")
    outputs = data.schemas.outputs
    assert "aggregate_score" in outputs["properties"]


# ---------------------------------------------------------------------------
# url — auto_webhook_test
# ---------------------------------------------------------------------------


def test_build_evaluator_data_webhook_url():
    data = _data("auto_webhook_test", webhook_url="https://example.com/hook")
    assert data.url == "https://example.com/hook"


def test_build_evaluator_data_non_webhook_url_is_none():
    data = _data("auto_exact_match", webhook_url="https://example.com/hook")
    assert data.url is None


# ---------------------------------------------------------------------------
# script — auto_custom_code_run
# ---------------------------------------------------------------------------


def test_build_evaluator_data_custom_code_script():
    data = _data("auto_custom_code_run", code="def evaluate(): pass")
    assert data.script == "def evaluate(): pass"
    assert data.runtime == "python"


def test_build_evaluator_data_non_custom_code_script_is_none():
    data = _data("auto_exact_match")
    assert data.script is None


# ---------------------------------------------------------------------------
# parameters
# ---------------------------------------------------------------------------


def test_build_evaluator_data_parameters_populated():
    data = _data("auto_ai_critique", model="gpt-4", temperature=0.0)
    assert data.parameters == {"model": "gpt-4", "temperature": 0.0}


def test_build_evaluator_data_parameters_none_when_empty_settings():
    data = build_evaluator_data(evaluator_key="auto_exact_match", settings_values=None)
    assert data.parameters is None


# ---------------------------------------------------------------------------
# schemas.parameters — settings_template from registry
# ---------------------------------------------------------------------------


def test_build_evaluator_data_ai_critique_has_parameters_schema():
    # auto_ai_critique has a non-empty settings_template in the registry
    data = _data("auto_ai_critique")
    assert data.schemas.parameters is not None
    assert isinstance(data.schemas.parameters, dict)
    assert len(data.schemas.parameters) > 0


def test_build_evaluator_data_exact_match_no_parameters_schema():
    # auto_contains_json has an empty settings_template ({})
    data = _data("auto_contains_json")
    assert data.schemas.parameters is None


def test_build_evaluator_data_parameters_schema_contains_known_key():
    # auto_ai_critique settings_template has at least a "model" field
    data = _data("auto_ai_critique")
    assert "model" in data.schemas.parameters


# ---------------------------------------------------------------------------
# version
# ---------------------------------------------------------------------------


def test_build_evaluator_data_version_set():
    data = _data("auto_exact_match")
    assert data.version is not None
    assert isinstance(data.version, str)
