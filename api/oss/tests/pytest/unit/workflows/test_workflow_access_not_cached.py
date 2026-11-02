"""The artifact cache never holds an agent's access policy: a sharing write does not
clear that namespace, so a cached policy would go stale. List queries read the policy
in their own statement; direct reads leave it unset."""

from unittest.mock import MagicMock
from uuid import uuid4

import oss.src.core.workflows.service as workflows_service_module
from oss.src.core.sharing.dtos import AccessPolicy, Visibility
from oss.src.core.workflows.dtos import Workflow
from oss.src.core.workflows.service import WorkflowsService
from oss.tests.pytest.utils.cache import FakeCache


async def test_artifact_cache_drops_the_access_policy(monkeypatch):
    FakeCache().install(monkeypatch, workflows_service_module)
    service = WorkflowsService(workflows_dao=MagicMock())
    project_id, workflow_id = uuid4(), uuid4()
    workflow = Workflow(
        id=workflow_id,
        slug="agent",
        access=AccessPolicy(visibility=Visibility.PRIVATE, owner_user_id=uuid4()),
    )

    await service._refresh_workflow_cache(project_id=project_id, workflow=workflow)
    cached = await service._get_cached_workflow(
        project_id=project_id, artifact_id=workflow_id
    )

    assert cached is not None and cached.id == workflow_id
    assert cached.access is None
    # The caller's object keeps its policy.
    assert workflow.access is not None
