from typing import Optional

from oss.src.core.evaluators.dtos import SimpleEvaluatorData


# Evaluator keys that produce both score and success outputs
_SCORE_AND_SUCCESS_EVALUATORS = (
    "auto_levenshtein_distance",
    "auto_semantic_similarity",
    "auto_similarity_match",
    "auto_json_diff",
    "auto_webhook_test",
    "auto_custom_code_run",
    "auto_ai_critique",
)

_DATA_VERSION = "2025.07.14"


def build_evaluator_data(
    *,
    evaluator_key: str,
    settings_values: Optional[dict] = None,
) -> SimpleEvaluatorData:
    """Build complete SimpleEvaluatorData from an evaluator key and settings.

    Computes all required fields (uri, schemas, service, script, etc.)
    based on the evaluator type.
    """
    settings_values = settings_values or {}

    uri = f"agenta:builtin:{evaluator_key}:v0"

    url = (
        settings_values.get("webhook_url", None)
        if evaluator_key == "auto_webhook_test"
        else None
    )

    outputs_schema = None

    if evaluator_key == "auto_ai_critique":
        json_schema = settings_values.get("json_schema", None)
        if json_schema and isinstance(json_schema, dict):
            outputs_schema = json_schema.get("schema", None)

    if evaluator_key == "json_multi_field_match":
        fields = settings_values.get("fields", [])
        properties = {"aggregate_score": {"type": "number"}}
        for field in fields:
            properties[field] = {"type": "number"}
        outputs_schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": properties,
            "required": ["aggregate_score"],
            "additionalProperties": False,
        }

    if not outputs_schema:
        properties = (
            {"score": {"type": "number"}, "success": {"type": "boolean"}}
            if evaluator_key in _SCORE_AND_SUCCESS_EVALUATORS
            else {"success": {"type": "boolean"}}
        )
        required = (
            list(properties.keys())
            if evaluator_key not in _SCORE_AND_SUCCESS_EVALUATORS
            else []
        )
        outputs_schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        }

    schemas = {"outputs": outputs_schema}

    script = (
        {
            "content": settings_values.get("code", None),
            "runtime": "python",
        }
        if evaluator_key == "auto_custom_code_run"
        else None
    )

    service = {
        "agenta": "0.1.0",
        "format": {
            "type": "object",
            "$schema": "http://json-schema.org/schema#",
            "required": ["outputs"],
            "properties": {
                "outputs": schemas["outputs"],
            },
        },
    }

    return SimpleEvaluatorData(
        version=_DATA_VERSION,
        uri=uri,
        url=url,
        headers=None,
        schemas=schemas,
        script=script,
        parameters=settings_values if settings_values else None,
        service=service,
        configuration=settings_values if settings_values else None,
    )
