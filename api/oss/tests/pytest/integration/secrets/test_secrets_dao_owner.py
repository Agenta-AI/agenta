"""The owner-based secrets DAO, `load_effective` and the organization operations, on the
deployment's Postgres (M5, Task 3)."""

import traceback
from uuid import uuid4

import pytest
from sqlalchemy import text

from oss.src.core.secrets.context import set_data_encryption_key
from oss.src.core.secrets.dtos import CreateSecretDTO, SecretOwner, UpdateSecretDTO
from oss.src.core.secrets.enums import SecretAvailability, SecretOwnerKind
from oss.src.core.secrets.types import (
    ProjectNotInOrganization,
    SecretSlugConflict,
    SecretStorageError,
)
from oss.src.dbs.postgres.secrets.dao import SecretsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    seed_organization,
)
from oss.tests.pytest.utils.organization_secrets import SENTINEL_KEY, org_secret_payload
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration


def _project(project_id):
    return SecretOwner(kind=SecretOwnerKind.PROJECT, id=project_id)


def _organization(organization_id):
    return SecretOwner(kind=SecretOwnerKind.ORGANIZATION, id=organization_id)


def _create(**kwargs) -> CreateSecretDTO:
    return CreateSecretDTO.model_validate(org_secret_payload(**kwargs))


@pytest.fixture(autouse=True)
def _key():
    with set_data_encryption_key(data_encryption_key=env.agenta.crypt_key):
        yield


@pytest.fixture
async def org():
    seeded = await seed_organization(
        members={"owner": "owner"}, projects_per_workspace=2
    )
    other = await seed_organization(members={"owner": "owner"})
    yield seeded, other
    await delete_seeded_organization(seeded)
    await delete_seeded_organization(other)


async def _rows(sql, params):
    async with get_transactions_engine().session() as session:
        return (await session.execute(text(sql), params)).all()


async def test_crud_by_owner_for_project_and_organization(org):
    seeded, _ = org
    dao = SecretsDAO()
    project_id = seeded.project_ids[0]
    for owner in (_project(project_id), _organization(seeded.organization_id)):
        created = await dao.create(
            owner=owner, create_secret_dto=_create(slug=f"s-{uuid4().hex[:8]}")
        )
        assert created.owner == owner
        assert (await dao.get_by_id(owner=owner, secret_id=created.id)).id == created.id
        assert (
            await dao.get_by_slug(owner=owner, secret_slug=created.slug)
        ).id == created.id
        assert [s.id for s in await dao.list(owner=owner)] == [created.id]
        updated = await dao.update(
            owner=owner,
            secret_id=created.id,
            update_secret_dto=UpdateSecretDTO.model_validate({"header": {"name": "x"}}),
        )
        assert updated.header.name == "x"
        await dao.delete(owner=owner, secret_id=created.id)
        assert await dao.get_by_id(owner=owner, secret_id=created.id) is None

    # A project owner never reads an organization row and the other way round.
    organization_row = await dao.create(
        owner=_organization(seeded.organization_id), create_secret_dto=_create()
    )
    assert (
        await dao.get_by_id(owner=_project(project_id), secret_id=organization_row.id)
        is None
    )


async def test_user_owner_is_refused_in_m5(org):
    with pytest.raises(ValueError):
        await SecretsDAO().list(
            owner=SecretOwner(kind=SecretOwnerKind.USER, id=uuid4())
        )


async def test_load_effective_is_one_statement(org):
    seeded, _ = org
    dao = SecretsDAO()
    project_id = seeded.project_ids[0]

    with count_statements(get_transactions_engine()) as statements:
        empty = await dao.load_effective(project_id=project_id)
    assert len(statements) == 1
    assert empty.organization_id == seeded.organization_id
    assert empty.secrets == [] and empty.organization == []

    own = await dao.create(owner=_project(project_id), create_secret_dto=_create())
    shared = await dao.create(
        owner=_organization(seeded.organization_id),
        create_secret_dto=_create(slug=f"org-{uuid4().hex[:8]}"),
        availability=SecretAvailability.ALL_PROJECTS,
        project_ids=[],
        user_id=seeded.owner_id,
    )
    with count_statements(get_transactions_engine()) as statements:
        entry = await dao.load_effective(project_id=project_id)
    assert len(statements) == 1
    assert [s.id for s in entry.secrets] == [own.id]
    assert [s.id for s in entry.organization] == [shared.id]
    assert entry.organization[0].selected_project_ids is None

    unknown = uuid4()
    with count_statements(get_transactions_engine()) as statements:
        missing = await dao.load_effective(project_id=unknown)
    assert len(statements) == 1
    assert missing.project_id == unknown and missing.organization_id is None


