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


def test_create_run_flags_keeps_direct_source_families_distinct_from_backed_sources():
    direct_run = EvaluationRun(
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="traces",
                    type="input",
                    origin="custom",
                    references={},
                ),
                EvaluationRunDataStep(
                    key="testcases",
                    type="input",
                    origin="custom",
                    references={},
                ),
            ]
        )
    )
    backed_run = EvaluationRun(
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="query-main",
                    type="input",
                    origin="custom",
                    references={"query_revision": {"id": str(uuid4())}},
                ),
                EvaluationRunDataStep(
                    key="testset-main",
                    type="input",
                    origin="custom",
                    references={"testset_revision": {"id": str(uuid4())}},
                ),
            ]
        )
    )

    direct_flags = create_run_flags(direct_run)
    backed_flags = create_run_flags(backed_run)

    assert direct_flags is not None
    assert direct_flags.has_traces is True
    assert direct_flags.has_testcases is True
    assert direct_flags.has_queries is False
    assert direct_flags.has_testsets is False
    assert backed_flags is not None
    assert backed_flags.has_queries is True
    assert backed_flags.has_testsets is True
    assert backed_flags.has_traces is False
    assert backed_flags.has_testcases is False


def test_create_run_flags_uses_exact_reference_keys_not_substring():
    # Source-family detection keys on the exact reference key
    # (`query_revision` / `testset_revision`). Keys that merely contain "query"
    # or "testset" as a substring must NOT flip the family flags.
    run = EvaluationRun(
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="input-misc",
                    type="input",
                    origin="custom",
                    references={
                        "query_anchor": {"id": str(uuid4())},
                        "testset_metadata": {"id": str(uuid4())},
                        "subquery_ref": {"id": str(uuid4())},
                    },
                ),
            ]
        )
    )

    flags = create_run_flags(run)

    assert flags is not None
    assert flags.has_queries is False
    assert flags.has_testsets is False


def test_create_run_flags_detects_exact_reference_keys_among_other_refs():
    # The exact key still triggers even when other (non-source) references are
    # present on the same step.
    run = EvaluationRun(
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="input-query",
                    type="input",
                    origin="custom",
                    references={
                        "query_revision": {"id": str(uuid4())},
                        "query_anchor": {"id": str(uuid4())},
                    },
                ),
            ]
        )
    )

    flags = create_run_flags(run)

    assert flags is not None
    assert flags.has_queries is True
    assert flags.has_testsets is False
