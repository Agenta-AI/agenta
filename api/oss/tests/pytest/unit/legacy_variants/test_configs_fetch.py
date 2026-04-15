from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

import oss.src.apis.fastapi.legacy_variants.router as legacy_variants_router_module
from oss.src.apis.fastapi.legacy_variants.models import ReferenceRequestModel
from oss.src.apis.fastapi.legacy_variants.router import LegacyVariantsRouter
from oss.src.core.applications.dtos import (
    Application,
    ApplicationRevision,
    ApplicationRevisionData,
    ApplicationVariant,
)
from oss.src.core.environments.dtos import EnvironmentRevision
from oss.src.core.shared.dtos import Reference


def _request(project_id):
    return SimpleNamespace(
        state=SimpleNamespace(
            project_id=str(project_id),
            user_id=str(uuid4()),
        )
    )


@pytest.fixture(autouse=True)
def _allow_view_access(monkeypatch):
    if hasattr(legacy_variants_router_module, "check_action_access"):
        monkeypatch.setattr(
            legacy_variants_router_module,
            "check_action_access",
            AsyncMock(return_value=True),
        )


def _revision(application_id, variant_id, revision_id=None):
    return ApplicationRevision(
        id=revision_id or uuid4(),
        slug="revision-slug",
        version="3",
        application_id=application_id,
        application_variant_id=variant_id,
        data=ApplicationRevisionData(
            parameters={"temperature": 0.2},
            url="https://example.test/run",
        ),
        message="commit message",
    )


def _applications_service(application_id, variant_id, revision):
    service = AsyncMock()
    service.fetch_application.return_value = Application(
        id=application_id,
        slug="demo-app",
    )
    service.fetch_application_variant.return_value = ApplicationVariant(
        id=variant_id,
        slug="main",
        application_id=application_id,
    )
    service.retrieve_application_revision.return_value = (revision, None)
    return service


@pytest.mark.asyncio
async def test_configs_fetch_by_variant_ref():
    project_id = uuid4()
    application_id = uuid4()
    variant_id = uuid4()
    revision = _revision(application_id, variant_id)
    applications_service = _applications_service(application_id, variant_id, revision)

    router = LegacyVariantsRouter(
        applications_service=applications_service,
        environments_service=AsyncMock(),
    )

    response = await router.configs_fetch(
        _request(project_id),
        variant_ref=ReferenceRequestModel(slug="main", version=3),
        application_ref=ReferenceRequestModel(slug="demo-app"),
    )

    assert response.params == {"temperature": 0.2}
    assert response.url == "https://example.test/run"
    assert response.application_ref.slug == "demo-app"
    assert response.variant_ref.slug == "main"
    assert response.variant_ref.version == "3"

    retrieve_kwargs = (
        applications_service.retrieve_application_revision.await_args.kwargs
    )
    assert retrieve_kwargs["project_id"] == project_id
    assert retrieve_kwargs["application_ref"] == Reference(slug="demo-app")
    assert retrieve_kwargs["application_variant_ref"] == Reference(slug="main")
    assert retrieve_kwargs["application_revision_ref"] == Reference(version="3")
    assert retrieve_kwargs["resolve"] is True


@pytest.mark.asyncio
async def test_configs_fetch_variant_id_falls_back_from_revision_to_variant():
    project_id = uuid4()
    application_id = uuid4()
    variant_id = uuid4()
    revision = _revision(application_id, variant_id)
    applications_service = _applications_service(application_id, variant_id, revision)
    applications_service.retrieve_application_revision.side_effect = [
        (None, None),
        (revision, None),
    ]

    router = LegacyVariantsRouter(
        applications_service=applications_service,
        environments_service=AsyncMock(),
    )

    response = await router.configs_fetch(
        _request(project_id),
        variant_ref=ReferenceRequestModel(id=variant_id),
        application_ref=ReferenceRequestModel(slug="demo-app"),
    )

    assert response.params == {"temperature": 0.2}

    first_call = applications_service.retrieve_application_revision.await_args_list[
        0
    ].kwargs
    second_call = applications_service.retrieve_application_revision.await_args_list[
        1
    ].kwargs
    assert first_call["application_revision_ref"] == Reference(id=variant_id)
    assert second_call["application_variant_ref"] == Reference(id=variant_id)


@pytest.mark.asyncio
async def test_configs_fetch_by_environment_ref():
    project_id = uuid4()
    application_id = uuid4()
    variant_id = uuid4()
    revision = _revision(application_id, variant_id)
    environment_revision = EnvironmentRevision(
        id=uuid4(),
        slug="env-revision",
        version="2",
        environment_id=uuid4(),
        environment_variant_id=uuid4(),
        message="deployed",
    )
    applications_service = _applications_service(application_id, variant_id, revision)
    environments_service = AsyncMock()
    environments_service.retrieve_environment_revision.return_value = (
        environment_revision,
        None,
    )

    router = LegacyVariantsRouter(
        applications_service=applications_service,
        environments_service=environments_service,
    )

    response = await router.configs_fetch(
        _request(project_id),
        environment_ref=ReferenceRequestModel(slug="staging"),
        application_ref=ReferenceRequestModel(slug="demo-app"),
    )

    assert response.params == {"temperature": 0.2}
    assert response.environment_ref.slug == "staging"
    assert response.environment_ref.version == "2"
    assert response.environment_ref.id == environment_revision.id

    retrieve_kwargs = (
        applications_service.retrieve_application_revision.await_args.kwargs
    )
    assert retrieve_kwargs["environment_ref"] == Reference(slug="staging")
    assert retrieve_kwargs["key"] == "demo-app.revision"
    assert retrieve_kwargs["resolve"] is True


@pytest.mark.asyncio
async def test_configs_fetch_defaults_to_production_environment():
    project_id = uuid4()
    application_id = uuid4()
    variant_id = uuid4()
    revision = _revision(application_id, variant_id)
    applications_service = _applications_service(application_id, variant_id, revision)
    environments_service = AsyncMock()
    environments_service.retrieve_environment_revision.return_value = (None, None)

    router = LegacyVariantsRouter(
        applications_service=applications_service,
        environments_service=environments_service,
    )

    response = await router.configs_fetch(
        _request(project_id),
        application_ref=ReferenceRequestModel(slug="demo-app"),
    )

    assert response.params == {"temperature": 0.2}

    retrieve_kwargs = (
        applications_service.retrieve_application_revision.await_args.kwargs
    )
    assert retrieve_kwargs["environment_ref"] == Reference(slug="production")
    assert retrieve_kwargs["key"] == "demo-app.revision"


@pytest.mark.asyncio
async def test_configs_fetch_not_found_raises_404():
    project_id = uuid4()
    applications_service = AsyncMock()
    applications_service.retrieve_application_revision.return_value = (None, None)

    router = LegacyVariantsRouter(
        applications_service=applications_service,
        environments_service=AsyncMock(),
    )

    with pytest.raises(HTTPException) as exc:
        await router.configs_fetch(
            _request(project_id),
            variant_ref=ReferenceRequestModel(slug="missing"),
            application_ref=ReferenceRequestModel(slug="demo-app"),
        )

    assert exc.value.status_code == 404
    assert exc.value.detail == "Config not found."
