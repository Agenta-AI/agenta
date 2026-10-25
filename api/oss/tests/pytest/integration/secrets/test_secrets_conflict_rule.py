"""The shadow rule, checked in SQL against the database (M5, Task 3, P7).

Invariant: in no project of an organization do a project row and an AVAILABLE
organization row share a slug with another kind or provider family. Every write that can
create such a pair is refused, also against a warmed cache and under concurrency.
"""

import asyncio
from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.dtos import CreateSecretDTO, UpdateSecretDTO
from oss.src.core.secrets.enums import SecretAvailability
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.types import SecretShadowConflict, SecretWriteConflict
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


async def _org_row(seeded, slug, *, family="openai", availability=None, projects=()):
    return await SecretsDAO().create_organization_secret(
        organization_id=seeded.organization_id,
        create_secret_dto=_create(slug=slug, family=family),
        availability=availability or SecretAvailability.ALL_PROJECTS,
        project_ids=list(projects),
        user_id=seeded.owner_id,
    )


async def _pairs(seeded):
    """Projects of the organization holding a conflicting pair (must stay empty)."""
    async with get_transactions_engine().session() as session:
        rows = await session.execute(
            text(
                "SELECT p.id FROM secrets s JOIN projects p ON p.id = s.project_id "
                "JOIN secrets o ON o.project_id IS NULL "
                "AND o.organization_id = p.organization_id AND o.slug = s.slug "
                "WHERE p.organization_id = :org AND (o.availability = 'all_projects' OR "
                "EXISTS (SELECT 1 FROM secret_projects sp WHERE sp.secret_id = o.id "
                "AND sp.project_id = p.id)) AND (o.kind <> s.kind OR "
                "(o.kind = 'PROVIDER_KEY' AND "
                "pgp_sym_decrypt(o.data, :key)::jsonb->>'kind' IS DISTINCT FROM "
                "pgp_sym_decrypt(s.data, :key)::jsonb->>'kind'))"
            ),
            {"org": seeded.organization_id, "key": env.agenta.crypt_key},
        )
        return rows.all()


async def test_explicit_slug_project_create_with_another_kind_is_refused(org):
    slug = _slug()
    await _org_row(org, slug)
    vault = VaultService(SecretsDAO())
    with pytest.raises(SecretShadowConflict):
        await vault.create_secret(
            project_id=org.project_ids[0], create_secret_dto=_custom_secret(slug)
        )
    with pytest.raises(SecretShadowConflict):
        await vault.create_secret(
            project_id=org.project_ids[0],
            create_secret_dto=_create(slug=slug, family="anthropic"),
        )
    # The same kind and family overrides it.
    override = await vault.create_secret(
        project_id=org.project_ids[0], create_secret_dto=_create(slug=slug)
    )
    assert override.slug == slug
    assert await _pairs(org) == []


async def test_override_kind_change_is_refused(org):
    slug = _slug()
    await _org_row(org, slug)
    vault = VaultService(SecretsDAO())
    override = await vault.create_secret(
        project_id=org.project_ids[0], create_secret_dto=_create(slug=slug)
    )
    # The organization row is hidden by the override in the effective view; the check
    # still reads it.
    with pytest.raises(SecretShadowConflict):
        await vault.update_secret(
            secret_id=override.id,
            project_id=org.project_ids[0],
            update_secret_dto=UpdateSecretDTO.model_validate(
                {
                    "secret": {
                        "kind": "custom_provider",
                        "data": {
                            "kind": "custom",
                            "provider": {
                                "url": "https://llm.example.com/v1",
                                "key": "sk-new-123456",
                            },
                            "models": [{"slug": "m"}],
                        },
                    }
                }
            ),
        )
    assert await _pairs(org) == []


async def test_override_family_change_is_refused(org):
    slug = _slug()
    await _org_row(org, slug)
    vault = VaultService(SecretsDAO())
    override = await vault.create_secret(
        project_id=org.project_ids[0], create_secret_dto=_create(slug=slug)
    )
    with pytest.raises(SecretShadowConflict):
        await vault.update_secret(
            secret_id=override.id,
            project_id=org.project_ids[0],
            update_secret_dto=UpdateSecretDTO.model_validate(
                {
                    "secret": {
                        "kind": "provider_key",
                        "data": {
                            "kind": "anthropic",
                            "provider": {"key": "sk-ant-123456"},
                        },
                    }
                }
            ),
        )
    # A rename keeps the identity and passes.
    renamed = await vault.update_secret(
        secret_id=override.id,
        project_id=org.project_ids[0],
        update_secret_dto=UpdateSecretDTO.model_validate({"header": {"name": "Mine"}}),
    )
    assert renamed.header.name == "Mine"
    assert await _pairs(org) == []


