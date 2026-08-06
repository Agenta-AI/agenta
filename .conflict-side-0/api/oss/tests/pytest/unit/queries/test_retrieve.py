"""Unit tests for queries service retrieve and RetrievalInfo emission.

Queries do not get deployed to environments and have no embed-resolve step,
so the only retrieve path is the direct (multi-ref) one.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.queries.dtos import QueryRevision
from oss.src.core.queries.service import QueriesService
from oss.src.core.shared.dtos import Reference


def _make_revision(*, artifact_id, variant_id, revision_id):
    return QueryRevision(
        id=revision_id,
        query_id=artifact_id,
        query_variant_id=variant_id,
        slug="query-rev",
        version="2",
    )


@pytest.mark.asyncio
async def test_retrieve_query_revision_builds_retrieval_info():
    artifact_id = uuid4()
    variant_id = uuid4()
    revision_id = uuid4()

    queries_dao = AsyncMock()
    queries_dao.fetch_revision.return_value = _make_revision(
        artifact_id=artifact_id,
        variant_id=variant_id,
        revision_id=revision_id,
    )

    service = QueriesService(queries_dao=queries_dao)

    revision, retrieval_info = await service.retrieve_query_revision(
        project_id=uuid4(),
        query_variant_ref=Reference(id=variant_id),
    )

    assert revision is not None
    assert revision.id == revision_id
    assert retrieval_info is not None
    assert retrieval_info.references["query"].id == artifact_id
    assert retrieval_info.references["query_variant"].id == variant_id
    assert retrieval_info.references["query_revision"].id == revision_id
    assert retrieval_info.references["query_revision"].version == "2"
    assert retrieval_info.selector is None


@pytest.mark.asyncio
async def test_retrieve_query_revision_no_refs_returns_none():
    queries_dao = AsyncMock()
    service = QueriesService(queries_dao=queries_dao)

    revision, retrieval_info = await service.retrieve_query_revision(project_id=uuid4())

    assert revision is None
    assert retrieval_info is None
