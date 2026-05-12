from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from oss.src.apis.fastapi.environments.models import (
    EnvironmentRevisionCommitRequest,
)
from oss.src.apis.fastapi.environments.router import EnvironmentsRouter
from oss.src.core.environments.dtos import (
    EnvironmentRevisionCommit,
    EnvironmentRevisionData,
    EnvironmentRevisionDelta,
)


class _DummyRequest:
    def __init__(self):
        self.state = SimpleNamespace(
            project_id=str(uuid4()),
            organization_id=str(uuid4()),
            user_id=str(uuid4()),
        )


def _patch_ee(monkeypatch):
    monkeypatch.setattr(
        "oss.src.apis.fastapi.environments.router.is_ee",
        lambda: False,
    )


@pytest.mark.asyncio
async def test_commit_environment_revision_rejects_missing_data_and_delta(monkeypatch):
    _patch_ee(monkeypatch)
    environments_service = MagicMock()
    environments_service.commit_environment_revision = AsyncMock()
    router = EnvironmentsRouter(environments_service=environments_service)

    ensure_allowed = AsyncMock()
    monkeypatch.setattr(
        "oss.src.apis.fastapi.environments.router.ensure_environment_deploy_allowed",
        ensure_allowed,
    )

    with pytest.raises(HTTPException) as exc_info:
        await router.commit_environment_revision(
            _DummyRequest(),
            environment_revision_commit_request=EnvironmentRevisionCommitRequest(
                environment_revision_commit=EnvironmentRevisionCommit(
                    slug="env-slug",
                    environment_id=uuid4(),
                )
            ),
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Provide either data or delta for a commit."
    ensure_allowed.assert_not_awaited()
    environments_service.commit_environment_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_commit_environment_revision_rejects_data_and_delta_together(monkeypatch):
    _patch_ee(monkeypatch)
    environments_service = MagicMock()
    environments_service.commit_environment_revision = AsyncMock()
    router = EnvironmentsRouter(environments_service=environments_service)

    ensure_allowed = AsyncMock()
    monkeypatch.setattr(
        "oss.src.apis.fastapi.environments.router.ensure_environment_deploy_allowed",
        ensure_allowed,
    )

    with pytest.raises(HTTPException) as exc_info:
        await router.commit_environment_revision(
            _DummyRequest(),
            environment_revision_commit_request=EnvironmentRevisionCommitRequest(
                environment_revision_commit=EnvironmentRevisionCommit(
                    slug="env-slug",
                    environment_id=uuid4(),
                    data=EnvironmentRevisionData(),
                    delta=EnvironmentRevisionDelta(),
                )
            ),
        )

    assert exc_info.value.status_code == 400
    assert (
        exc_info.value.detail == "Provide either data or delta for a commit, not both."
    )
    ensure_allowed.assert_not_awaited()
    environments_service.commit_environment_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_commit_environment_revision_accepts_delta_only(monkeypatch):
    _patch_ee(monkeypatch)
    environments_service = MagicMock()
    environments_service.commit_environment_revision = AsyncMock(return_value=None)
    router = EnvironmentsRouter(environments_service=environments_service)

    ensure_allowed = AsyncMock()
    monkeypatch.setattr(
        "oss.src.apis.fastapi.environments.router.ensure_environment_deploy_allowed",
        ensure_allowed,
    )

    response = await router.commit_environment_revision(
        _DummyRequest(),
        environment_revision_commit_request=EnvironmentRevisionCommitRequest(
            environment_revision_commit=EnvironmentRevisionCommit(
                slug="env-slug",
                environment_id=uuid4(),
                delta=EnvironmentRevisionDelta(),
            )
        ),
    )

    assert response.count == 0
    ensure_allowed.assert_awaited_once()
    environments_service.commit_environment_revision.assert_awaited_once()
