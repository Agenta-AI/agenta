"""Unit tests for evaluators service retrieve/resolve and RetrievalInfo emission."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.embeds.dtos import ResolutionInfo
from oss.src.core.environments.dtos import EnvironmentRevision, EnvironmentRevisionData
from oss.src.core.evaluators.dtos import (
    EvaluatorRevision,
    EvaluatorRevisionData,
)
from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.core.git.dtos import RetrievalInfo
from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowRevision


def _make_evaluator_revision(*, artifact_id, variant_id, revision_id):
    return EvaluatorRevision(
        id=revision_id,
        evaluator_id=artifact_id,
        evaluator_variant_id=variant_id,
        slug="eval-rev",
        version="4",
    )


@pytest.mark.asyncio
async def test_retrieve_evaluator_revision_direct_builds_retrieval_info():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    evaluator_revision = _make_evaluator_revision(
        artifact_id=artifact_id,
        variant_id=variant_id,
        revision_id=revision_id,
    )

    workflows_service = AsyncMock()
    workflows_service.fetch_workflow_revision.return_value = WorkflowRevision(
        **evaluator_revision.model_dump(mode="json"),
    )

    service = EvaluatorsService(workflows_service=workflows_service)

    (
        revision,
        resolution_info,
        retrieval_info,
    ) = await service.retrieve_evaluator_revision(
        project_id=uuid4(),
        evaluator_variant_ref=Reference(id=variant_id),
    )

    assert revision is not None
    assert revision.id == revision_id
    assert resolution_info is None
    assert retrieval_info is not None
    assert retrieval_info.references["evaluator"].id == artifact_id
    assert retrieval_info.references["evaluator_variant"].id == variant_id
    assert retrieval_info.references["evaluator_revision"].id == revision_id
    assert retrieval_info.selector is None


@pytest.mark.asyncio
async def test_retrieve_evaluator_revision_env_backed_merges_env_references():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()
    environment_id = uuid4()
    environment_variant_id = uuid4()
    environment_revision_id = uuid4()

    evaluator_revision = _make_evaluator_revision(
        artifact_id=artifact_id,
        variant_id=variant_id,
        revision_id=revision_id,
    )

    environment_revision = EnvironmentRevision(
        id=environment_revision_id,
        environment_id=environment_id,
        environment_variant_id=environment_variant_id,
        slug="env-rev",
        version="2",
        data=EnvironmentRevisionData(
            references={
                "eval-suite.revision": {
                    "evaluator": Reference(id=artifact_id, slug="acc"),
                    "evaluator_variant": Reference(id=variant_id),
                    "evaluator_revision": Reference(id=revision_id, version="4"),
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
                    version="2",
                ),
            },
        ),
    )

    workflows_service = AsyncMock()
    workflows_service.environments_service = environments_service
    workflows_service.fetch_workflow_revision.return_value = WorkflowRevision(
        **evaluator_revision.model_dump(mode="json"),
    )

    service = EvaluatorsService(workflows_service=workflows_service)

    revision, _, retrieval_info = await service.retrieve_evaluator_revision(
        project_id=uuid4(),
        environment_ref=Reference(slug="production"),
        key="eval-suite.revision",
    )

    assert revision is not None
    assert revision.id == revision_id
    assert retrieval_info is not None
    assert retrieval_info.references["environment"].id == environment_id
    assert retrieval_info.references["evaluator_revision"].id == revision_id
    assert retrieval_info.selector == {"key": "eval-suite.revision"}


@pytest.mark.asyncio
async def test_retrieve_evaluator_revision_env_backed_missing_key_returns_none():
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

    service = EvaluatorsService(workflows_service=workflows_service)

    (
        revision,
        resolution_info,
        retrieval_info,
    ) = await service.retrieve_evaluator_revision(
        project_id=uuid4(),
        environment_ref=Reference(slug="production"),
        key="eval-suite.revision",
    )

    assert revision is None
    assert resolution_info is None
    assert retrieval_info is None


@pytest.mark.asyncio
async def test_resolve_evaluator_revision_returns_resolution_info():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    evaluator_revision = EvaluatorRevision(
        id=revision_id,
        evaluator_id=artifact_id,
        evaluator_variant_id=variant_id,
        slug="eval-rev",
        version="4",
        data=EvaluatorRevisionData(url="https://example.test/eval"),
    )

    workflows_service = AsyncMock()
    workflows_service.fetch_workflow_revision.return_value = WorkflowRevision(
        **evaluator_revision.model_dump(mode="json"),
    )

    service = EvaluatorsService(workflows_service=workflows_service)
    embeds_service = AsyncMock()
    embeds_service.resolve_configuration.return_value = (
        {"url": "https://example.test/eval"},
        ResolutionInfo(
            references_used=[],
            depth_reached=0,
            embeds_resolved=0,
            errors=[],
        ),
    )
    service.embeds_service = embeds_service

    result = await service.resolve_evaluator_revision(
        project_id=uuid4(),
        evaluator_variant_ref=Reference(id=variant_id),
    )

    assert result is not None
    revision, resolution_info = result
    assert revision is not None
    assert resolution_info.depth_reached == 0
