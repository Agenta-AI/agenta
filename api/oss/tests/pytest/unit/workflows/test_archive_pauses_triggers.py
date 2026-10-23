"""Archiving an agent pauses its schedules and subscriptions (M2). Unarchiving does not
resume them."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from oss.src.core.workflows.service import WorkflowsService


def _service():
    dao = MagicMock()
    artifact = SimpleNamespace(model_dump=lambda mode=None: {"id": str(uuid4())})
    dao.archive_artifact = AsyncMock(return_value=artifact)
    dao.unarchive_artifact = AsyncMock(return_value=artifact)
    service = WorkflowsService(workflows_dao=dao)
    service._refresh_workflow_cache = AsyncMock()
    triggers = MagicMock()
    triggers.pause_triggers_for_artifact = AsyncMock(return_value=2)
    service.set_triggers_dao(triggers)
    return service, triggers


async def test_archive_workflow_pauses_its_triggers():
    service, triggers = _service()
    project_id, workflow_id = uuid4(), uuid4()

    await service.archive_workflow(
        project_id=project_id, user_id=uuid4(), workflow_id=workflow_id
    )

    triggers.pause_triggers_for_artifact.assert_awaited_once_with(
        project_id=project_id, artifact_id=workflow_id, reason="agent_deleted"
    )


async def test_unarchive_does_not_resume():
    service, triggers = _service()
    await service.unarchive_workflow(
        project_id=uuid4(), user_id=uuid4(), workflow_id=uuid4()
    )
    triggers.pause_triggers_for_artifact.assert_not_awaited()
    assert not [c for c in triggers.mock_calls if "resume" in str(c)]


async def test_archive_of_a_missing_workflow_pauses_nothing():
    service, triggers = _service()
    service.workflows_dao.archive_artifact = AsyncMock(return_value=None)
    await service.archive_workflow(
        project_id=uuid4(), user_id=uuid4(), workflow_id=uuid4()
    )
    triggers.pause_triggers_for_artifact.assert_not_awaited()


def test_the_router_composition_root_wires_the_triggers_dao():
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[5] / "entrypoints" / "routers.py"
    ).read_text()
    assert "workflows_service.set_triggers_dao(triggers_dao)" in source


async def test_resolve_request_target_reports_an_archived_agent():
    from datetime import datetime, timezone

    service, _ = _service()
    artifact_id, revision_id = uuid4(), uuid4()
    service._ensure_request_revision = AsyncMock(
        return_value=SimpleNamespace(artifact_id=artifact_id, id=revision_id)
    )
    service.fetch_workflow = AsyncMock(
        return_value=SimpleNamespace(deleted_at=datetime.now(timezone.utc))
    )
    target = await service.resolve_request_target(
        project_id=uuid4(), request=SimpleNamespace()
    )
    assert target.artifact_id == artifact_id
    assert target.revision_id == revision_id
    assert target.archived is True

    service.fetch_workflow = AsyncMock(return_value=SimpleNamespace(deleted_at=None))
    target = await service.resolve_request_target(
        project_id=uuid4(), request=SimpleNamespace()
    )
    assert target.archived is False

    service._ensure_request_revision = AsyncMock(return_value=None)
    assert (
        await service.resolve_request_target(
            project_id=uuid4(), request=SimpleNamespace()
        )
        is None
    )
