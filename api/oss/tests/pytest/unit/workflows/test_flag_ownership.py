import warnings
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import oss.src.core.workflows.service as workflows_service_module
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import (
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowFlags,
    WorkflowRevision,
    WorkflowRevisionCreate,
    WorkflowRevisionEdit,
    WorkflowRevisionFlags,
    WorkflowArtifactFlags,
    WorkflowVariant,
    WorkflowVariantCreate,
    WorkflowVariantFlags,
    WorkflowRevisionCommit,
    WorkflowRevisionData,
)
from oss.src.core.workflows.service import WorkflowsService


def test_get_service_url_derives_builtin_runtime_url():
    url = WorkflowsService._get_service_url(
        revision_data=WorkflowRevisionData(
            uri="agenta:builtin:completion:v0",
        )
    )

    assert url is not None
    assert url.endswith("/services/completion/v0")


@pytest.mark.asyncio
async def test_create_workflow_persists_only_artifact_flags():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    workflow_id = uuid4()
    workflows_dao.create_artifact.return_value = Workflow(
        id=workflow_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )

    await service.create_workflow(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_create=WorkflowCreate(
            slug="wf",
            flags=WorkflowFlags(is_application=True, is_chat=True, is_custom=True),
        ),
    )

    artifact_create = workflows_dao.create_artifact.await_args.kwargs["artifact_create"]
    assert artifact_create.flags is not None
    assert artifact_create.flags == {
        "is_application": True,
        "is_evaluator": False,
        "is_snippet": False,
    }


@pytest.mark.asyncio
async def test_create_workflow_variant_drops_variant_flags():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    variant_id = uuid4()
    artifact_id = uuid4()
    workflows_dao.create_variant.return_value = WorkflowVariant(
        id=variant_id,
        workflow_id=artifact_id,
        slug="main",
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_evaluator=True),
    )

    workflow_variant = await service.create_workflow_variant(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_variant_create=WorkflowVariantCreate(
            workflow_id=artifact_id,
            slug="main",
            flags=WorkflowFlags(is_evaluator=True, is_feedback=True),
        ),
    )

    variant_create = workflows_dao.create_variant.await_args.kwargs["variant_create"]
    assert variant_create.flags is None
    assert workflow_variant is not None
    assert workflow_variant.flags == WorkflowVariantFlags(is_evaluator=True)


@pytest.mark.asyncio
async def test_fetch_workflow_revision_injects_artifact_flags():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    workflows_dao.fetch_revision.return_value = WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="rev",
        flags=WorkflowRevisionFlags(is_chat=True, is_custom=True),
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_variant_ref=Reference(id=variant_id),
    )

    assert revision is not None
    assert revision.flags is not None
    assert revision.flags.is_application is True
    assert revision.flags.is_chat is True
    assert revision.flags.is_custom is True


@pytest.mark.asyncio
async def test_fetch_workflow_revision_injects_builtin_runtime_url():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    workflows_dao.fetch_revision.return_value = WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="rev",
        version="1",
        data=WorkflowRevisionData(uri="agenta:builtin:completion:v0"),
        flags=WorkflowRevisionFlags(is_managed=True, has_url=True),
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )

    revision = await service.fetch_workflow_revision(
        project_id=uuid4(),
        workflow_variant_ref=Reference(id=variant_id),
    )

    assert revision is not None
    assert revision.data is not None
    assert revision.data.url is not None
    assert revision.data.url.endswith("/services/completion/v0")


@pytest.mark.asyncio
async def test_retrieve_workflow_revision_injects_builtin_runtime_url():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    workflows_dao.fetch_revision.return_value = WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="rev",
        version="1",
        data=WorkflowRevisionData(uri="agenta:builtin:completion:v0"),
        flags=WorkflowRevisionFlags(is_managed=True, has_url=True),
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )

    revision, resolution_info = await service.retrieve_workflow_revision(
        project_id=uuid4(),
        workflow_variant_ref=Reference(id=variant_id),
    )

    assert resolution_info is None
    assert revision is not None
    assert revision.data is not None
    assert revision.data.url is not None
    assert revision.data.url.endswith("/services/completion/v0")


@pytest.mark.asyncio
async def test_create_workflow_revision_v0_persists_explicit_revision_flags():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    workflows_dao.create_revision.return_value = WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="v0",
        flags=None,
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )

    workflow_revision = await service.create_workflow_revision(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_revision_create=WorkflowRevisionCreate(
            workflow_id=artifact_id,
            workflow_variant_id=variant_id,
            slug="v0",
            flags=WorkflowFlags(is_application=True, is_chat=True, is_custom=True),
        ),
    )

    revision_create = workflows_dao.create_revision.await_args.kwargs["revision_create"]
    assert revision_create.flags == {
        "is_managed": False,
        "is_custom": True,
        "is_llm": False,
        "is_hook": False,
        "is_code": False,
        "is_match": False,
        "is_feedback": False,
        "is_chat": True,
        "has_url": False,
        "has_script": False,
        "has_handler": False,
    }
    assert workflow_revision is not None
    assert workflow_revision.flags == WorkflowRevisionFlags(is_application=True)


