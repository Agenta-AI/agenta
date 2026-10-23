"""Evaluation runs execute as their stored principal (M2, interfaces 3.7)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.access.types import MissingPrincipal
from oss.src.core.evaluations.service import SimpleEvaluationsService
from oss.src.core.evaluations.tasks.processor import APISliceProcessor
from oss.src.core.evaluations.types import EvaluationRun, EvaluationRunFlags


def _processor():
    return APISliceProcessor.__new__(APISliceProcessor)


async def test_evaluation_started_by_api_key(_allowing_access_service):
    key = PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())
    run = EvaluationRun(id=uuid4(), principal=key, created_by_id=uuid4())
    project_id = uuid4()
    envelope = await _processor()._run_envelope(project_id=project_id, run=run)
    assert envelope.authority.principal == key
    assert envelope.authority.project_id == project_id
    assert envelope.authority.organization_id == (
        _allowing_access_service.organization_id
    )
    assert envelope.context.origin.value == "evaluation"
    assert envelope.context.origin_id == str(run.id)
    assert envelope.sender is None


async def test_null_principal_run_fails():
    run = EvaluationRun(id=uuid4(), created_by_id=uuid4())
    with pytest.raises(MissingPrincipal):
        await _processor()._run_envelope(project_id=uuid4(), run=run)


async def test_null_principal_run_is_closed_through_process():
    """The rerun and direct-batch worker paths call `process` and catch nothing. A run
    without a principal ends failed and inactive, never left active."""

    from oss.src.core.evaluations.types import (  # noqa: PLC0415
        EvaluationRunData,
        EvaluationRunDataStep,
        EvaluationStatus,
    )
    from oss.src.core.evaluations.runtime.types import RunSlice  # noqa: PLC0415

    run = EvaluationRun(
        id=uuid4(),
        name="r",
        created_by_id=uuid4(),
        flags=EvaluationRunFlags(is_active=True),
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="input", type="input", origin="custom", references={}
                )
            ],
            mappings=[],
        ),
    )
    service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        edit_run=AsyncMock(),
        query_results=AsyncMock(side_effect=AssertionError("must not execute")),
    )
    processor = _processor()
    processor.evaluations_service = service

    summary = await processor.process(
        project_id=uuid4(),
        user_id=uuid4(),
        run_slice=RunSlice(run_id=run.id),
    )

    assert summary is not None
    edited = service.edit_run.await_args.kwargs["run"]
    assert edited.status == EvaluationStatus.FAILURE
    assert edited.flags.is_active is False
    service.query_results.assert_not_awaited()


def _simple(evaluations_service):
    return SimpleEvaluationsService(
        testsets_service=None,  # type: ignore[arg-type]
        queries_service=None,  # type: ignore[arg-type]
        applications_service=None,  # type: ignore[arg-type]
        evaluators_service=None,  # type: ignore[arg-type]
        evaluations_service=evaluations_service,  # type: ignore[arg-type]
        evaluations_worker=SimpleNamespace(
            process_rerun=SimpleNamespace(kiq=AsyncMock())
        ),
    )


async def test_start_and_process_set_caller():
    caller = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
    run = SimpleNamespace(
        id=uuid4(),
        name="r",
        description=None,
        flags=EvaluationRunFlags(),
        tags=None,
        meta=None,
        data=None,
    )
    evaluations = SimpleNamespace(
        set_run_principal=AsyncMock(),
        fetch_run=AsyncMock(return_value=run),
        edit_run=AsyncMock(),
        query_scenarios=AsyncMock(return_value=[]),
        edit_scenarios=AsyncMock(),
    )
    service = _simple(evaluations)

    # An explicit start: the run executes as the caller from now on.
    service.fetch = AsyncMock(return_value=None)
    await service.start(
        project_id=uuid4(), user_id=caller.id, evaluation_id=run.id, principal=caller
    )
    assert evaluations.set_run_principal.await_args.kwargs["principal"] == caller

    # An explicit rerun (process): the same.
    evaluations.set_run_principal.reset_mock()
    await service.dispatch_run_slice(
        project_id=uuid4(), user_id=caller.id, run_id=run.id, principal=caller
    )
    assert evaluations.set_run_principal.await_args.kwargs["principal"] == caller


async def test_edit_and_refresh_keep_principal():
    evaluations = SimpleNamespace(set_run_principal=AsyncMock())
    service = _simple(evaluations)
    service.fetch = AsyncMock(return_value=None)
    # An edit's internal restart passes no principal.
    await service.start(project_id=uuid4(), user_id=uuid4(), evaluation_id=uuid4())
    evaluations.set_run_principal.assert_not_awaited()


def test_routes_take_the_principal_from_the_request_never_the_body():
    from fastapi import HTTPException

    from oss.src.apis.fastapi.evaluations.router import _caller

    principal = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
    assert _caller(SimpleNamespace(state=SimpleNamespace(principal=principal))) == (
        principal
    )
    with pytest.raises(HTTPException):
        _caller(SimpleNamespace(state=SimpleNamespace()))
