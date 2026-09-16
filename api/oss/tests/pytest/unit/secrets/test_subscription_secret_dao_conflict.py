"""The database tie-breaker for concurrent subscription-connection creation."""

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from oss.src.core.secrets.dtos import CreateSecretDTO
from oss.src.core.secrets.types import SubscriptionProviderConflict
from oss.src.dbs.postgres.secrets.dao import SecretsDAO


class _ConflictingSession:
    def add(self, _dbe):
        pass

    async def commit(self):
        raise IntegrityError(
            "INSERT INTO secrets ...",
            {},
            Exception(
                "duplicate key value violates unique constraint "
                '"uq_secrets_project_id_slug"'
            ),
        )

    async def rollback(self):
        pass


class _ConflictingEngine:
    @asynccontextmanager
    async def session(self):
        session = _ConflictingSession()
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


@pytest.mark.anyio
async def test_concurrent_subscription_create_returns_domain_conflict(anyio_backend):
    assert anyio_backend == "asyncio"
    dao = SecretsDAO(engine=_ConflictingEngine())
    create = CreateSecretDTO.model_validate(
        {
            "slug": "chatgpt",
            "header": {"name": "ChatGPT"},
            "secret": {"kind": "subscription_provider", "data": {}},
        }
    )

    with pytest.raises(SubscriptionProviderConflict) as exc_info:
        await dao.create(
            project_id=uuid4(),
            organization_id=None,
            create_secret_dto=create,
        )

    assert exc_info.value.provider == "chatgpt"


@pytest.fixture
def anyio_backend():
    return "asyncio"
