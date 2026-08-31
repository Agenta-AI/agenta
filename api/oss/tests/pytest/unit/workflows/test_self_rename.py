from unittest.mock import AsyncMock
from uuid import uuid4

from agenta.sdk.models.workflows import AGENT_SELF_NAMED_META_KEY

from oss.src.core.git.dtos import Artifact, ArtifactEditOnceResult
from oss.src.core.workflows.dtos import WorkflowEdit
from oss.src.core.workflows.service import WorkflowsService


class FakeGitDAO:
    def __init__(self, *, current=None, edited=None, once_error=False):
        self.current = current
        self.edited = edited
        self.once_error = once_error
        self.once_calls = []
        self.edit_calls = []

    async def edit_artifact_once(self, **kwargs):
        self.once_calls.append(kwargs)
        if self.once_error:
            raise RuntimeError("write failed")
        if self.edited is not None:
            return ArtifactEditOnceResult(status="updated", artifact=self.edited)
        if self.current is None:
            return ArtifactEditOnceResult(status="not_found")
        return ArtifactEditOnceResult(status="already_marked", artifact=self.current)

    async def fetch_artifact(self, **_kwargs):
        return self.current

    async def edit_artifact(self, **kwargs):
        self.edit_calls.append(kwargs)
        return self.edited


class FakeWatchPublisher:
    def __init__(self):
        self.changed = AsyncMock()


def _artifact(*, artifact_id, name, meta=None):
    return Artifact(
        id=artifact_id,
        slug="agent",
        name=name,
        meta=meta,
    )


def _service(dao, watch=None):
    service = WorkflowsService(workflows_dao=dao, watch_publisher=watch)
    service._refresh_workflow_cache = AsyncMock()
    return service


async def test_first_self_rename_sets_the_marker_and_publishes_once():
    workflow_id = uuid4()
    edited = _artifact(
        artifact_id=workflow_id,
        name="Support Triage",
        meta={AGENT_SELF_NAMED_META_KEY: True},
    )
    dao = FakeGitDAO(edited=edited)
    watch = FakeWatchPublisher()
    service = _service(dao, watch)

    result = await service.rename_workflow_once(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_id=workflow_id,
        name="Support Triage",
        description="Triages incoming support requests.",
    )

    assert result.status == "renamed"
    assert result.workflow.name == "Support Triage"
    assert dao.once_calls[0]["marker_key"] == AGENT_SELF_NAMED_META_KEY
    assert dao.once_calls[0]["artifact_edit"].model_dump(exclude_none=True) == {
        "id": workflow_id,
        "name": "Support Triage",
        "description": "Triages incoming support requests.",
    }
    watch.changed.assert_awaited_once_with(
        project_id=str(dao.once_calls[0]["project_id"]),
        entity="workflow",
        id=str(workflow_id),
    )


async def test_later_self_rename_returns_the_persisted_name_without_writing():
    workflow_id = uuid4()
    current = _artifact(
        artifact_id=workflow_id,
        name="Support Triage",
        meta={AGENT_SELF_NAMED_META_KEY: True},
    )
    service = _service(FakeGitDAO(current=current, edited=None))

    result = await service.rename_workflow_once(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_id=workflow_id,
        name="Another Name",
    )

    assert result.status == "already_renamed"
    assert result.workflow.name == "Support Triage"
    service._refresh_workflow_cache.assert_not_awaited()


async def test_missing_workflow_is_distinct_from_an_existing_marker():
    service = _service(FakeGitDAO())

    result = await service.rename_workflow_once(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_id=uuid4(),
        name="Support Triage",
    )

    assert result.status == "not_found"
    assert result.workflow is None


async def test_failed_write_is_not_misreported_as_a_previous_success():
    workflow_id = uuid4()
    service = _service(FakeGitDAO(once_error=True))

    result = await service.rename_workflow_once(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_id=workflow_id,
        name="Support Triage",
    )

    assert result.status == "failed"
    assert result.workflow is None


async def test_regular_metadata_edits_cannot_erase_the_self_rename_marker():
    workflow_id = uuid4()
    current = _artifact(
        artifact_id=workflow_id,
        name="Support Triage",
        meta={AGENT_SELF_NAMED_META_KEY: True, "old": "value"},
    )
    edited = _artifact(
        artifact_id=workflow_id,
        name="Support Triage",
        meta={AGENT_SELF_NAMED_META_KEY: True, "customer": "value"},
    )
    dao = FakeGitDAO(current=current, edited=edited)
    service = _service(dao)

    await service.edit_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_edit=WorkflowEdit(
            id=workflow_id,
            meta={AGENT_SELF_NAMED_META_KEY: False, "customer": "value"},
        ),
    )

    assert dao.edit_calls[0]["artifact_edit"].meta == {
        AGENT_SELF_NAMED_META_KEY: True,
        "customer": "value",
    }