@pytest.mark.asyncio
async def test_edit_workflow_revision_persists_only_revision_flags():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    workflows_dao.edit_revision.return_value = WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="rev",
        flags=WorkflowRevisionFlags(is_chat=True),
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )

    await service.edit_workflow_revision(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_revision_edit=WorkflowRevisionEdit(
            id=revision_id,
            flags=WorkflowFlags(is_application=True, is_chat=True),
        ),
    )

    revision_edit = workflows_dao.edit_revision.await_args.kwargs["revision_edit"]
    assert revision_edit.flags is not None
    assert "is_application" not in revision_edit.flags
    assert "is_evaluator" not in revision_edit.flags
    assert "is_snippet" not in revision_edit.flags
    assert revision_edit.flags["is_chat"] is True


@pytest.mark.asyncio
async def test_commit_workflow_revision_persists_only_revision_flags():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    workflows_dao.commit_revision.return_value = WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="rev",
        flags=WorkflowRevisionFlags(is_chat=True, has_url=True),
        data=WorkflowRevisionData(
            uri="agenta:builtin:chat:v0", url="https://example.com/chat"
        ),
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )

    await service.commit_workflow_revision(
        project_id=uuid4(),
        user_id=uuid4(),
        workflow_revision_commit=WorkflowRevisionCommit(
            workflow_id=artifact_id,
            workflow_variant_id=variant_id,
            slug="rev",
            flags=WorkflowFlags(is_application=True),
            data=WorkflowRevisionData(uri="agenta:builtin:chat:v0"),
        ),
    )

    revision_commit = workflows_dao.commit_revision.await_args.kwargs["revision_commit"]
    assert revision_commit.flags is not None
    assert "is_application" not in revision_commit.flags
    assert "is_evaluator" not in revision_commit.flags
    assert "is_snippet" not in revision_commit.flags
    assert revision_commit.flags["is_managed"] is True
    assert revision_commit.flags["is_chat"] is False


@pytest.mark.asyncio
async def test_commit_workflow_revision_does_not_warn_when_merging_schemas():
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    workflows_dao.commit_revision.return_value = WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="rev",
        flags=WorkflowRevisionFlags(is_chat=True, has_url=True),
        data=WorkflowRevisionData(
            uri="agenta:builtin:chat:v0", url="https://example.com/chat"
        ),
    )
    workflows_dao.fetch_artifact.return_value = Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(),
    )

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")

        await service.commit_workflow_revision(
            project_id=uuid4(),
            user_id=uuid4(),
            workflow_revision_commit=WorkflowRevisionCommit(
                workflow_id=artifact_id,
                workflow_variant_id=variant_id,
                slug="rev",
                data=WorkflowRevisionData(
                    uri="agenta:builtin:chat:v0",
                    schemas={
                        "parameters": {
                            "$schema": "https://json-schema.org/draft/2020-12/schema",
                            "type": "object",
                            "properties": {"temperature": {"type": "number"}},
                        }
                    },
                ),
            ),
        )

    serializer_warnings = [
        warning
        for warning in caught
        if "Expected `JsonSchemas`" in str(warning.message)
    ]
    assert serializer_warnings == []

    revision_commit = workflows_dao.commit_revision.await_args.kwargs["revision_commit"]
    assert revision_commit.data is not None
    assert revision_commit.data["schemas"]["parameters"]["type"] == "object"


@pytest.mark.asyncio
async def test_fetch_workflow_uses_cached_artifact_by_id(monkeypatch):
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    project_id = uuid4()
    workflow_id = uuid4()
    cached_workflow = Workflow(
        id=workflow_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )

    get_cache = AsyncMock(return_value=cached_workflow)
    monkeypatch.setattr(workflows_service_module, "get_cache", get_cache)
    monkeypatch.setattr(workflows_service_module, "set_cache", AsyncMock())
    monkeypatch.setattr(workflows_service_module, "invalidate_cache", AsyncMock())

    workflow = await service.fetch_workflow(
        project_id=project_id,
        workflow_ref=Reference(id=workflow_id),
    )

    assert workflow == cached_workflow
    workflows_dao.fetch_artifact.assert_not_awaited()
    get_cache.assert_awaited_once_with(
        namespace="artifact",
        project_id=str(project_id),
        key=str(workflow_id),
        model=Workflow,
        ttl=60,
    )


@pytest.mark.asyncio
async def test_edit_workflow_refreshes_artifact_cache(monkeypatch):
    workflows_dao = AsyncMock()
    service = WorkflowsService(workflows_dao=workflows_dao)

    project_id = uuid4()
    workflow_id = uuid4()
    workflows_dao.edit_artifact.return_value = Workflow(
        id=workflow_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )

    monkeypatch.setattr(workflows_service_module, "get_cache", AsyncMock())
    set_cache = AsyncMock()
    invalidate_cache = AsyncMock()
    monkeypatch.setattr(workflows_service_module, "set_cache", set_cache)
    monkeypatch.setattr(workflows_service_module, "invalidate_cache", invalidate_cache)

    workflow = await service.edit_workflow(
        project_id=project_id,
        user_id=uuid4(),
        workflow_edit=WorkflowEdit(
            id=workflow_id,
            flags=WorkflowFlags(is_application=True, is_chat=True),
        ),
    )

    assert workflow is not None
    invalidate_cache.assert_awaited_once_with(
        namespace="artifact",
        project_id=str(project_id),
        key=str(workflow_id),
    )
    set_cache.assert_awaited_once()
    assert set_cache.await_args.kwargs["namespace"] == "artifact"
    assert set_cache.await_args.kwargs["project_id"] == str(project_id)
    assert set_cache.await_args.kwargs["key"] == str(workflow_id)
    assert set_cache.await_args.kwargs["value"] == workflow
