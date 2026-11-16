"""A commit must not store an agent drive list that no run can use.

The entry rules are the SDK's `validate_agent_drives` (code `invalid_drive_entry`). A
`project` entry must also name an active project drive of the same project
(code `drive_not_found`). Both answer 422 with the agent-facing envelope.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.workflows.exceptions import handle_workflow_exceptions
from oss.src.core.applications.dtos import ApplicationRevision, SimpleApplicationEdit
from oss.src.core.applications.service import SimpleApplicationsService
from oss.src.core.workflows.dtos import (
    SimpleWorkflowCreate,
    SimpleWorkflowEdit,
    WorkflowRevision,
    WorkflowVariant,
    WorkflowRevisionCommit,
)
from oss.src.core.workflows.service import SimpleWorkflowsService, WorkflowsService
from oss.src.core.workflows.types import (
    AgentDriveError,
    AgentDriveNotFoundError,
    InvalidAgentDrivesError,
    InvalidSessionDriveError,
    ProjectMountLookupMissing,
)
from oss.src.core.mounts.service import project_mount_lookup
from oss.src.core.mounts.types import MountSlugReserved


def _commit(**agent):
    return WorkflowRevisionCommit(
        slug="drive-check",
        workflow_id=uuid4(),
        workflow_variant_id=uuid4(),
        data={
            "uri": "agenta:builtin:agent:v0",
            "parameters": {"agent": {"llm": {"model": "gpt-5.5"}, **agent}},
        },
    )


def _service(existing=("price-lists",)):
    workflows_dao = AsyncMock()
    workflows_dao.fetch_revision.return_value = None
    workflows_dao.fetch_variant.return_value = None
    workflows_dao.commit_revision.return_value = None
    service = WorkflowsService(workflows_dao=workflows_dao)
    looked_up = []

    async def lookup(*, project_id, slug):
        looked_up.append((project_id, slug))
        return object() if slug in existing else None

    service.set_project_mount_lookup(lookup)
    return service, workflows_dao, looked_up


async def _refusal(service, commit) -> AgentDriveError:
    with pytest.raises(AgentDriveError) as caught:
        await service.commit_workflow_revision(
            project_id=uuid4(), user_id=uuid4(), workflow_revision_commit=commit
        )
    return caught.value


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "agent, field",
    [
        ({"drives": "agent"}, "parameters.agent.drives"),
        (
            {"drives": [{"kind": "project", "slug": f"d{i}"} for i in range(9)]},
            "parameters.agent.drives",
        ),
        ({"drives": [{"kind": "project"}]}, "parameters.agent.drives[0].slug"),
        (
            {"drives": [{"kind": "agent"}, {"kind": "agent"}]},
            "parameters.agent.drives[1].kind",
        ),
        (
            {"drives": [{"kind": "agent", "access": "read"}]},
            "parameters.agent.drives[0].access",
        ),
        (
            {"drives": [{"kind": "project", "slug": "a", "access": "write"}]},
            "parameters.agent.drives[0].access",
        ),
        ({"drives": [{"kind": "session"}]}, "parameters.agent.drives[0].kind"),
    ],
)
async def test_a_broken_entry_is_refused_before_the_dao(agent, field):
    service, dao, looked_up = _service()
    error = await _refusal(service, _commit(**agent))
    assert isinstance(error, InvalidAgentDrivesError)
    detail = error.to_detail()
    assert detail["code"] == "invalid_drive_entry"
    assert detail["retryable"] is False
    assert detail["next_step"]
    assert detail["details"]["field"] == field
    dao.commit_revision.assert_not_awaited()
    assert looked_up == []


@pytest.mark.asyncio
async def test_a_missing_project_drive_is_refused_with_its_slug():
    service, dao, looked_up = _service()
    error = await _refusal(
        service,
        _commit(
            drives=[
                {"kind": "agent"},
                {"kind": "project", "slug": "price-lists", "access": "read"},
                {"kind": "project", "slug": "missing"},
            ]
        ),
    )
    assert isinstance(error, AgentDriveNotFoundError)
    assert error.to_detail() == {
        "code": "drive_not_found",
        "message": "The drive 'missing' does not exist in this project.",
        "retryable": False,
        "next_step": "Create the drive with POST /mounts/, then commit again.",
        "details": {"field": "parameters.agent.drives[2].slug", "value": "missing"},
    }
    assert [slug for _, slug in looked_up] == ["price-lists", "missing"]
    dao.commit_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_lookup_is_scoped_to_the_commit_project():
    service, _, looked_up = _service()
    project_id = uuid4()
    await service.commit_workflow_revision(
        project_id=project_id,
        user_id=uuid4(),
        workflow_revision_commit=_commit(
            drives=[{"kind": "project", "slug": "price-lists"}]
        ),
    )
    assert looked_up == [(project_id, "price-lists")]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "agent",
    [
        {},
        {"drives": None, "has_session_drive": None},
        {"drives": [], "has_session_drive": False},
        {"drives": [{"kind": "agent"}], "has_session_drive": True},
        {"drives": [{"kind": "project", "slug": "price-lists", "access": "read"}]},
    ],
)
async def test_a_usable_list_reaches_the_dao(agent):
    service, dao, _ = _service()
    await service.commit_workflow_revision(
        project_id=uuid4(), user_id=uuid4(), workflow_revision_commit=_commit(**agent)
    )
    dao.commit_revision.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_workflow_that_is_not_an_agent_is_left_alone():
    service, dao, looked_up = _service()
    commit = WorkflowRevisionCommit(
        slug="plain",
        workflow_id=uuid4(),
        workflow_variant_id=uuid4(),
        data={"parameters": {"prompt": {"drives": "anything"}}},
    )
    await service.commit_workflow_revision(
        project_id=uuid4(), user_id=uuid4(), workflow_revision_commit=commit
    )
    dao.commit_revision.assert_awaited_once()
    assert looked_up == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        InvalidAgentDrivesError(field="drives", value=1, message="m", next_step="n"),
        AgentDriveNotFoundError(
            field="drives[0].slug", value="x", message="m", next_step="n"
        ),
    ],
)
async def test_the_routes_answer_422_with_the_envelope(error):
    @handle_workflow_exceptions()
    async def route():
        raise error

    with pytest.raises(HTTPException) as caught:
        await route()
    assert caught.value.status_code == 422
    assert caught.value.detail["code"] == error.code


@pytest.mark.asyncio
async def test_a_project_entry_without_a_lookup_fails_closed():
    workflows_dao = AsyncMock()
    workflows_dao.fetch_revision.return_value = None
    service = WorkflowsService(workflows_dao=workflows_dao)
    with pytest.raises(ProjectMountLookupMissing):
        await service.commit_workflow_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=_commit(
                drives=[{"kind": "project", "slug": "price-lists"}]
            ),
        )
    workflows_dao.commit_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_without_a_project_entry_no_lookup_is_needed():
    workflows_dao = AsyncMock()
    workflows_dao.fetch_revision.return_value = None
    workflows_dao.commit_revision.return_value = None
    service = WorkflowsService(workflows_dao=workflows_dao)
    await service.commit_workflow_revision(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_revision_commit=_commit(drives=[{"kind": "agent"}]),
    )
    workflows_dao.commit_revision.assert_awaited_once()


@pytest.mark.asyncio
async def test_the_shared_lookup_reads_a_reserved_slug_as_missing():
    mounts_service = AsyncMock()
    mounts_service.fetch_project_mount.side_effect = MountSlugReserved("__ag__x")
    lookup = project_mount_lookup(mounts_service)
    assert await lookup(project_id=uuid4(), slug="__ag__x") is None


@pytest.mark.asyncio
async def test_a_broken_session_drive_has_its_own_code():
    service, dao, _ = _service()
    error = await _refusal(service, _commit(has_session_drive="yes"))
    assert isinstance(error, InvalidSessionDriveError)
    detail = error.to_detail()
    assert detail["code"] == "invalid_session_drive"
    assert detail["details"]["field"] == "parameters.agent.has_session_drive"
    assert "has_session_drive" in detail["message"]
    assert "parameters.agent.has_session_drive" in detail["next_step"]
    dao.commit_revision.assert_not_awaited()


_MISSING_DRIVE = {
    "uri": "agenta:builtin:agent:v0",
    "parameters": {"agent": {"drives": [{"kind": "project", "slug": "missing"}]}},
}


def _simple_service():
    service, dao, _ = _service()
    workflows_service = AsyncMock()
    workflows_service.reject_unusable_agent_drives = (
        service.reject_unusable_agent_drives
    )
    return SimpleWorkflowsService(
        workflows_service=workflows_service
    ), workflows_service


@pytest.mark.asyncio
async def test_simple_create_refuses_before_any_write():
    simple, workflows_service = _simple_service()
    with pytest.raises(AgentDriveNotFoundError):
        await simple.create(
            project_id=uuid4(),
            user_id=uuid4(),
            simple_workflow_create=SimpleWorkflowCreate(
                slug="drive-check", data=_MISSING_DRIVE
            ),
        )
    workflows_service.create_workflow.assert_not_awaited()


@pytest.mark.asyncio
async def test_idempotent_create_refuses_before_any_write():
    simple, workflows_service = _simple_service()
    workflows_service.fetch_workflow = AsyncMock(return_value=None)
    with pytest.raises(AgentDriveNotFoundError):
        await simple.create_idempotent(
            project_id=uuid4(),
            user_id=uuid4(),
            namespace="ns",
            request_key="key",
            request_fingerprint="fp",
            component="agent",
            simple_workflow_create=SimpleWorkflowCreate(
                slug="drive-check", data=_MISSING_DRIVE
            ),
        )
    workflows_service.create_workflow.assert_not_awaited()


@pytest.mark.asyncio
async def test_simple_edit_refuses_before_any_write():
    simple, workflows_service = _simple_service()
    with pytest.raises(AgentDriveNotFoundError):
        await simple.edit(
            project_id=uuid4(),
            user_id=uuid4(),
            simple_workflow_edit=SimpleWorkflowEdit(id=uuid4(), data=_MISSING_DRIVE),
        )
    workflows_service.edit_workflow.assert_not_awaited()


@pytest.mark.asyncio
async def test_simple_edit_without_data_reads_the_current_revision_once():
    simple, workflows_service = _simple_service()
    variant_id = uuid4()
    workflows_service.fetch_workflow_variant = AsyncMock(
        return_value=WorkflowVariant(id=variant_id, slug="default")
    )
    workflows_service.fetch_workflow_revision = AsyncMock(
        return_value=WorkflowRevision(id=uuid4(), slug="head", data=_MISSING_DRIVE)
    )
    with pytest.raises(AgentDriveNotFoundError):
        await simple.edit(
            project_id=uuid4(),
            user_id=uuid4(),
            simple_workflow_edit=SimpleWorkflowEdit(id=uuid4(), name="Renamed"),
        )
    workflows_service.fetch_workflow_revision.assert_awaited_once()
    assert (
        workflows_service.fetch_workflow_revision.await_args.kwargs[
            "workflow_variant_ref"
        ].id
        == variant_id
    )
    workflows_service.edit_workflow.assert_not_awaited()
    workflows_service.commit_workflow_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_application_rename_without_data_is_refused_before_the_rename():
    service, _, _ = _service()
    applications_service = AsyncMock()
    applications_service.workflows_service = service
    applications_service.fetch_application = AsyncMock(
        return_value=SimpleNamespace(id=uuid4(), flags=None, meta=None, tags=None)
    )
    applications_service.fetch_application_variant = AsyncMock(
        return_value=SimpleNamespace(id=uuid4())
    )
    applications_service.fetch_application_revision = AsyncMock(
        return_value=ApplicationRevision(id=uuid4(), slug="head", data=_MISSING_DRIVE)
    )
    simple = SimpleApplicationsService(applications_service=applications_service)
    with pytest.raises(AgentDriveNotFoundError):
        await simple.edit(
            project_id=uuid4(),
            user_id=uuid4(),
            simple_application_edit=SimpleApplicationEdit(id=uuid4(), name="Renamed"),
        )
    applications_service.fetch_application_revision.assert_awaited_once()
    applications_service.edit_application.assert_not_awaited()
    applications_service.commit_application_revision.assert_not_awaited()
