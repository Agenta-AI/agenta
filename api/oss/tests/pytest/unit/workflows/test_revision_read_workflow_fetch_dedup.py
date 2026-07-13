"""Pins the connection-pool-exhaustion invariant for revision-read fan-outs.

`_normalize_revision_for_read` resolves the owning workflow via `fetch_workflow`,
which on a cache miss opens its own DB session (`GitDAO.fetch_artifact`). Both
`query_workflow_revisions` and `log_workflow_revisions` fan out over a list of
revisions that can repeat the same `workflow_id`; calling `fetch_workflow` once per
revision (instead of once per distinct workflow_id) would reopen a connection per
row under a fanned-out query. These tests assert the CALL COUNT into
`workflows_dao.fetch_artifact`, not just the returned shape — a result-only test
would still pass with the bug present.
"""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.git.dtos import Artifact
from oss.src.core.workflows.dtos import WorkflowRevision
from oss.src.core.workflows.service import WorkflowsService


def _revision(*, workflow_id, version="1"):
    return WorkflowRevision(
        id=uuid4(),
        workflow_id=workflow_id,
        version=version,
        slug="v1",
    )


def _artifact(*, artifact_id):
    return Artifact(id=artifact_id, slug="wf")


@pytest.mark.asyncio
async def test_query_workflow_revisions_fetches_workflow_once_per_distinct_id():
    project_id = uuid4()
    workflow_id = uuid4()  # shared by all 4 revisions
    revisions = [_revision(workflow_id=workflow_id) for _ in range(4)]

    workflows_dao = AsyncMock()
    workflows_dao.query_revisions = AsyncMock(return_value=revisions)
    workflows_dao.fetch_artifact = AsyncMock(
        return_value=_artifact(artifact_id=workflow_id)
    )

    service = WorkflowsService(workflows_dao=workflows_dao)

    result = await service.query_workflow_revisions(project_id=project_id)

    assert len(result) == 4
    # 4 revisions, 1 distinct workflow_id -> exactly one DB fetch, not four.
    assert workflows_dao.fetch_artifact.await_count == 1


@pytest.mark.asyncio
async def test_query_workflow_revisions_dedups_across_distinct_workflow_ids():
    project_id = uuid4()
    workflow_id_a = uuid4()
    workflow_id_b = uuid4()
    revisions = [
        _revision(workflow_id=workflow_id_a),
        _revision(workflow_id=workflow_id_a),
        _revision(workflow_id=workflow_id_b),
    ]

    workflows_dao = AsyncMock()
    workflows_dao.query_revisions = AsyncMock(return_value=revisions)

    async def _fetch_artifact(*, project_id, artifact_ref, include_archived=True):
        return _artifact(artifact_id=artifact_ref.id)

    workflows_dao.fetch_artifact = AsyncMock(side_effect=_fetch_artifact)

    service = WorkflowsService(workflows_dao=workflows_dao)

    result = await service.query_workflow_revisions(project_id=project_id)

    assert len(result) == 3
    # 3 revisions, 2 distinct workflow_ids -> exactly two DB fetches, not three.
    assert workflows_dao.fetch_artifact.await_count == 2


@pytest.mark.asyncio
async def test_log_workflow_revisions_fetches_workflow_once_per_distinct_id():
    from oss.src.core.workflows.dtos import WorkflowRevisionsLog

    project_id = uuid4()
    workflow_id = uuid4()
    revisions = [_revision(workflow_id=workflow_id) for _ in range(5)]

    workflows_dao = AsyncMock()
    workflows_dao.log_revisions = AsyncMock(return_value=revisions)
    workflows_dao.fetch_artifact = AsyncMock(
        return_value=_artifact(artifact_id=workflow_id)
    )

    service = WorkflowsService(workflows_dao=workflows_dao)

    result = await service.log_workflow_revisions(
        project_id=project_id,
        workflow_revisions_log=WorkflowRevisionsLog(),
    )

    assert len(result) == 5
    # 5 revisions, 1 distinct workflow_id -> exactly one DB fetch, not five.
    assert workflows_dao.fetch_artifact.await_count == 1
