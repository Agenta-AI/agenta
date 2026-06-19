"""Unit tests for environments service retrieve/resolve and RetrievalInfo emission."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.embeds.dtos import ResolutionInfo
from oss.src.core.environments.dtos import (
    Environment,
    EnvironmentRevision,
    EnvironmentRevisionData,
    EnvironmentVariant,
)
from oss.src.core.environments.service import EnvironmentsService
from oss.src.core.shared.dtos import Reference


def _make_service(*, dao_revision=None, dao_artifact=None, dao_variant=None):
    dao = AsyncMock()
    dao.fetch_revision.return_value = dao_revision
    dao.fetch_artifact.return_value = dao_artifact
    dao.fetch_variant.return_value = dao_variant
    return EnvironmentsService(environments_dao=dao), dao


@pytest.mark.asyncio
async def test_retrieve_environment_revision_builds_retrieval_info():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    revision = EnvironmentRevision(
        id=revision_id,
        environment_id=artifact_id,
        environment_variant_id=variant_id,
        slug="env-rev",
        version="3",
    )
    service, _ = _make_service(dao_revision=revision)

    (
        environment_revision,
        resolution_info,
        retrieval_info,
    ) = await service.retrieve_environment_revision(
        project_id=uuid4(),
        environment_variant_ref=Reference(id=variant_id),
    )

    assert environment_revision is not None
    assert environment_revision.id == revision_id
    assert resolution_info is None
    assert retrieval_info is not None
    assert retrieval_info.references["environment"].id == artifact_id
    assert retrieval_info.references["environment_variant"].id == variant_id
    assert retrieval_info.references["environment_revision"].id == revision_id
    assert retrieval_info.references["environment_revision"].version == "3"
    assert retrieval_info.selector is None


@pytest.mark.asyncio
async def test_retrieve_environment_revision_with_no_refs_returns_none_triplet():
    service, _ = _make_service()
    result = await service.retrieve_environment_revision(project_id=uuid4())
    assert result == (None, None, None)


@pytest.mark.asyncio
async def test_retrieve_environment_revision_resolves_artifact_to_variant():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    revision = EnvironmentRevision(
        id=revision_id,
        environment_id=artifact_id,
        environment_variant_id=variant_id,
        slug="env-rev",
        version="1",
    )
    service, dao = _make_service(dao_revision=revision)
    service.fetch_environment = AsyncMock(
        return_value=Environment(id=artifact_id, slug="staging"),
    )
    service.fetch_environment_variant = AsyncMock(
        return_value=EnvironmentVariant(
            id=variant_id,
            slug="main",
            environment_id=artifact_id,
        ),
    )

    (
        environment_revision,
        _,
        retrieval_info,
    ) = await service.retrieve_environment_revision(
        project_id=uuid4(),
        environment_ref=Reference(slug="staging"),
    )

    assert environment_revision is not None
    assert retrieval_info is not None
    assert retrieval_info.references["environment"].id == artifact_id
    assert retrieval_info.references["environment_variant"].id == variant_id


@pytest.mark.asyncio
async def test_resolve_environment_revision_returns_resolution_info_and_retrieval_info():
    """resolve path: service returns resolution_info; router will compose retrieval_info."""
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    revision = EnvironmentRevision(
        id=revision_id,
        environment_id=artifact_id,
        environment_variant_id=variant_id,
        slug="env-rev",
        version="3",
        data=EnvironmentRevisionData(references={}),
    )
    service, _ = _make_service(dao_revision=revision)

    # Stub embeds_service.resolve_configuration to a no-op pass-through
    embeds_service = AsyncMock()
    embeds_service.resolve_configuration.return_value = (
        {"references": {}},
        ResolutionInfo(
            references_used=[],
            depth_reached=0,
            embeds_resolved=0,
            errors=[],
        ),
    )
    service.embeds_service = embeds_service

    (
        environment_revision,
        resolution_info,
        retrieval_info,
    ) = await service.retrieve_environment_revision(
        project_id=uuid4(),
        environment_variant_ref=Reference(id=variant_id),
        resolve=True,
    )

    assert environment_revision is not None
    assert resolution_info is not None
    assert resolution_info.depth_reached == 0
    assert retrieval_info is not None
    assert retrieval_info.references["environment_revision"].id == revision_id
