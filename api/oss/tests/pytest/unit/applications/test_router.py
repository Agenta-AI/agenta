from types import SimpleNamespace
from uuid import uuid4

import pytest

from oss.src.apis.fastapi.applications import router as applications_router_module
from oss.src.apis.fastapi.applications.models import ApplicationRevisionDeployRequest
from oss.src.apis.fastapi.applications.router import ApplicationsRouter
from oss.src.core.applications.dtos import ApplicationRevision
from oss.src.core.environments.dtos import EnvironmentRevision
from oss.src.core.shared.dtos import Reference


@pytest.mark.asyncio
async def test_deploy_application_revision_uses_environment_retrieve(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    application_id = uuid4()
    application_variant_id = uuid4()
    application_revision_id = uuid4()
    environment_id = uuid4()
    environment_variant_id = uuid4()

    application_revision = ApplicationRevision(
        id=application_revision_id,
        slug="app-rev",
        version="2026-03-31",
        application_id=application_id,
        application_variant_id=application_variant_id,
    )
    environment_revision = EnvironmentRevision(
        id=uuid4(),
        environment_id=environment_id,
        environment_variant_id=environment_variant_id,
    )

    class DummyApplicationsService:
        async def fetch_application_revision(self, **kwargs):
            assert kwargs["project_id"] == project_id
            return application_revision

    class DummyEnvironmentsService:
        def __init__(self):
            self.retrieve_calls = []
            self.fetch_called = False
            self.commit_calls = []

        async def retrieve_environment_revision(self, **kwargs):
            self.retrieve_calls.append(kwargs)
            return environment_revision, None

        async def fetch_environment_revision(self, **kwargs):
            self.fetch_called = True
            raise AssertionError("fetch_environment_revision should not be used")

        async def commit_environment_revision(self, **kwargs):
            self.commit_calls.append(kwargs)

    environments_service = DummyEnvironmentsService()
    router = ApplicationsRouter(
        applications_service=DummyApplicationsService(),
        environments_service=environments_service,
    )

    async def _noop_ensure_environment_deploy_allowed(**kwargs):
        assert kwargs["project_id"] == project_id
        assert kwargs["user_id"] == user_id
        assert kwargs["environment_id"] == environment_id

    async def _noop_invalidate_cache(*, project_id):
        assert project_id == str(project_id_expected)

    project_id_expected = project_id
    monkeypatch.setattr(
        applications_router_module,
        "ensure_environment_deploy_allowed",
        _noop_ensure_environment_deploy_allowed,
    )
    monkeypatch.setattr(
        applications_router_module,
        "invalidate_cache",
        _noop_invalidate_cache,
    )

    request = SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(project_id),
            user_id=str(user_id),
        )
    )

    response = await router.deploy_application_revision(
        request,
        application_deploy_request=ApplicationRevisionDeployRequest(
            application_ref=Reference(id=application_id),
            environment_ref=Reference(id=environment_id),
            key="app.revision",
        ),
    )

    assert response.application_revision is not None
    assert response.application_revision.id == application_revision_id
    assert len(environments_service.retrieve_calls) == 1
    assert environments_service.fetch_called is False
    assert len(environments_service.commit_calls) == 1
