"""Two unnamed provider keys created at once must not land on the same display name.

`VaultService` names an unnamed connection after its provider ("OpenAI", then "OpenAI 2")
by reading the names already taken in the project. Reading and writing used to happen in
separate DAO sessions, so two concurrent creates both observed the same set and both
persisted "OpenAI" (#6015).
"""

import asyncio
import uuid

import pytest
from sqlalchemy import text

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretDTO,
    SecretKind,
    StandardProviderDTO,
    StandardProviderKind,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
import oss.src.dbs.postgres.shared.engine as engine_module
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
import oss.src.models.db_models  # noqa: F401


pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
async def _fresh_engine_per_test():
    # Dispose before dropping the reference, or the previous engine's pooled connections leak.
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
    engine_module._transactions_engine = None
    yield
    if engine_module._transactions_engine is not None:
        await engine_module._transactions_engine.close()
        engine_module._transactions_engine = None


@pytest.fixture
async def project_id():
    """A real project row: `secrets.project_id` is a foreign key."""
    engine = get_transactions_engine()
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()
    workspace_id = uuid.uuid4()
    project = uuid.uuid4()

    async with engine.session() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, uid, username, email) "
                "VALUES (:id, :uid, :username, :email)"
            ),
            {
                "id": user_id,
                "uid": str(user_id),
                "username": "vault-dao-test",
                "email": f"vault-dao-{user_id.hex[:8]}@example.com",
            },
        )
        await session.execute(
            text(
                "INSERT INTO organizations (id, name, owner_id) "
                "VALUES (:id, :name, :owner_id)"
            ),
            {
                "id": organization_id,
                "name": "vault-dao-test-org",
                "owner_id": user_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO workspaces (id, name, organization_id) "
                "VALUES (:id, :name, :organization_id)"
            ),
            {
                "id": workspace_id,
                "name": "vault-dao-test-workspace",
                "organization_id": organization_id,
            },
        )
        await session.execute(
            text(
                "INSERT INTO projects "
                "(id, project_name, workspace_id, organization_id) "
                "VALUES (:id, :project_name, :workspace_id, :organization_id)"
            ),
            {
                "id": project,
                "project_name": "vault-dao-test-project",
                "workspace_id": workspace_id,
                "organization_id": organization_id,
            },
        )
        await session.commit()

    return project


def _unnamed_openai_key() -> CreateSecretDTO:
    """An unnamed provider_key create — the payload the service has to name itself."""
    return CreateSecretDTO(
        # Header is required but carries no name: that is exactly the header-less
        # provider_key create the service has to name for itself.
        header={"name": None},
        secret=SecretDTO(
            kind=SecretKind.PROVIDER_KEY,
            data=StandardProviderDTO(
                kind=StandardProviderKind.OPENAI,
                provider=StandardProviderSettingsDTO(key=f"sk-{uuid.uuid4().hex}"),
            ),
        ),
    )


async def test_concurrent_unnamed_creates_get_distinct_names(project_id):
    service = VaultService(secrets_dao=SecretsDAO(engine=get_transactions_engine()))

    # Bounded: both calls contend for the same advisory lock on separate pooled
    # connections, so a regression here would hang the run instead of failing it.
    created = await asyncio.wait_for(
        asyncio.gather(
            service.create_secret(
                project_id=project_id,
                create_secret_dto=_unnamed_openai_key(),
            ),
            service.create_secret(
                project_id=project_id,
                create_secret_dto=_unnamed_openai_key(),
            ),
        ),
        timeout=30,
    )

    names = sorted(secret_dto.header.name for secret_dto in created)
    assert names == ["OpenAI", "OpenAI 2"], names
    # Slugs stay unique regardless — they are the identity — but assert it so a fix that
    # collapsed them while de-duplicating the names would still be caught.
    assert len({secret_dto.slug for secret_dto in created}) == 2


async def test_sequential_unnamed_creates_still_increment(project_id):
    """The lock must not change the ordinary one-at-a-time behaviour."""
    service = VaultService(secrets_dao=SecretsDAO(engine=get_transactions_engine()))

    first = await service.create_secret(
        project_id=project_id,
        create_secret_dto=_unnamed_openai_key(),
    )
    second = await service.create_secret(
        project_id=project_id,
        create_secret_dto=_unnamed_openai_key(),
    )

    assert first.header.name == "OpenAI"
    assert second.header.name == "OpenAI 2"