async def test_load_effective_applies_availability_and_excludes_sso(org):
    seeded, other = org
    dao = SecretsDAO()
    sales, marketing = seeded.project_ids
    limited = await dao.create(
        owner=_organization(seeded.organization_id),
        create_secret_dto=_create(slug=f"lim-{uuid4().hex[:8]}"),
        availability=SecretAvailability.SELECTED_PROJECTS,
        project_ids=[sales],
        user_id=seeded.owner_id,
    )
    nobody = await dao.create(
        owner=_organization(seeded.organization_id),
        create_secret_dto=_create(slug=f"none-{uuid4().hex[:8]}"),
        availability=SecretAvailability.SELECTED_PROJECTS,
        project_ids=[],
        user_id=seeded.owner_id,
    )
    sso = await dao.create(
        owner=_organization(seeded.organization_id),
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"name": "SSO"},
                "secret": {
                    "kind": "sso_provider",
                    "data": {
                        "provider": {
                            "client_id": "id",
                            "client_secret": SENTINEL_KEY,
                            "issuer_url": "https://idp.example.com",
                            "scopes": ["openid"],
                        }
                    },
                },
            }
        ),
    )
    foreign = await dao.create(
        owner=_organization(other.organization_id),
        create_secret_dto=_create(slug=f"for-{uuid4().hex[:8]}"),
        availability=SecretAvailability.ALL_PROJECTS,
        project_ids=[],
        user_id=other.owner_id,
    )

    sales_entry = await dao.load_effective(project_id=sales)
    marketing_entry = await dao.load_effective(project_id=marketing)

    assert {s.id for s in sales_entry.organization} == {limited.id}
    assert marketing_entry.organization == []
    for entry in (sales_entry, marketing_entry):
        ids = {s.id for s in entry.organization}
        assert sso.id not in ids and nobody.id not in ids and foreign.id not in ids


async def test_organization_operations_refuse_an_sso_id(org):
    seeded, _ = org
    dao = SecretsDAO()
    organization_id = seeded.organization_id
    sso = await dao.create(
        owner=_organization(organization_id),
        create_secret_dto=CreateSecretDTO.model_validate(
            {
                "header": {"name": "SSO"},
                "secret": {
                    "kind": "sso_provider",
                    "data": {
                        "provider": {
                            "client_id": "id",
                            "client_secret": SENTINEL_KEY,
                            "issuer_url": "https://idp.example.com",
                            "scopes": ["openid"],
                        }
                    },
                },
            }
        ),
    )
    before = await _rows(
        "SELECT data, name FROM secrets WHERE id = :id", {"id": sso.id}
    )

    assert (
        await dao.get_by_id(
            owner=_organization(organization_id), secret_id=sso.id, shareable=True
        )
        is None
    )
    assert sso.id not in {
        s.id
        for s in await dao.list(owner=_organization(organization_id), shareable=True)
    }
    assert (
        await dao.update(
            owner=_organization(organization_id),
            secret_id=sso.id,
            update_secret_dto=UpdateSecretDTO.model_validate({"header": {"name": "x"}}),
            user_id=seeded.owner_id,
            resolve_update=lambda stored, update: update,
            shareable=True,
        )
        is None
    )
    assert (
        await dao.set_availability(
            owner=_organization(organization_id),
            secret_id=sso.id,
            availability=SecretAvailability.SELECTED_PROJECTS,
            project_ids=[],
            user_id=seeded.owner_id,
        )
        is None
    )
    assert (
        await dao.delete(
            owner=_organization(organization_id), secret_id=sso.id, shareable=True
        )
        is None
    )
    after = await _rows(
        "SELECT data, name FROM secrets WHERE id = :id AND availability = 'all_projects'",
        {"id": sso.id},
    )
    assert after == before


async def test_create_with_a_foreign_project_leaves_no_row(org):
    seeded, other = org
    slug = f"foreign-{uuid4().hex[:8]}"
    with pytest.raises(ProjectNotInOrganization):
        await SecretsDAO().create(
            owner=_organization(seeded.organization_id),
            create_secret_dto=_create(slug=slug),
            availability=SecretAvailability.SELECTED_PROJECTS,
            project_ids=[seeded.project_ids[0], other.project_ids[0]],
            user_id=seeded.owner_id,
        )
    assert await _rows("SELECT 1 FROM secrets WHERE slug = :s", {"s": slug}) == []


