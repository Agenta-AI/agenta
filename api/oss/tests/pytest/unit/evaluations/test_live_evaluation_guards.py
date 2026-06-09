# ruff: noqa: E402

import sys
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

sys.modules.setdefault("genson", types.SimpleNamespace(SchemaBuilder=object))

from oss.src.core.evaluators.dtos import EvaluatorRevision
from oss.src.core.evaluations.runtime.sources import QueryRevisionTraceResolver
from oss.src.core.evaluations.service import SimpleEvaluationsService
from oss.src.core.evaluations.types import EvaluationRunDataStep
from oss.src.core.queries.dtos import QueryRevision, QueryRevisionData
from oss.src.core.shared.dtos import Reference


@pytest.mark.asyncio
async def test_query_revision_trace_resolver_skips_revision_with_null_data():
    revision_id = uuid4()
    resolver = QueryRevisionTraceResolver(
        queries_service=SimpleNamespace(
            fetch_query_revision=AsyncMock(
                return_value=QueryRevision(
                    id=revision_id,
                    slug="my-query",
                    data=None,
                )
            )
        )
    )

    batch = await resolver.resolve(
        project_id=uuid4(),
        step=EvaluationRunDataStep(
            key="query-step",
            type="input",
            origin="custom",
            references={"query_revision": Reference(id=revision_id)},
        ),
    )

    assert batch is None


@pytest.mark.asyncio
async def test_query_revision_trace_resolver_keeps_revision_with_trace_ids():
    revision_id = uuid4()
    resolver = QueryRevisionTraceResolver(
        queries_service=SimpleNamespace(
            fetch_query_revision=AsyncMock(
                return_value=QueryRevision(
                    id=revision_id,
                    slug="my-query",
                    data=QueryRevisionData(
                        trace_ids=["00000000000000000000000000000001"]
                    ),
                )
            )
        )
    )

    batch = await resolver.resolve(
        project_id=uuid4(),
        step=EvaluationRunDataStep(
            key="query-step",
            type="input",
            origin="custom",
            references={"query_revision": Reference(id=revision_id)},
        ),
    )

    assert batch is not None
    assert batch.step_key == "query-step"
    assert batch.trace_ids == ["00000000000000000000000000000001"]


@pytest.mark.asyncio
async def test_make_evaluation_run_data_rejects_live_query_revision_with_null_data():
    revision_id = uuid4()
    service = SimpleNamespace(
        queries_service=SimpleNamespace(
            fetch_query_revision=AsyncMock(
                return_value=QueryRevision(
                    id=revision_id,
                    slug="my-query",
                    data=None,
                )
            )
        ),
        testsets_service=SimpleNamespace(),
        applications_service=SimpleNamespace(),
        evaluators_service=SimpleNamespace(),
    )

    run_data = await SimpleEvaluationsService._make_evaluation_run_data(
        service,
        project_id=uuid4(),
        user_id=uuid4(),
        query_steps=[revision_id],
        is_live=True,
    )

    assert run_data is None


@pytest.mark.asyncio
async def test_make_evaluation_run_data_rejects_evaluator_revision_with_null_data():
    revision_id = uuid4()
    service = SimpleNamespace(
        queries_service=SimpleNamespace(),
        testsets_service=SimpleNamespace(),
        applications_service=SimpleNamespace(),
        evaluators_service=SimpleNamespace(
            fetch_evaluator_revision=AsyncMock(
                return_value=EvaluatorRevision(
                    id=revision_id,
                    slug="my-evaluator",
                    data=None,
                )
            )
        ),
    )

    run_data = await SimpleEvaluationsService._make_evaluation_run_data(
        service,
        project_id=uuid4(),
        user_id=uuid4(),
        evaluator_steps=[revision_id],
        is_live=False,
    )

    assert run_data is None
