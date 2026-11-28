from uuid import uuid4

from oss.src.core.evaluations.service import _is_human_run
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
)
from oss.src.dbs.postgres.evaluations.utils import create_run_flags


def _step(key, type, origin):
    return EvaluationRunDataStep(
        key=key,
        type=type,
        origin=origin,
        references={"revision": {"id": str(uuid4())}},
    )


def _run(*steps):
    run = EvaluationRun(data=EvaluationRunData(steps=list(steps)))
    run.flags = create_run_flags(run)
    return run


def test_human_run_is_human():
    run = _run(
        _step("input", "input", "custom"),
        _step("invocation", "invocation", "human"),
        _step("annotation-human", "annotation", "human"),
    )

    assert _is_human_run(run) is True


def test_automatic_run_with_an_added_human_step_is_not_human():
    run = _run(
        _step("input", "input", "custom"),
        _step("invocation", "invocation", "auto"),
        _step("annotation-auto", "annotation", "auto"),
        _step("annotation-human", "annotation", "human"),
    )

    assert run.flags.has_human is True
    assert _is_human_run(run) is False


def test_custom_invocation_with_a_human_step_is_human():
    # SDK evaluate() runs: application steps have origin custom.
    run = _run(
        _step("input", "input", "custom"),
        _step("invocation", "invocation", "custom"),
        _step("annotation-human", "annotation", "human"),
    )

    assert _is_human_run(run) is True


def test_queue_run_without_invocation_step_is_human():
    run = _run(
        _step("input", "input", "custom"),
        _step("annotation-human", "annotation", "human"),
    )

    assert _is_human_run(run) is True


def test_run_without_human_step_is_not_human():
    run = _run(
        _step("input", "input", "custom"),
        _step("invocation", "invocation", "human"),
        _step("annotation-auto", "annotation", "auto"),
    )

    assert _is_human_run(run) is False


def test_run_without_flags_or_data_is_not_human():
    assert _is_human_run(EvaluationRun()) is False
