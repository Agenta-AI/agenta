"""Unit tests for workflows service retrieve/resolve and RetrievalInfo emission."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.embeds.dtos import ResolutionInfo
from oss.src.core.environments.dtos import EnvironmentRevision, EnvironmentRevisionData
from oss.src.core.git.dtos import RetrievalInfo
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import (
    Workflow,
    WorkflowArtifactFlags,
    WorkflowRevision,
    WorkflowRevisionData,
    WorkflowRevisionFlags,
)
from oss.src.core.workflows.service import WorkflowsService


def _make_workflow_revision(*, artifact_id, variant_id, revision_id):
    return WorkflowRevision(
        id=revision_id,
        workflow_id=artifact_id,
        workflow_variant_id=variant_id,
        slug="rev",
        version="1",
        data=WorkflowRevisionData(url="https://example.test/run"),
        flags=WorkflowRevisionFlags(is_managed=True, has_url=True),
    )


def _make_workflow(*, artifact_id):
    return Workflow(
        id=artifact_id,
        slug="wf",
        flags=WorkflowArtifactFlags(is_application=True),
    )


@pytest.mark.asyncio
async def test_retrieve_workflow_revision_direct_builds_retrieval_info():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    workflows_dao = AsyncMock()
    workflows_dao.fetch_revision.return_value = _make_workflow_revision(
        artifact_id=artifact_id,
        variant_id=variant_id,
        revision_id=revision_id,
    )
    workflows_dao.fetch_artifact.return_value = _make_workflow(artifact_id=artifact_id)

    service = WorkflowsService(workflows_dao=workflows_dao)

    (
        revision,
        resolution_info,
        retrieval_info,
    ) = await service.retrieve_workflow_revision(
        project_id=uuid4(),
        workflow_variant_ref=Reference(id=variant_id),
    )

    assert revision is not None
    assert revision.id == revision_id
    assert resolution_info is None
    assert retrieval_info is not None
    assert retrieval_info.references["workflow"].id == artifact_id
    assert retrieval_info.references["workflow_variant"].id == variant_id
    assert retrieval_info.references["workflow_revision"].id == revision_id
    assert retrieval_info.selector is None


@pytest.mark.asyncio
async def test_retrieve_workflow_revision_env_backed_merges_env_references():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    environment_id = uuid4()
    environment_variant_id = uuid4()
    environment_revision_id = uuid4()

    workflows_dao = AsyncMock()
    workflows_dao.fetch_revision.return_value = _make_workflow_revision(
        artifact_id=artifact_id,
        variant_id=variant_id,
        revision_id=revision_id,
    )
    workflows_dao.fetch_artifact.return_value = _make_workflow(artifact_id=artifact_id)

    environment_revision = EnvironmentRevision(
        id=environment_revision_id,
        environment_id=environment_id,
        environment_variant_id=environment_variant_id,
        slug="env-rev",
        version="7",
        data=EnvironmentRevisionData(
            references={
                "demo.revision": {
                    "workflow": Reference(id=artifact_id, slug="wf"),
                    "workflow_variant": Reference(id=variant_id),
                    "workflow_revision": Reference(id=revision_id, version="1"),
                }
            },
        ),
    )
    environment_retrieval_info = RetrievalInfo(
        references={
            "environment": Reference(id=environment_id, slug="production"),
            "environment_variant": Reference(id=environment_variant_id),
            "environment_revision": Reference(id=environment_revision_id, version="7"),
        },
    )

    environments_service = AsyncMock()
    environments_service.retrieve_environment_revision.return_value = (
        environment_revision,
        None,
        environment_retrieval_info,
    )

    service = WorkflowsService(
        workflows_dao=workflows_dao,
        environments_service=environments_service,
    )

    revision, _, retrieval_info = await service.retrieve_workflow_revision(
        project_id=uuid4(),
        environment_ref=Reference(slug="production"),
        key="demo.revision",
    )

    assert revision is not None
    assert revision.id == revision_id
    assert retrieval_info is not None
    # Both environment refs AND the resolved target refs are present.
    assert retrieval_info.references["environment"].id == environment_id
    assert (
        retrieval_info.references["environment_revision"].id == environment_revision_id
    )
    assert retrieval_info.references["workflow_revision"].id == revision_id
    assert retrieval_info.selector == {"key": "demo.revision"}


@pytest.mark.asyncio
async def test_retrieve_workflow_revision_env_backed_missing_key_returns_none():
    environment_revision_id = uuid4()

    environment_revision = EnvironmentRevision(
        id=environment_revision_id,
        environment_id=uuid4(),
        environment_variant_id=uuid4(),
        slug="env-rev",
        version="1",
        data=EnvironmentRevisionData(references={"other.revision": {}}),
    )
    environments_service = AsyncMock()
    environments_service.retrieve_environment_revision.return_value = (
        environment_revision,
        None,
        RetrievalInfo(references={}),
    )

    service = WorkflowsService(
        workflows_dao=AsyncMock(),
        environments_service=environments_service,
    )

    (
        revision,
        resolution_info,
        retrieval_info,
    ) = await service.retrieve_workflow_revision(
        project_id=uuid4(),
        environment_ref=Reference(slug="production"),
        key="demo.revision",
    )

    assert revision is None
    assert resolution_info is None
    assert retrieval_info is None


@pytest.mark.asyncio
async def test_retrieve_workflow_revision_with_resolve_returns_resolution_info():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    workflows_dao = AsyncMock()
    workflows_dao.fetch_revision.return_value = _make_workflow_revision(
        artifact_id=artifact_id,
        variant_id=variant_id,
        revision_id=revision_id,
    )
    workflows_dao.fetch_artifact.return_value = _make_workflow(artifact_id=artifact_id)

    embeds_service = AsyncMock()
    embeds_service.resolve_configuration.return_value = (
        {"url": "https://example.test/run"},
        ResolutionInfo(
            references_used=[],
            depth_reached=0,
            embeds_resolved=0,
            errors=[],
        ),
    )

    service = WorkflowsService(
        workflows_dao=workflows_dao,
        embeds_service=embeds_service,
    )

    (
        revision,
        resolution_info,
        retrieval_info,
    ) = await service.retrieve_workflow_revision(
        project_id=uuid4(),
        workflow_variant_ref=Reference(id=variant_id),
        resolve=True,
    )

    assert revision is not None
    assert resolution_info is not None
    assert resolution_info.depth_reached == 0
    assert retrieval_info is not None
    assert retrieval_info.references["workflow_revision"].id == revision_id
