"""Unit tests for applications service retrieve/resolve and RetrievalInfo emission."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.applications.dtos import (
    ApplicationRevision,
    ApplicationRevisionData,
)
from oss.src.core.applications.service import ApplicationsService
from oss.src.core.embeds.dtos import ResolutionInfo
from oss.src.core.environments.dtos import EnvironmentRevision, EnvironmentRevisionData
from oss.src.core.git.dtos import RetrievalInfo
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowRevision


def _make_application_revision(*, artifact_id, variant_id, revision_id):
    return ApplicationRevision(
        id=revision_id,
        application_id=artifact_id,
        application_variant_id=variant_id,
        slug="app-rev",
        version="2",
    )


def _make_workflow_revision_for(application_revision: ApplicationRevision):
    return WorkflowRevision(
        **application_revision.model_dump(mode="json"),
    )


@pytest.mark.asyncio
async def test_retrieve_application_revision_direct_builds_retrieval_info():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    application_revision = _make_application_revision(
        artifact_id=artifact_id,
        variant_id=variant_id,
        revision_id=revision_id,
    )

    workflows_service = AsyncMock()
    workflows_service.fetch_workflow_revision.return_value = (
        _make_workflow_revision_for(application_revision)
    )

    service = ApplicationsService(workflows_service=workflows_service)

    (
        revision,
        resolution_info,
        retrieval_info,
    ) = await service.retrieve_application_revision(
        project_id=uuid4(),
        application_variant_ref=Reference(id=variant_id),
    )

    assert revision is not None
    assert revision.id == revision_id
    assert resolution_info is None
    assert retrieval_info is not None
    assert retrieval_info.references["application"].id == artifact_id
    assert retrieval_info.references["application_variant"].id == variant_id
    assert retrieval_info.references["application_revision"].id == revision_id
    assert retrieval_info.selector is None


@pytest.mark.asyncio
async def test_retrieve_application_revision_env_backed_merges_env_references():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    environment_id = uuid4()
    environment_variant_id = uuid4()
    environment_revision_id = uuid4()

    application_revision = _make_application_revision(
        artifact_id=artifact_id,
        variant_id=variant_id,
        revision_id=revision_id,
    )

    environment_revision = EnvironmentRevision(
        id=environment_revision_id,
        environment_id=environment_id,
        environment_variant_id=environment_variant_id,
        slug="env-rev",
        version="5",
        data=EnvironmentRevisionData(
            references={
                "demo-app.revision": {
                    "application": Reference(id=artifact_id, slug="demo-app"),
                    "application_variant": Reference(id=variant_id),
                    "application_revision": Reference(id=revision_id, version="2"),
                }
            },
        ),
    )

    environments_service = AsyncMock()
    environments_service.retrieve_environment_revision.return_value = (
        environment_revision,
        None,
        RetrievalInfo(
            references={
                "environment": Reference(id=environment_id, slug="production"),
                "environment_variant": Reference(id=environment_variant_id),
                "environment_revision": Reference(
                    id=environment_revision_id,
                    version="5",
                ),
            },
        ),
    )

    workflows_service = AsyncMock()
    workflows_service.environments_service = environments_service
    workflows_service.fetch_workflow_revision.return_value = (
        _make_workflow_revision_for(application_revision)
    )

    service = ApplicationsService(workflows_service=workflows_service)

    revision, _, retrieval_info = await service.retrieve_application_revision(
        project_id=uuid4(),
        environment_ref=Reference(slug="production"),
        key="demo-app.revision",
    )

    assert revision is not None
    assert revision.id == revision_id
    assert retrieval_info is not None
    assert retrieval_info.references["environment"].id == environment_id
    assert retrieval_info.references["application_revision"].id == revision_id
    assert retrieval_info.selector == {"key": "demo-app.revision"}


@pytest.mark.asyncio
async def test_retrieve_application_revision_env_backed_missing_key_returns_none():
    environment_revision = EnvironmentRevision(
        id=uuid4(),
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

    workflows_service = AsyncMock()
    workflows_service.environments_service = environments_service

    service = ApplicationsService(workflows_service=workflows_service)

    (
        revision,
        resolution_info,
        retrieval_info,
    ) = await service.retrieve_application_revision(
        project_id=uuid4(),
        environment_ref=Reference(slug="production"),
        key="demo-app.revision",
    )

    assert revision is None
    assert resolution_info is None
    assert retrieval_info is None


@pytest.mark.asyncio
async def test_resolve_application_revision_returns_resolution_info():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    application_revision = ApplicationRevision(
        id=revision_id,
        application_id=artifact_id,
        application_variant_id=variant_id,
        slug="app-rev",
        version="2",
        data=ApplicationRevisionData(url="https://example.test/run"),
    )

    workflows_service = AsyncMock()
    workflows_service.fetch_workflow_revision.return_value = WorkflowRevision(
        **application_revision.model_dump(mode="json")
    )

    service = ApplicationsService(workflows_service=workflows_service)
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
    service.embeds_service = embeds_service

    result = await service.resolve_application_revision(
        project_id=uuid4(),
        application_variant_ref=Reference(id=variant_id),
    )

    assert result is not None
    revision, resolution_info = result
    assert revision is not None
    assert resolution_info.depth_reached == 0
