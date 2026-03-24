from uuid import uuid4
import sys
import types

import pytest

from oss.src.core.shared.dtos import Reference
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunFlags,
    EvaluationStatus,
)

sys.modules.setdefault("genson", types.SimpleNamespace(SchemaBuilder=object))

from oss.src.core.evaluations.service import SimpleEvaluationsService  # noqa: E402


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
