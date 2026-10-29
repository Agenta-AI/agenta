"""A save through an evaluation edit route makes the editor the executing principal.

Spec section 3.8, rules 1 and 2: `PATCH /evaluations/runs/{run_id}`,
`PATCH /evaluations/runs/`, `PATCH /simple/evaluations/{evaluation_id}` and the simple
evaluation step and repeat routes write the editor as the run's principal in the edit's
own UPDATE. Worker writes and the restart of
an active simple evaluation pass no principal and keep it.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import oss.src.apis.fastapi.evaluations.router as router_module
import oss.src.core.evaluations.service as service_module
from oss.src.apis.fastapi.evaluations.models import (
    AddStepsRequest,
    EvaluationRunEditRequest,
    EvaluationRunsEditRequest,
    RemoveStepsRequest,
    SetRepeatsRequest,
    SimpleEvaluationEditRequest,
)
from oss.src.apis.fastapi.evaluations.router import (
    EvaluationsRouter,
    SimpleEvaluationsRouter,
)
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.evaluations.service import (
    EvaluationsService,
    SimpleEvaluationsService,
)
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunEdit,
    SimpleEvaluationData,
    SimpleEvaluationEdit,
    SimpleEvaluationFlags,
)


_EDITOR = PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4())


def _request(principal):
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(uuid4()), user_id=str(uuid4()), principal=principal
        )
    )


@pytest.fixture
def _allowed(monkeypatch):
    monkeypatch.setattr(
        router_module, "check_action_access", AsyncMock(return_value=True)
    )


# -- the routes take the editor from the request -----------------------------------


@pytest.mark.parametrize(
    "editor",
    [_EDITOR, PrincipalRef(kind=PrincipalKind.API_KEY, id=uuid4())],
    ids=["human", "api_key"],
)
async def test_run_edit_routes_pass_the_request_principal(_allowed, editor):
    service = SimpleNamespace(
        edit_run=AsyncMock(return_value=None), edit_runs=AsyncMock(return_value=[])
    )
    router = EvaluationsRouter(evaluations_service=service, queries_service=None)
    run = EvaluationRunEdit(id=uuid4(), name="renamed")

    await router.edit_run(
        _request(editor),
        run_id=run.id,
        run_edit_request=EvaluationRunEditRequest(run=run),
    )
    await router.edit_runs(
        _request(editor),
        runs_edit_request=EvaluationRunsEditRequest(runs=[run]),
    )

    assert service.edit_run.await_args.kwargs["principal"] == editor
    assert service.edit_runs.await_args.kwargs["principal"] == editor


async def test_simple_edit_route_passes_the_request_principal(_allowed):
    service = SimpleNamespace(edit=AsyncMock(return_value=None))
    router = SimpleEvaluationsRouter(simple_evaluations_service=service)
    evaluation = SimpleEvaluationEdit(id=uuid4(), name="renamed")

    await router.edit_evaluation(
        _request(_EDITOR),
        evaluation_id=evaluation.id,
        evaluation_edit_request=SimpleEvaluationEditRequest(evaluation=evaluation),
    )

    assert service.edit.await_args.kwargs["principal"] == _EDITOR


# -- the services pass it to the DAO write -----------------------------------------


async def test_batch_edit_passes_the_editor_to_the_dao():
    service = EvaluationsService.__new__(EvaluationsService)
    service.evaluations_dao = SimpleNamespace(edit_runs=AsyncMock(return_value=[]))
    service.fetch_runs = AsyncMock(return_value=[])

    await service.edit_runs(
        project_id=uuid4(),
        user_id=_EDITOR.id,
        runs=[EvaluationRunEdit(id=uuid4(), name="renamed")],
        principal=_EDITOR,
    )

    assert service.evaluations_dao.edit_runs.await_args.kwargs["principal"] == _EDITOR


@pytest.mark.parametrize("was_active", [False, True])
async def test_simple_edit_writes_the_editor_and_the_restart_keeps_it(
    monkeypatch, was_active
):
    monkeypatch.setattr(service_module, "sleep", AsyncMock())
    evaluation_id = uuid4()
    stored = SimpleNamespace(
        id=evaluation_id,
        flags=SimpleEvaluationFlags(is_active=was_active),
        data=SimpleEvaluationData(),
    )
    evaluations = SimpleNamespace(
        edit_run=AsyncMock(return_value=SimpleNamespace(id=evaluation_id))
    )
    service = SimpleEvaluationsService.__new__(SimpleEvaluationsService)
    service.evaluations_service = evaluations
    service.fetch = AsyncMock(return_value=stored)
    service.stop = AsyncMock(return_value=stored)
    service.start = AsyncMock(return_value=stored)
    service._make_evaluation_run_flags = AsyncMock(return_value=None)
    service._make_evaluation_run_data = AsyncMock(return_value=None)

    await service.edit(
        project_id=uuid4(),
        user_id=_EDITOR.id,
        evaluation=SimpleEvaluationEdit(
            id=evaluation_id, name="renamed", data=SimpleEvaluationData()
        ),
        principal=_EDITOR,
    )

    assert evaluations.edit_run.await_args.kwargs["principal"] == _EDITOR
    if was_active:
        assert "principal" not in service.start.await_args.kwargs


async def test_step_and_repeat_routes_pass_the_request_principal(_allowed):
    service = SimpleNamespace(
        add_steps=AsyncMock(return_value=None),
        remove_steps=AsyncMock(return_value=None),
        set_repeats=AsyncMock(return_value=None),
    )
    router = SimpleEvaluationsRouter(simple_evaluations_service=service)
    evaluation_id = uuid4()

    await router.add_evaluation_steps(
        _request(_EDITOR),
        evaluation_id=evaluation_id,
        add_request=AddStepsRequest(steps=[_step("judge")]),
    )
    await router.remove_evaluation_steps(
        _request(_EDITOR),
        evaluation_id=evaluation_id,
        remove_request=RemoveStepsRequest(step_keys=["judge"]),
    )
    await router.set_evaluation_repeats(
        _request(_EDITOR),
        evaluation_id=evaluation_id,
        repeats_request=SetRepeatsRequest(repeats=2),
    )

    for call in (service.add_steps, service.remove_steps, service.set_repeats):
        assert call.await_args.kwargs["principal"] == _EDITOR


def _step(key):
    return EvaluationRunDataStep(
        key=key, type="annotation", origin="auto", references={}
    )


async def test_step_and_repeat_edits_write_the_editor():
    run = EvaluationRun(
        id=uuid4(),
        name="r",
        data=EvaluationRunData(steps=[_step("input")], repeats=1),
    )
    evaluations = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        edit_run=AsyncMock(return_value=run),
    )
    service = SimpleEvaluationsService.__new__(SimpleEvaluationsService)
    service.evaluations_service = evaluations
    scope = {"project_id": uuid4(), "user_id": _EDITOR.id, "run_id": run.id}

    await service.add_steps(**scope, steps=[_step("judge")], principal=_EDITOR)
    assert evaluations.edit_run.await_args.kwargs["principal"] == _EDITOR
    evaluations.edit_run.reset_mock()
    await service.remove_steps(**scope, step_keys=["input"], principal=_EDITOR)
    assert evaluations.edit_run.await_args.kwargs["principal"] == _EDITOR
    evaluations.edit_run.reset_mock()
    await service.set_repeats(**scope, repeats=3, principal=_EDITOR)
    assert evaluations.edit_run.await_args.kwargs["principal"] == _EDITOR
