"""Unit tests for testsets service retrieve and RetrievalInfo emission.

Testsets do not get deployed to environments and have no embed-resolve step,
so the only retrieve path is the direct (multi-ref) one.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.shared.dtos import Reference
from oss.src.core.testsets.dtos import TestsetRevision as _TestsetRevision
from oss.src.core.testsets.service import TestsetsService as _TestsetsService


def _make_revision(*, artifact_id, variant_id, revision_id):
    return _TestsetRevision(
        id=revision_id,
        testset_id=artifact_id,
        testset_variant_id=variant_id,
        slug="testset-rev",
        version="5",
    )


@pytest.mark.asyncio
async def test_retrieve_testset_revision_builds_retrieval_info():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    testsets_dao = AsyncMock()
    testsets_dao.fetch_revision.return_value = _make_revision(
        artifact_id=artifact_id,
        variant_id=variant_id,
        revision_id=revision_id,
    )
    testcases_service = AsyncMock()

    service = _TestsetsService(
        testsets_dao=testsets_dao,
        testcases_service=testcases_service,
    )

    revision, retrieval_info = await service.retrieve_testset_revision(
        project_id=uuid4(),
        testset_variant_ref=Reference(id=variant_id),
    )

    assert revision is not None
    assert revision.id == revision_id
    assert retrieval_info is not None
    assert retrieval_info.references["testset"].id == artifact_id
    assert retrieval_info.references["testset_variant"].id == variant_id
    assert retrieval_info.references["testset_revision"].id == revision_id
    assert retrieval_info.references["testset_revision"].version == "5"
    assert retrieval_info.selector is None


@pytest.mark.asyncio
async def test_retrieve_testset_revision_no_refs_returns_none():
    testsets_dao = AsyncMock()
    testcases_service = AsyncMock()
    service = _TestsetsService(
        testsets_dao=testsets_dao,
        testcases_service=testcases_service,
    )

    revision, retrieval_info = await service.retrieve_testset_revision(
        project_id=uuid4()
    )

    assert revision is None
    assert retrieval_info is None
