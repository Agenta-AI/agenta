"""The edit endpoint rejects a blank workflow name at the API boundary.

The LLM-facing `rename_agent` schema requires a non-whitespace name, but that schema
gates only the tool: a direct PUT used to persist `"   "` as the artifact name, which
renders as an unreadable row in every list. The shared `ArtifactEdit` shape carries no
constraint (other git entities reuse it), so the check lives in the handler: a PRESENT
name must contain a non-whitespace character, while an omitted name still means
"no change".
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

WORKFLOW_ID = uuid4()


def _request():
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(uuid4()),
            user_id=str(uuid4()),
        )
    )


def _edit_request(**workflow):
    from oss.src.apis.fastapi.workflows.models import WorkflowEditRequest

    return WorkflowEditRequest.model_validate(
        {"workflow": {"id": str(WORKFLOW_ID), **workflow}}
    )


@pytest.fixture
def router():
    from oss.src.apis.fastapi.workflows.router import WorkflowsRouter

    return WorkflowsRouter(
        workflows_service=AsyncMock(),
        environments_service=AsyncMock(),
    )


@pytest.fixture
def allow_access():
    with patch(
        "oss.src.apis.fastapi.workflows.router.check_action_access",
        AsyncMock(return_value=True),
    ):
        yield


async def _edit(router, **workflow):
    return await router.edit_workflow(
        _request(),
        workflow_id=WORKFLOW_ID,
        workflow_edit_request=_edit_request(**workflow),
    )


class TestEditWorkflowNameValidation:
    async def test_whitespace_only_name_is_a_422_and_never_reaches_the_service(
        self, router, allow_access
    ):
        with pytest.raises(HTTPException) as caught:
            await _edit(router, name="   ")

        assert caught.value.status_code == 422
        router.workflows_service.edit_workflow.assert_not_awaited()

    async def test_empty_name_is_a_422_and_never_reaches_the_service(
        self, router, allow_access
    ):
        with pytest.raises(HTTPException) as caught:
            await _edit(router, name="")

        assert caught.value.status_code == 422
        router.workflows_service.edit_workflow.assert_not_awaited()

    async def test_omitted_name_still_means_no_change_and_passes_through(
        self, router, allow_access
    ):
        from oss.src.core.workflows.dtos import Workflow

        router.workflows_service.edit_workflow.return_value = Workflow(
            id=WORKFLOW_ID, slug="workflow"
        )

        response = await _edit(router, description="New description")

        assert response.count == 1
        router.workflows_service.edit_workflow.assert_awaited_once()

    async def test_a_normal_rename_passes_through(self, router, allow_access):
        from oss.src.core.workflows.dtos import Workflow

        router.workflows_service.edit_workflow.return_value = Workflow(
            id=WORKFLOW_ID, slug="workflow", name="Support triage"
        )

        response = await _edit(router, name="Support triage")

        assert response.count == 1
        router.workflows_service.edit_workflow.assert_awaited_once()
