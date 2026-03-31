from unittest.mock import AsyncMock, patch

from oss.src.core.evaluators.dtos import SimpleEvaluatorData
from oss.src.core.evaluators.service import EvaluatorsService


def test_normalize_evaluator_data_overlays_inferred_schema_parts():
    service = EvaluatorsService(workflows_service=AsyncMock())
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
    assert normalized.schemas["parameters"] == {"inferred": True}
    assert normalized.schemas["outputs"]["type"] == "object"
