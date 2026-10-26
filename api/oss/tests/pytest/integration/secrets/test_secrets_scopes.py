"""Project and organization connections are two slug spaces (M5).

A project row and an organization row may share a slug with any kind or family; neither
write checks the other. Project writes send the same statements as before M5, at the
default isolation level.
"""

from uuid import uuid4

import pytest

from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.dtos import CreateSecretDTO, UpdateSecretDTO
from oss.src.core.secrets.enums import SecretAvailability, SecretOwnerKind
from oss.src.core.secrets.services import VaultService
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    seed_organization,
)
from oss.tests.pytest.utils.organization_secrets import org_secret_payload
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration


def _create(**kwargs) -> CreateSecretDTO:
    return CreateSecretDTO.model_validate(org_secret_payload(**kwargs))


def _custom_secret(slug: str) -> CreateSecretDTO:
    return CreateSecretDTO.model_validate(
        {
            "slug": slug,
            "header": {"name": slug},
            "secret": {
                "kind": "custom_secret",
                "data": {"secret": {"format": "text", "content": "value-123456"}},
            },
        }
    )


@pytest.fixture(autouse=True)
def _key():
    with set_data_encryption_key(data_encryption_key=env.agenta.crypt_key):
        yield


@pytest.fixture
async def org():
    seeded = await seed_organization(
        members={"owner": "owner"}, projects_per_workspace=2
    )
    yield seeded
    await delete_seeded_organization(seeded)


def _slug():
    return f"company-{uuid4().hex[:8]}"


async def _org_row(seeded, slug, *, family="openai"):
    return await SecretsDAO().create_organization_secret(
        organization_id=seeded.organization_id,
        create_secret_dto=_create(slug=slug, family=family),
        availability=SecretAvailability.ALL_PROJECTS,
        project_ids=[],
        user_id=seeded.owner_id,
    )


async def test_one_slug_names_two_connections_of_any_kind(org):
    slug = _slug()
    company = await _org_row(org, slug)
    vault = VaultService(SecretsDAO())
    project = org.project_ids[0]
    secret = await vault.create_secret(
        project_id=project, create_secret_dto=_custom_secret(slug)
    )
    other_family = await vault.create_secret(
        project_id=org.project_ids[1],
        create_secret_dto=_create(slug=slug, family="anthropic"),
    )
    # A kind change of the project row is an ordinary update.
    updated = await vault.update_secret(
        secret_id=other_family.id,
        project_id=org.project_ids[1],
        update_secret_dto=UpdateSecretDTO.model_validate(
            {
                "secret": {
                    "kind": "provider_key",
                    "data": {"kind": "mistral", "provider": {"key": "sk-0123456789"}},
                }
            }
        ),
    )
    assert updated.data.kind.value == "mistral"
    # The organization row with the slug is still there, by scope `organization`.
    assert (
        await vault.get_organization_connection(
            organization_id=org.organization_id, project_id=project, slug=slug
        )
    ).id == company.id
    rows = await vault.list_secrets(project_id=project)
    assert [row.id for row in rows] == [secret.id]
    assert all(row.owner.kind == SecretOwnerKind.PROJECT for row in rows)


async def test_project_writes_send_todays_statements(org):
    """A derived-slug create is one insert, and a user update is the lock read, the update
    and the refresh, with a plain `BEGIN` (no serializable transaction)."""
    await _org_row(org, _slug())
    vault = VaultService(SecretsDAO())
    with count_statements(get_transactions_engine()) as created_statements:
        created = await vault.create_secret(
            project_id=org.project_ids[0],
            create_secret_dto=CreateSecretDTO.model_validate(
                org_secret_payload(kind="custom_provider", family="custom")
            ),
        )
    assert created.slug and len(created.slug.rsplit("-", 1)[-1]) == 12
    assert len(created_statements) == 1
    assert created_statements[0].lstrip().upper().startswith("INSERT INTO SECRETS")

    with count_statements(get_transactions_engine()) as updated_statements:
        await vault.update_secret(
            secret_id=created.id,
            project_id=org.project_ids[0],
            update_secret_dto=UpdateSecretDTO.model_validate(
                {"header": {"name": "Renamed"}}
            ),
        )
    assert len(updated_statements) == 3
    assert not any("SERIALIZABLE" in s.upper() for s in updated_statements)