async def test_organization_create_over_an_existing_project_slug_is_refused(org):
    slug = _slug()
    vault = VaultService(SecretsDAO())
    await vault.create_secret(
        project_id=org.project_ids[1], create_secret_dto=_custom_secret(slug)
    )
    with pytest.raises(SecretShadowConflict):
        await _org_row(org, slug)
    # Limited to the other project, it does not meet the project row.
    await _org_row(
        org,
        slug,
        availability=SecretAvailability.SELECTED_PROJECTS,
        projects=[org.project_ids[0]],
    )
    assert await _pairs(org) == []


async def test_availability_widening_to_a_conflicting_project_is_refused(org):
    slug = _slug()
    sales, marketing = org.project_ids
    limited = await _org_row(
        org, slug, availability=SecretAvailability.SELECTED_PROJECTS, projects=[sales]
    )
    await VaultService(SecretsDAO()).create_secret(
        project_id=marketing, create_secret_dto=_custom_secret(slug)
    )
    dao = SecretsDAO()
    for availability, projects in (
        (SecretAvailability.ALL_PROJECTS, []),
        (SecretAvailability.SELECTED_PROJECTS, [sales, marketing]),
    ):
        with pytest.raises(SecretShadowConflict):
            await dao.set_organization_secret_availability(
                organization_id=org.organization_id,
                secret_id=limited.id,
                availability=availability,
                project_ids=projects,
                user_id=org.owner_id,
            )
    stored = await dao.fetch_organization_secret(
        organization_id=org.organization_id, secret_id=limited.id
    )
    assert stored.selected_project_ids == [sales]
    assert await _pairs(org) == []


async def test_stale_cache_does_not_let_a_conflict_pass(org):
    slug = _slug()
    vault = VaultService(SecretsDAO())
    # Warm the project's cached vault view before the organization write.
    await vault.list_secrets(project_id=org.project_ids[0])
    await _org_row(org, slug)
    with pytest.raises(SecretShadowConflict):
        await vault.create_secret(
            project_id=org.project_ids[0], create_secret_dto=_custom_secret(slug)
        )
    assert await _pairs(org) == []


async def test_concurrent_conflicting_writes_one_succeeds(org, monkeypatch):
    """The organization create checks first, waits, then inserts; the project create runs
    in that window. SERIALIZABLE aborts one (retried once), so the invariant holds."""
    original = SecretsDAO._check_organization_conflicts

    async def slow_check(self, connection, **kwargs):
        await original(self, connection, **kwargs)
        await asyncio.sleep(0.3)

    monkeypatch.setattr(SecretsDAO, "_check_organization_conflicts", slow_check)
    vault = VaultService(SecretsDAO())

    for _ in range(3):
        slug = _slug()

        async def project_write():
            await asyncio.sleep(0.1)
            return await vault.create_secret(
                project_id=org.project_ids[0], create_secret_dto=_custom_secret(slug)
            )

        results = await asyncio.gather(
            _org_row(org, slug), project_write(), return_exceptions=True
        )
        failures = [r for r in results if isinstance(r, Exception)]
        assert len(failures) == 1, results
        assert isinstance(failures[0], (SecretShadowConflict, SecretWriteConflict))
        assert await _pairs(org) == []


async def test_derived_slug_project_create_keeps_todays_statements(org):
    vault = VaultService(SecretsDAO())
    body = org_secret_payload(kind="custom_provider", family="custom")
    with count_statements(get_transactions_engine()) as statements:
        created = await vault.create_secret(
            project_id=org.project_ids[0],
            create_secret_dto=CreateSecretDTO.model_validate(body),
        )
    assert created.slug and len(created.slug.rsplit("-", 1)[-1]) == 12
    assert len(statements) == 1
    assert statements[0].lstrip().upper().startswith("INSERT INTO SECRETS")


async def test_managed_update_cannot_change_an_override_identity(org):
    from oss.src.core.secrets.managed import SecretManagementDTO, SecretManager

    slug = _slug()
    await _org_row(org, slug)
    vault = VaultService(SecretsDAO())
    manager = SecretManager.STARTER_CREDITS_BRIDGE
    managed = await vault.create_managed_secret(
        project_id=org.project_ids[0],
        create_secret_dto=_create(slug=slug),
        management=SecretManagementDTO(manager=manager),
    )
    with pytest.raises(SecretShadowConflict):
        await vault.update_managed_secret(
            secret_id=managed.id,
            project_id=org.project_ids[0],
            manager=manager,
            update_secret_dto=UpdateSecretDTO.model_validate(
                {
                    "secret": {
                        "kind": "provider_key",
                        "data": {
                            "kind": "anthropic",
                            "provider": {"key": "sk-ant-123456789"},
                        },
                    }
                }
            ),
        )
    assert await _pairs(org) == []


