from unittest.mock import AsyncMock, patch

from agenta.sdk.engines.running.utils import infer_outputs_schema
from oss.src.core.evaluators.dtos import SimpleEvaluatorData
from oss.src.core.evaluators.service import (
    EvaluatorsService,
    SimpleEvaluatorsService,
)


def test_normalize_evaluator_data_overlays_inferred_schema_parts():
    service = SimpleEvaluatorsService(
        evaluators_service=EvaluatorsService(workflows_service=AsyncMock())
    )
    input_data = SimpleEvaluatorData(
        uri="agenta:builtin:auto_ai_critique:v0",
        parameters={"json_schema": {"schema": {"type": "object"}}},
        schemas={"parameters": {"stored": True}},
    )

    inferred_data = SimpleEvaluatorData(
        uri="agenta:builtin:auto_ai_critique:v0",
        parameters={"json_schema": {"schema": {"type": "object"}}},
        schemas={
            "parameters": {"inferred": True},
            "outputs": {"type": "object", "properties": {"score": {"type": "number"}}},
        },
    )

    with patch(
        "oss.src.core.evaluators.service.build_evaluator_data",
        return_value=inferred_data,
    ):
        normalized = service._normalize_evaluator_data(input_data)

    assert normalized is not None
    assert normalized.schemas.parameters == {"inferred": True}
    assert normalized.schemas.outputs["type"] == "object"


def test_infer_outputs_schema_materializes_ai_critique_from_json_schema():
    outputs = infer_outputs_schema(
        "agenta:builtin:auto_ai_critique:v0",
        {
            "json_schema": {
                "schema": {
                    "type": "object",
                    "properties": {"score": {"type": "boolean"}},
                    "required": ["score"],
                    "additionalProperties": False,
                }
            }
        },
    )

    assert outputs is not None
    assert outputs["properties"]["score"]["type"] == "boolean"
    assert outputs["required"] == ["score"]


def test_infer_outputs_schema_materializes_json_multi_field_match_from_fields():
    outputs = infer_outputs_schema(
        "agenta:builtin:json_multi_field_match:v0",
        {
            "fields": ["aloha", "nested.value"],
        },
    )

    assert outputs is not None
    assert outputs["required"] == ["aggregate_score"]
    assert outputs["properties"]["aggregate_score"]["type"] == "number"
    assert outputs["properties"]["aloha"]["type"] == "number"
    assert outputs["properties"]["nested.value"]["type"] == "number"
