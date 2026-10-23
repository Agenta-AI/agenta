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


# -- C12: recheck before each run -----------------------------------------------------


async def test_worker_denial_fails_with_access_denied(monkeypatch):
    """A batch or rerun worker whose run principal lost access ends the run failed and
    inactive; no scenario executes."""

    import oss.src.core.access.service as access_module
    from oss.src.core.access.dtos import DecisionReason
    from oss.src.core.evaluations.runtime.types import RunSlice
    from oss.src.core.evaluations.types import (
        EvaluationRunData,
        EvaluationRunDataStep,
        EvaluationStatus,
    )
    from oss.tests.pytest.utils.principals import DenyingAccessService

    monkeypatch.setattr(
        access_module,
        "_access_service",
        DenyingAccessService(reason=DecisionReason.NOT_MEMBER),
    )
    run = EvaluationRun(
        id=uuid4(),
        name="r",
        created_by_id=uuid4(),
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4()),
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

    await processor.process(
        project_id=uuid4(), user_id=uuid4(), run_slice=RunSlice(run_id=run.id)
    )

    edited = service.edit_run.await_args.kwargs["run"]
    assert edited.status == EvaluationStatus.FAILURE
    assert edited.flags.is_active is False


def _live_service(run):
    from oss.src.core.evaluations.service import EvaluationsService

    service = EvaluationsService.__new__(EvaluationsService)
    service.fetch_live_runs = AsyncMock(return_value=[(uuid4(), run)])
    service.evaluations_task_runner = SimpleNamespace(
        process_run_from_source=AsyncMock()
    )
    service._is_live_run_valid = AsyncMock(return_value=True)
    service._ensure_human_annotation_queue = AsyncMock()
    service._close_live_run = AsyncMock()
    return service


@pytest.mark.parametrize("lost", ["access", "principal"])
async def test_live_run_closed_when_principal_lost(monkeypatch, lost):
    from datetime import datetime, timezone

    import oss.src.core.access.service as access_module
    from oss.tests.pytest.utils.principals import DenyingAccessService

    monkeypatch.setattr(access_module, "_access_service", DenyingAccessService())
    run = EvaluationRun(
        id=uuid4(),
        created_by_id=uuid4(),
        principal=(
            None
            if lost == "principal"
            else PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
        ),
    )
    service = _live_service(run)

    await service.refresh_runs(timestamp=datetime.now(timezone.utc))

    service._close_live_run.assert_awaited_once()
    service.evaluations_task_runner.process_run_from_source.assert_not_awaited()


async def test_live_run_with_access_keeps_ticking(_allowing_access_service):
    from datetime import datetime, timezone

    run = EvaluationRun(
        id=uuid4(),
        created_by_id=uuid4(),
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4()),
    )
    service = _live_service(run)

    await service.refresh_runs(timestamp=datetime.now(timezone.utc))

    service._close_live_run.assert_not_awaited()
    service.evaluations_task_runner.process_run_from_source.assert_awaited_once()
    assert _allowing_access_service.required[-1]["action"].value == (
        "edit_evaluation_runs"
    )


@pytest.mark.parametrize("refusal", ["missing_principal", "access_denied"])
async def test_run_from_source_refuses_before_any_source(monkeypatch, refusal):
    """Every topology goes through `run_from_source` or `run_from_batch`; both check
    the principal before reading a source, so an empty testset or an open queue
    cannot end SUCCESS or stay active for a refused run. The run here has no steps:
    the check comes before the step validation."""

    import oss.src.core.access.service as access_module
    from oss.src.core.evaluations.tasks.run import RunProcessor
    from oss.src.core.evaluations.types import EvaluationStatus
    from oss.tests.pytest.utils.principals import DenyingAccessService

    monkeypatch.setattr(access_module, "_access_service", DenyingAccessService())
    run = EvaluationRun(
        id=uuid4(),
        name="r",
        created_by_id=uuid4(),
        principal=(
            None
            if refusal == "missing_principal"
            else PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())
        ),
        flags=EvaluationRunFlags(is_active=True),
    )
    service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run), edit_run=AsyncMock()
    )
    processor = RunProcessor.__new__(RunProcessor)
    processor.evaluations_service = service

    for call in (
        processor.run_from_source(project_id=uuid4(), user_id=uuid4(), run_id=run.id),
        processor.run_from_batch(
            project_id=uuid4(),
            user_id=uuid4(),
            run_id=run.id,
            source_kind="traces",
            trace_ids=["t-1"],
        ),
    ):
        service.edit_run.reset_mock()
        assert await call is False
        edited = service.edit_run.await_args.kwargs["run"]
        assert edited.status == EvaluationStatus.FAILURE
        assert edited.flags.is_active is False


async def test_installation_run_uses_the_starting_linked_user(_allowing_access_service):
    """Alice (admin) creates the evaluation; an installation linked to Bob starts it.
    The run uses Bob's role (the acting user of the start), never Alice's."""

    alice, bob = uuid4(), uuid4()
    installation = PrincipalRef(kind=PrincipalKind.INSTALLATION, id=uuid4())
    run = EvaluationRun(
        id=uuid4(),
        created_by_id=alice,
        principal=installation,
        principal_user_id=bob,
    )
    envelope = await _processor()._run_envelope(project_id=uuid4(), run=run)
    assert envelope.authority.principal == installation
    assert envelope.authority.linked_user_id == bob


def test_principal_user_id_is_not_in_responses():
    run = EvaluationRun(id=uuid4(), principal_user_id=uuid4())
    assert "principal_user_id" not in run.model_dump()


async def test_start_stores_the_acting_user_with_the_principal():
    dao = SimpleNamespace(set_run_principal=AsyncMock())
    from oss.src.core.evaluations.service import EvaluationsService

    service = EvaluationsService.__new__(EvaluationsService)
    service.evaluations_dao = dao
    principal = PrincipalRef(kind=PrincipalKind.INSTALLATION, id=uuid4())
    user = uuid4()
    await service.set_run_principal(
        project_id=uuid4(), run_id=uuid4(), principal=principal, user_id=user
    )
    assert dao.set_run_principal.await_args.kwargs["user_id"] == user


@pytest.mark.parametrize("data", [None, "empty"])
async def test_refused_run_without_steps_is_closed_through_process(data):
    from oss.src.core.evaluations.runtime.types import RunSlice
    from oss.src.core.evaluations.types import EvaluationRunData, EvaluationStatus

    run = EvaluationRun(
        id=uuid4(),
        name="r",
        created_by_id=uuid4(),
        flags=EvaluationRunFlags(is_active=True),
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(steps=[], mappings=[]) if data == "empty" else None,
    )
    service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run), edit_run=AsyncMock()
    )
    processor = _processor()
    processor.evaluations_service = service

    await processor.process(
        project_id=uuid4(), user_id=uuid4(), run_slice=RunSlice(run_id=run.id)
    )

    edited = service.edit_run.await_args.kwargs["run"]
    assert edited.status == EvaluationStatus.FAILURE
    assert edited.flags.is_active is False