async def test_create_failing_after_the_insert_leaves_no_row(org, monkeypatch):
    seeded, _ = org
    slug = f"fail-{uuid4().hex[:8]}"

    async def boom(self, connection, **kwargs):
        raise RuntimeError("forced failure after the insert")

    monkeypatch.setattr(SecretsDAO, "_write_selected_projects", boom)
    with pytest.raises(RuntimeError):
        await SecretsDAO().create(
            owner=_organization(seeded.organization_id),
            create_secret_dto=_create(slug=slug),
            availability=SecretAvailability.SELECTED_PROJECTS,
            project_ids=[seeded.project_ids[0]],
            user_id=seeded.owner_id,
        )
    assert await _rows("SELECT 1 FROM secrets WHERE slug = :s", {"s": slug}) == []


async def test_concurrent_reader_never_sees_a_limited_row_before_its_limit(
    org, monkeypatch
):
    seeded, _ = org
    sales, marketing = seeded.project_ids
    slug = f"race-{uuid4().hex[:8]}"
    seen = {}
    original = SecretsDAO._write_selected_projects

    async def read_in_between(self, connection, **kwargs):
        # A second connection reads while the insert is not committed yet.
        seen["marketing"] = await SecretsDAO().load_effective(project_id=marketing)
        seen["sales"] = await SecretsDAO().load_effective(project_id=sales)
        return await original(self, connection, **kwargs)

    monkeypatch.setattr(SecretsDAO, "_write_selected_projects", read_in_between)
    created = await SecretsDAO().create(
        owner=_organization(seeded.organization_id),
        create_secret_dto=_create(slug=slug),
        availability=SecretAvailability.SELECTED_PROJECTS,
        project_ids=[sales],
        user_id=seeded.owner_id,
    )
    assert created.id not in {s.id for s in seen["marketing"].organization}
    assert created.id not in {s.id for s in seen["sales"].organization}
    after = await SecretsDAO().load_effective(project_id=marketing)
    assert created.id not in {s.id for s in after.organization}


async def test_duplicate_organization_slug_maps_to_secret_slug_conflict(org):
    seeded, _ = org
    dao = SecretsDAO()
    slug = f"dup-{uuid4().hex[:8]}"
    await dao.create(
        owner=_organization(seeded.organization_id),
        create_secret_dto=_create(slug=slug),
        availability=SecretAvailability.ALL_PROJECTS,
        project_ids=[],
        user_id=seeded.owner_id,
    )
    with pytest.raises(SecretSlugConflict):
        await dao.create(
            owner=_organization(seeded.organization_id),
            create_secret_dto=_create(slug=slug),
            availability=SecretAvailability.ALL_PROJECTS,
            project_ids=[],
            user_id=seeded.owner_id,
        )
    rows = await _rows(
        "SELECT 1 FROM secrets WHERE organization_id = :o AND slug = :s",
        {"o": seeded.organization_id, "s": slug},
    )
    assert len(rows) == 1


async def test_unexpected_db_error_is_raised_without_parameters(org):
    # An unknown project: the insert fails on the foreign key. The plaintext value is a
    # bind parameter of that statement.
    with pytest.raises(SecretStorageError) as excinfo:
        await SecretsDAO().create(
            owner=_project(uuid4()),
            create_secret_dto=_create(slug="explicit", key=SENTINEL_KEY),
        )
    error = excinfo.value
    assert error.__cause__ is None and error.__suppress_context__ is True
    rendered = "".join(
        traceback.format_exception(type(error), error, error.__traceback__)
    )
    for text_ in (str(error), repr(error), rendered):
        assert SENTINEL_KEY not in text_


async def test_kind_null_rows_are_skipped_by_the_effective_read(org):
    seeded, _ = org
    project_id = seeded.project_ids[0]
    async with get_transactions_engine().session() as session:
        await session.execute(
            text(
                "INSERT INTO secrets (id, project_id, data) VALUES "
                "(:id, :p, pgp_sym_encrypt('{}', :key))"
            ),
            {"id": uuid4(), "p": project_id, "key": env.agenta.crypt_key},
        )
    entry = await SecretsDAO().load_effective(project_id=project_id)
    assert entry.secrets == []