async def test_a_derived_slug_collision_is_refused_in_the_one_insert(org, monkeypatch):
    import oss.src.core.secrets.services as services_module

    slug = _slug()
    await _org_row(org, slug)
    monkeypatch.setattr(services_module, "get_slug_from_name_and_id", lambda *_: slug)
    vault = VaultService(SecretsDAO())
    body = CreateSecretDTO.model_validate(
        {
            "header": {"name": "token"},
            "secret": {
                "kind": "custom_secret",
                "data": {"secret": {"format": "text", "content": "value-123456"}},
            },
        }
    )
    with count_statements(get_transactions_engine()) as statements:
        with pytest.raises(SecretShadowConflict):
            await vault.create_secret(
                project_id=org.project_ids[0], create_secret_dto=body
            )
    assert len(statements) == 1
    assert await _pairs(org) == []


async def test_a_limited_organization_row_only_constrains_the_projects_it_reaches(org):
    """The shadow check of the user update reads availability per project: an
    organization row limited to Sales never blocks a Marketing row with its slug."""
    slug = _slug()
    sales, marketing = org.project_ids
    await _org_row(
        org, slug, availability=SecretAvailability.SELECTED_PROJECTS, projects=[sales]
    )
    vault = VaultService(SecretsDAO())
    mine = await vault.create_secret(
        project_id=marketing, create_secret_dto=_create(slug=slug, family="anthropic")
    )
    changed = await vault.update_secret(
        secret_id=mine.id,
        project_id=marketing,
        update_secret_dto=UpdateSecretDTO.model_validate(
            {
                "secret": {
                    "kind": "provider_key",
                    "data": {
                        "kind": "mistral",
                        "provider": {"key": "sk-mis-123456789"},
                    },
                }
            }
        ),
    )
    assert str(changed.data.kind.value) == "mistral"
    assert await _pairs(org) == []


async def _race(first, second):
    results = await asyncio.gather(first(), second(), return_exceptions=True)
    failures = [r for r in results if isinstance(r, Exception)]
    return results, failures


async def test_concurrent_override_kind_change_and_organization_create(
    org, monkeypatch
):
    """The project row changes its provider family while the organization creates a row
    with its slug: SERIALIZABLE keeps the pair from ever holding."""
    original = SecretsDAO._check_organization_conflicts

    async def slow_check(self, connection, **kwargs):
        await original(self, connection, **kwargs)
        await asyncio.sleep(0.3)

    monkeypatch.setattr(SecretsDAO, "_check_organization_conflicts", slow_check)
    vault = VaultService(SecretsDAO())
    for _ in range(3):
        slug = _slug()
        own = await vault.create_secret(
            project_id=org.project_ids[0], create_secret_dto=_create(slug=slug)
        )

        async def change_family():
            await asyncio.sleep(0.1)
            return await vault.update_secret(
                secret_id=own.id,
                project_id=org.project_ids[0],
                update_secret_dto=UpdateSecretDTO.model_validate(
                    {
                        "secret": {
                            "kind": "provider_key",
                            "data": {
                                "kind": "anthropic",
                                "provider": {"key": "sk-ant-123456789"},
                            },
                        }
                    }
                ),
            )

        _, failures = await _race(lambda: _org_row(org, slug), change_family)
        assert len(failures) == 1, failures
        assert isinstance(failures[0], (SecretShadowConflict, SecretWriteConflict))
        assert await _pairs(org) == []


async def test_concurrent_widening_and_project_create(org, monkeypatch):
    original = SecretsDAO._check_organization_conflicts

    async def slow_check(self, connection, **kwargs):
        await original(self, connection, **kwargs)
        await asyncio.sleep(0.3)

    sales, marketing = org.project_ids
    vault = VaultService(SecretsDAO())
    for _ in range(3):
        slug = _slug()
        limited = await _org_row(
            org,
            slug,
            availability=SecretAvailability.SELECTED_PROJECTS,
            projects=[sales],
        )
        monkeypatch.setattr(SecretsDAO, "_check_organization_conflicts", slow_check)

        async def widen():
            return await SecretsDAO().set_organization_secret_availability(
                organization_id=org.organization_id,
                secret_id=limited.id,
                availability=SecretAvailability.ALL_PROJECTS,
                project_ids=[],
                user_id=org.owner_id,
            )

        async def marketing_create():
            await asyncio.sleep(0.1)
            return await vault.create_secret(
                project_id=marketing, create_secret_dto=_custom_secret(slug)
            )

        _, failures = await _race(widen, marketing_create)
        monkeypatch.setattr(SecretsDAO, "_check_organization_conflicts", original)
        assert len(failures) == 1, failures
        assert isinstance(failures[0], (SecretShadowConflict, SecretWriteConflict))
        assert await _pairs(org) == []
