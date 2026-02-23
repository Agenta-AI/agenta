"""
Integration tests for the EvaluatorsManager.

Tests cover:
- Evaluator upsert (create/update)
- Evaluator retrieval by revision ID
- Evaluator update with new description
- Response serialization (model_dump)

Run with:
    pytest sdk/tests/integration/evaluators/ -v -m integration

Environment variables:
    AGENTA_API_KEY: Required for authentication
    AGENTA_HOST: Optional, defaults to https://cloud.agenta.ai
"""

import pytest

from agenta.sdk.managers import evaluators

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio]


def _evaluator_handler(prediction: str, reference: str) -> float:
    return 1.0 if prediction == reference else 0.0


async def test_evaluators_upsert_retrieve_update(
    deterministic_evaluator_slug: str, agenta_init
):
    rev1_id = await evaluators.aupsert(
        evaluator_slug=deterministic_evaluator_slug,
        name="SDK IT Evaluator v1",
        description="SDK integration test evaluator",
        handler=_evaluator_handler,
    )
    assert rev1_id is not None

    rev1 = await evaluators.aretrieve(evaluator_revision_id=rev1_id)
    assert rev1 is not None
    assert rev1.id == rev1_id
    assert rev1.evaluator_id is not None

    dumped = rev1.model_dump(mode="json", exclude_none=True)
    assert dumped.get("id")
    assert dumped.get("evaluator_id")

    rev2_id = await evaluators.aupsert(
        evaluator_slug=deterministic_evaluator_slug,
        name="SDK IT Evaluator v1",
        description="SDK integration test evaluator (updated)",
        handler=_evaluator_handler,
    )
    assert rev2_id is not None

    rev2 = await evaluators.aretrieve(evaluator_revision_id=rev2_id)
    assert rev2 is not None
    assert rev2.evaluator_id == rev1.evaluator_id
