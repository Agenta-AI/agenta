"""A slug collision on a subscription login is the generic slug conflict."""

from contextlib import asynccontextmanager
from uuid import uuid4

from oss.src.core.secrets.dtos import SecretOwner
from oss.src.core.secrets.enums import SecretOwnerKind

import pytest
from sqlalchemy.exc import IntegrityError

from oss.src.core.secrets.dtos import CreateSecretDTO
from oss.src.core.secrets.types import SecretSlugConflict
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

    with pytest.raises(SecretSlugConflict) as exc_info:
        await dao.create(
            owner=SecretOwner(kind=SecretOwnerKind.PROJECT, id=uuid4()),
            create_secret_dto=create,
        )

    assert "chatgpt" in exc_info.value.message


@pytest.fixture
def anyio_backend():
    return "asyncio"
