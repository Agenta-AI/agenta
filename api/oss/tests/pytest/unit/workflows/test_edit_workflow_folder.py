from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import oss.src.core.workflows.service as workflows_service_module
from oss.src.core.applications.dtos import ApplicationEdit
from oss.src.core.applications.service import ApplicationsService
from oss.src.core.evaluators.dtos import EvaluatorEdit
from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.apis.fastapi.workflows.models import WorkflowEditRequest
from oss.src.core.workflows.dtos import Workflow
from oss.src.core.workflows.service import WorkflowsService


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setattr(workflows_service_module, "get_cache", AsyncMock())
    monkeypatch.setattr(workflows_service_module, "set_cache", AsyncMock())
    monkeypatch.setattr(workflows_service_module, "invalidate_cache", AsyncMock())
    workflows_dao = AsyncMock()
    workflow = Workflow(id=uuid4(), slug="wf", folder_id=uuid4())
    workflows_dao.fetch_artifact.return_value = workflow
    workflows_dao.edit_artifact.return_value = workflow
    return WorkflowsService(workflows_dao=workflows_dao), workflow.id


def _artifact_edit(service):
    return service.workflows_dao.edit_artifact.await_args.kwargs["artifact_edit"]


def _request_body(workflow: dict):
    """The edit as the router gets it: parsed from the JSON body of PUT /workflows/{id}."""
    return WorkflowEditRequest.model_validate({"workflow": workflow}).workflow


@pytest.mark.asyncio
async def test_a_null_folder_id_moves_the_workflow_to_the_top_level(service):
    workflows_service, workflow_id = service

    await workflows_service.edit_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_edit=_request_body({"id": str(workflow_id), "folder_id": None}),
    )

    artifact_edit = _artifact_edit(workflows_service)
    assert "folder_id" in artifact_edit.model_fields_set
    assert artifact_edit.folder_id is None


@pytest.mark.asyncio
async def test_a_folder_id_in_the_body_moves_the_workflow_to_that_folder(service):
    workflows_service, workflow_id = service
    destination = uuid4()

    await workflows_service.edit_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_edit=_request_body(
            {"id": str(workflow_id), "folder_id": str(destination)}
        ),
    )

    assert _artifact_edit(workflows_service).folder_id == destination


@pytest.mark.asyncio
async def test_an_edit_without_folder_id_keeps_the_folder(service):
    workflows_service, workflow_id = service

    await workflows_service.edit_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_edit=_request_body({"id": str(workflow_id), "name": "Renamed"}),
    )

    assert "folder_id" not in _artifact_edit(workflows_service).model_fields_set


@pytest.mark.asyncio
async def test_an_application_rename_keeps_the_folder(service):
    workflows_service, workflow_id = service

    await ApplicationsService(workflows_service=workflows_service).edit_application(
        project_id=uuid4(),
        user_id=uuid4(),
        application_edit=ApplicationEdit(id=workflow_id, name="Renamed"),
    )

    assert "folder_id" not in _artifact_edit(workflows_service).model_fields_set


@pytest.mark.asyncio
async def test_an_evaluator_rename_keeps_the_folder(service):
    workflows_service, workflow_id = service

    await EvaluatorsService(workflows_service=workflows_service).edit_evaluator(
        project_id=uuid4(),
        user_id=uuid4(),
        evaluator_edit=EvaluatorEdit(id=workflow_id, name="Renamed"),
    )

    assert "folder_id" not in _artifact_edit(workflows_service).model_fields_set
