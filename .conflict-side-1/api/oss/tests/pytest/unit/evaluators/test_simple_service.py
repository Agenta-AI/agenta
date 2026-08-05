from uuid import uuid4
from unittest.mock import AsyncMock

import pytest

from oss.src.core.evaluators.dtos import (
    Evaluator,
    EvaluatorArtifactFlags,
    EvaluatorArtifactQueryFlags,
    EvaluatorQuery,
    EvaluatorRevision,
    EvaluatorRevisionFlags,
    EvaluatorVariant,
    SimpleEvaluatorQuery,
    SimpleEvaluatorQueryFlags,
)
from oss.src.core.evaluators.service import (
    EvaluatorsService,
    SimpleEvaluatorsService,
)
from oss.src.core.shared.dtos import Reference


@pytest.mark.asyncio
async def test_fetch_uses_latest_revision_flags_for_simple_evaluator():
    evaluators_service = AsyncMock()
    service = SimpleEvaluatorsService(evaluators_service=evaluators_service)

    evaluator_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    evaluators_service.fetch_evaluator.return_value = Evaluator(
        id=evaluator_id,
        slug="eval",
        name="Evaluator",
        flags=EvaluatorArtifactFlags(),
    )
    evaluators_service.fetch_evaluator_variant.return_value = EvaluatorVariant(
        id=variant_id,
        slug="main",
        evaluator_id=evaluator_id,
    )
    evaluators_service.fetch_evaluator_revision.return_value = EvaluatorRevision(
        id=revision_id,
        slug="rev",
        evaluator_id=evaluator_id,
        evaluator_variant_id=variant_id,
        flags=EvaluatorRevisionFlags(is_feedback=True, is_custom=False),
    )

    simple_evaluator = await service.fetch(
        project_id=uuid4(),
        evaluator_id=evaluator_id,
    )

    assert simple_evaluator is not None
    assert simple_evaluator.flags is not None
    assert simple_evaluator.flags.is_feedback is True
    assert simple_evaluator.flags.is_custom is False


@pytest.mark.asyncio
async def test_query_filters_simple_evaluators_by_revision_flags():
    evaluators_service = AsyncMock()
    service = SimpleEvaluatorsService(evaluators_service=evaluators_service)

    matching_evaluator_id = uuid4()
    non_matching_evaluator_id = uuid4()
    matching_variant_id = uuid4()
    non_matching_variant_id = uuid4()

    evaluators_service.query_evaluators.return_value = [
        Evaluator(
            id=matching_evaluator_id,
            slug="human-eval",
            name="Human Evaluator",
            flags=EvaluatorArtifactFlags(),
        ),
        Evaluator(
            id=non_matching_evaluator_id,
            slug="auto-eval",
            name="Auto Evaluator",
            flags=EvaluatorArtifactFlags(),
        ),
    ]

    evaluators_by_id = {
        matching_evaluator_id: Evaluator(
            id=matching_evaluator_id,
            slug="human-eval",
            name="Human Evaluator",
            flags=EvaluatorArtifactFlags(),
        ),
        non_matching_evaluator_id: Evaluator(
            id=non_matching_evaluator_id,
            slug="auto-eval",
            name="Auto Evaluator",
            flags=EvaluatorArtifactFlags(),
        ),
    }
    variants_by_id = {
        matching_evaluator_id: EvaluatorVariant(
            id=matching_variant_id,
            slug="main",
            evaluator_id=matching_evaluator_id,
        ),
        non_matching_evaluator_id: EvaluatorVariant(
            id=non_matching_variant_id,
            slug="main",
            evaluator_id=non_matching_evaluator_id,
        ),
    }
    revisions_by_variant_id = {
        matching_variant_id: EvaluatorRevision(
            id=uuid4(),
            slug="rev-human",
            evaluator_id=matching_evaluator_id,
            evaluator_variant_id=matching_variant_id,
            flags=EvaluatorRevisionFlags(is_feedback=True),
        ),
        non_matching_variant_id: EvaluatorRevision(
            id=uuid4(),
            slug="rev-auto",
            evaluator_id=non_matching_evaluator_id,
            evaluator_variant_id=non_matching_variant_id,
            flags=EvaluatorRevisionFlags(is_feedback=False),
        ),
    }

    async def fetch_evaluator(*, evaluator_ref, **_kwargs):
        return evaluators_by_id[evaluator_ref.id]

    async def fetch_evaluator_variant(*, evaluator_ref, **_kwargs):
        return variants_by_id[evaluator_ref.id]

    async def fetch_evaluator_revision(*, evaluator_variant_ref, **_kwargs):
        return revisions_by_variant_id[evaluator_variant_ref.id]

    evaluators_service.fetch_evaluator.side_effect = fetch_evaluator
    evaluators_service.fetch_evaluator_variant.side_effect = fetch_evaluator_variant
    evaluators_service.fetch_evaluator_revision.side_effect = fetch_evaluator_revision

    simple_evaluators = await service.query(
        project_id=uuid4(),
        simple_evaluator_query=SimpleEvaluatorQuery(
            flags=SimpleEvaluatorQueryFlags(is_feedback=True),
        ),
    )

    assert [evaluator.id for evaluator in simple_evaluators] == [matching_evaluator_id]

    evaluator_query = evaluators_service.query_evaluators.await_args.kwargs[
        "evaluator_query"
    ]
    assert isinstance(evaluator_query.flags, EvaluatorArtifactQueryFlags)
    assert evaluator_query.flags.is_evaluator is True


@pytest.mark.asyncio
async def test_query_passes_evaluator_refs_to_evaluator_service():
    evaluators_service = AsyncMock()
    service = SimpleEvaluatorsService(evaluators_service=evaluators_service)

    evaluators_service.query_evaluators.return_value = []

    evaluator_ref = Reference(slug="target-evaluator")

    simple_evaluators = await service.query(
        project_id=uuid4(),
        simple_evaluator_refs=[evaluator_ref],
    )

    assert simple_evaluators == []
    assert evaluators_service.query_evaluators.await_args.kwargs["evaluator_refs"] == [
        evaluator_ref
    ]


@pytest.mark.asyncio
async def test_evaluator_queries_default_to_evaluator_flags():
    workflows_service = AsyncMock()
    service = EvaluatorsService(workflows_service=workflows_service)

    workflows_service.query_workflows.return_value = []

    await service.query_evaluators(project_id=uuid4())

    workflow_query = workflows_service.query_workflows.await_args.kwargs[
        "workflow_query"
    ]
    assert workflow_query.flags.is_evaluator is True

    await service.query_evaluators(
        project_id=uuid4(),
        evaluator_query=EvaluatorQuery(tags={"marker": "case"}),
    )

    workflow_query = workflows_service.query_workflows.await_args.kwargs[
        "workflow_query"
    ]
    assert workflow_query.flags.is_evaluator is True
    assert workflow_query.tags == {"marker": "case"}
