"""`WorkflowsService` routes agent creation by the ownership policy: a declared agent
with an owner is created with its access row in one DAO call; anything else gets no
row. A committed agent revision passes its owner to `ensure_first_agent_access`."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import oss.src.core.workflows.service as service_module
from oss.src.core.git.dtos import Artifact, Revision
from oss.src.core.sharing.dtos import (
    OWNERLESS_PROJECT_POLICY,
    AccessPolicy,
    Visibility,
)
from oss.src.core.workflows.dtos import (
    WorkflowCreate,
    WorkflowFlags,
    WorkflowRevisionCommit,
    WorkflowRevisionFlags,
)
from oss.src.core.workflows.service import WorkflowsService


PROJECT = uuid4()
ALICE = uuid4()
PRIVATE = AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=ALICE)


@pytest.fixture
def invalidations(monkeypatch):
    calls = []

    async def record(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(service_module, "invalidate_sharing_caches", record)
    return calls


def _dao():
    dao = AsyncMock()
    dao.create_agent_artifact.side_effect = lambda **kw: Artifact(
        id=kw["artifact_id"] or uuid4(), slug=kw["artifact_create"].slug
    )
    dao.create_artifact.side_effect = lambda **kw: Artifact(
        id=kw["artifact_id"] or uuid4(), slug=kw["artifact_create"].slug
    )
    return dao


def _create(*, is_agent: bool, visibility=None) -> WorkflowCreate:
    return WorkflowCreate(
        slug=f"agent-{uuid4().hex[:8]}",
        flags=WorkflowFlags(is_agent=is_agent),
        visibility=visibility,
    )


async def test_declared_agent_with_an_owner_gets_its_row_in_the_create(invalidations):
    dao = _dao()

    workflow = await WorkflowsService(workflows_dao=dao).create_workflow(
        project_id=PROJECT,
        user_id=ALICE,
        workflow_create=_create(is_agent=True, visibility=Visibility.PROJECT),
        access=PRIVATE,
    )

    dao.create_artifact.assert_not_called()
    kwargs = dao.create_agent_artifact.call_args.kwargs
    assert kwargs["access"] == PRIVATE
    # The requested visibility is the route's input to the ownership rule, never an
    # artifact field.
    assert "visibility" not in kwargs["artifact_create"].model_dump()
    assert workflow.access == PRIVATE
    assert invalidations == [{"project_id": PROJECT, "artifact_ids": [workflow.id]}]


@pytest.mark.parametrize(
    "is_agent, access",
    [
        (False, PRIVATE),  # not declared an agent
        (True, OWNERLESS_PROJECT_POLICY),  # an API key, an installation, ...
        (True, None),  # an internal caller
    ],
)
async def test_anything_else_gets_no_row(invalidations, is_agent, access):
    dao = _dao()

    workflow = await WorkflowsService(workflows_dao=dao).create_workflow(
        project_id=PROJECT,
        user_id=ALICE,
        workflow_create=_create(is_agent=is_agent),
        access=access,
    )

    dao.create_agent_artifact.assert_not_called()
    dao.create_artifact.assert_called_once()
    assert workflow.access == OWNERLESS_PROJECT_POLICY
    assert invalidations == []


def _commit_dao(*, is_agent: bool, inserted: bool):
    artifact_id, variant_id, revision_id = uuid4(), uuid4(), uuid4()
    dao = AsyncMock()
    dao.fetch_artifact.return_value = None
    dao.commit_revision.return_value = Revision(
        id=revision_id,
        artifact_id=artifact_id,
        variant_id=variant_id,
        slug="r1",
        flags=WorkflowRevisionFlags(is_agent=is_agent).model_dump(),
    )
    dao.ensure_first_agent_access.return_value = inserted
    return dao, artifact_id, variant_id, revision_id


async def test_agent_commit_with_an_owner_ensures_the_first_row(invalidations):
    dao, artifact_id, variant_id, revision_id = _commit_dao(
        is_agent=True, inserted=True
    )

    await WorkflowsService(workflows_dao=dao).commit_workflow_revision(
        project_id=PROJECT,
        user_id=ALICE,
        workflow_revision_commit=WorkflowRevisionCommit(
            workflow_id=artifact_id, workflow_variant_id=variant_id, slug="r1"
        ),
        emit=False,
        first_agent_owner_user_id=ALICE,
    )

    dao.ensure_first_agent_access.assert_awaited_once_with(
        project_id=PROJECT,
        artifact_id=artifact_id,
        revision_id=revision_id,
        owner_user_id=ALICE,
    )
    assert invalidations == [{"project_id": PROJECT, "artifact_ids": [artifact_id]}]


@pytest.mark.parametrize(
    "is_agent, owner, inserted, ensures",
    [
        (True, None, True, False),  # no owner: no write
        (False, ALICE, True, False),  # not an agent revision
        (True, ALICE, False, True),  # a row exists: nothing to invalidate
    ],
)
async def test_commit_without_a_new_row_invalidates_nothing(
    invalidations, is_agent, owner, inserted, ensures
):
    dao, artifact_id, variant_id, _ = _commit_dao(is_agent=is_agent, inserted=inserted)

    await WorkflowsService(workflows_dao=dao).commit_workflow_revision(
        project_id=PROJECT,
        user_id=ALICE,
        workflow_revision_commit=WorkflowRevisionCommit(
            workflow_id=artifact_id, workflow_variant_id=variant_id, slug="r1"
        ),
        emit=False,
        first_agent_owner_user_id=owner,
    )

    assert dao.ensure_first_agent_access.await_count == (1 if ensures else 0)
    assert invalidations == []
