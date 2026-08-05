from uuid import uuid4
import sys
import types
from unittest.mock import AsyncMock

import pytest

from oss.src.core.shared.dtos import Reference
from oss.src.core.queries.dtos import QueryRevisionData
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunFlags,
    EvaluationStatus,
)
from oss.src.core.tracing.dtos import Condition, Filtering

sys.modules.setdefault("genson", types.SimpleNamespace(SchemaBuilder=object))

from oss.src.core.evaluations.service import (  # noqa: E402
    EvaluationsService,
    SimpleEvaluationsService,
    _is_invocation_query,
)


@pytest.mark.asyncio
async def test_parse_evaluation_run_prefers_workflow_revision_refs():
    query_id = uuid4()
    application_id = uuid4()
    evaluator_revision_id = uuid4()

    service = SimpleEvaluationsService(
        testsets_service=None,  # type: ignore[arg-type]
        queries_service=None,  # type: ignore[arg-type]
        applications_service=None,  # type: ignore[arg-type]
        evaluators_service=None,  # type: ignore[arg-type]
        evaluations_service=None,  # type: ignore[arg-type]
    )

    run = EvaluationRun(
        id=uuid4(),
        status=EvaluationStatus.PENDING,
        flags=EvaluationRunFlags(),
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="query-step",
                    type="input",
                    origin="custom",
                    references={"query": Reference(id=query_id)},
                ),
                EvaluationRunDataStep(
                    key="application-step",
                    type="invocation",
                    origin="custom",
                    references={"application": Reference(id=application_id)},
                ),
                EvaluationRunDataStep(
                    key="evaluator-step",
                    type="annotation",
                    origin="custom",
                    references={
                        "evaluator_revision": Reference(id=evaluator_revision_id)
                    },
                ),
            ]
        ),
    )

    evaluation = await service._parse_evaluation_run(run=run)

    assert evaluation is not None
    assert evaluation.data is not None
    assert set(evaluation.data.query_steps.keys()) == {query_id}
    assert set(evaluation.data.application_steps.keys()) == {application_id}
    assert set(evaluation.data.evaluator_steps.keys()) == {evaluator_revision_id}


def _query_revision_data(
    *,
    field: str = "trace_type",
    operator: str = "is",
    value: str = "invocation",
) -> QueryRevisionData:
    return QueryRevisionData(
        filtering=Filtering(
            conditions=[
                Condition(
                    field=field,
                    operator=operator,
                    value=value,
                )
            ]
        )
    )


def test_is_invocation_query_requires_top_level_invocation_trace_type():
    assert _is_invocation_query(_query_revision_data()) is True
    assert (
        _is_invocation_query(
            _query_revision_data(field="attributes", value="invocation")
        )
        is False
    )
    assert _is_invocation_query(_query_revision_data(value="annotation")) is False
    assert _is_invocation_query(_query_revision_data(operator="in")) is False
    assert _is_invocation_query(QueryRevisionData()) is False


@pytest.mark.asyncio
async def test_live_run_validation_accepts_invocation_query_revision():
    query_revision_id = uuid4()
    queries_service = types.SimpleNamespace(
        fetch_query_revision=AsyncMock(
            return_value=types.SimpleNamespace(data=_query_revision_data())
        )
    )
    service = EvaluationsService(
        evaluations_dao=None,  # type: ignore[arg-type]
        tracing_service=None,  # type: ignore[arg-type]
        queries_service=queries_service,  # type: ignore[arg-type]
        testsets_service=None,  # type: ignore[arg-type]
        evaluators_service=None,  # type: ignore[arg-type]
    )

    run = EvaluationRun(
        id=uuid4(),
        flags=EvaluationRunFlags(is_live=True, is_active=True),
        status=EvaluationStatus.PENDING,
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="query-step",
                    type="input",
                    origin="custom",
                    references={"query_revision": Reference(id=query_revision_id)},
                )
            ]
        ),
    )

    assert await service._is_live_run_valid(project_id=uuid4(), run=run) is True
    queries_service.fetch_query_revision.assert_awaited_once()


@pytest.mark.asyncio
async def test_live_run_validation_rejects_non_invocation_query_revision():
    query_revision_id = uuid4()
    queries_service = types.SimpleNamespace(
        fetch_query_revision=AsyncMock(
            return_value=types.SimpleNamespace(
                data=_query_revision_data(value="annotation")
            )
        )
    )
    service = EvaluationsService(
        evaluations_dao=None,  # type: ignore[arg-type]
        tracing_service=None,  # type: ignore[arg-type]
        queries_service=queries_service,  # type: ignore[arg-type]
        testsets_service=None,  # type: ignore[arg-type]
        evaluators_service=None,  # type: ignore[arg-type]
    )

    run = EvaluationRun(
        id=uuid4(),
        flags=EvaluationRunFlags(is_live=True, is_active=True),
        status=EvaluationStatus.PENDING,
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="query-step",
                    type="input",
                    origin="custom",
                    references={"query_revision": Reference(id=query_revision_id)},
                )
            ]
        ),
    )

    assert await service._is_live_run_valid(project_id=uuid4(), run=run) is False
