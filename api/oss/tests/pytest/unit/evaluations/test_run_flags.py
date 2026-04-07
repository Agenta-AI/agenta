from uuid import uuid4

from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunFlags,
    EvaluationRunQueryFlags,
)
from oss.src.dbs.postgres.evaluations.utils import create_run_flags


def test_create_run_flags_preserves_cache_and_split_flags_while_recomputing_shape_flags():
    run = EvaluationRun(
        flags=EvaluationRunFlags(is_cached=True, is_split=True),
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="input-query",
                    type="input",
                    origin="auto",
                    references={
                        "query_revision": {
                            "id": str(uuid4()),
                        }
                    },
                ),
                EvaluationRunDataStep(
                    key="annotation-evaluator",
                    type="annotation",
                    origin="human",
                    references={
                        "evaluator_revision": {
                            "id": str(uuid4()),
                        }
                    },
                ),
            ]
        ),
    )

    flags = create_run_flags(run)

    assert flags is not None
    assert flags.is_cached is True
    assert flags.is_split is True
    assert flags.has_queries is True
    assert flags.has_evaluators is True
    assert flags.has_human is True


def test_evaluation_run_query_flags_include_cache_and_split_when_explicit():
    flags = EvaluationRunQueryFlags(is_cached=False, is_split=False)

    assert flags.model_dump(exclude_none=True) == {
        "is_cached": False,
        "is_split": False,
    }
