"""The effective set on one cache entry per project (M5, Task 4).

The REAL cache helpers run on a recording engine, so every Redis command of the entry
read is counted, lock and fill included. The DAO is in memory and counts its calls.
"""

from uuid import UUID, uuid4

import pytest

from oss.src.core.access.context import get_request_memo
from oss.src.core.secrets.dtos import CreateSecretDTO
from oss.src.core.secrets.enums import SecretAvailability, SecretOwnerKind
from oss.src.core.secrets.services import VaultService
from oss.src.utils import caching
from oss.src.utils.env import env
from oss.tests.pytest.utils.organization_secrets import (
    InMemorySecretsDAO,
    install_cache_engine,
    org_secret_payload,
)
from oss.tests.pytest.utils.principals import bearer_request_access


def _uuid_with_suffix(suffix: str) -> UUID:
    return UUID(uuid4().hex[:20] + suffix)


@pytest.fixture
def world(monkeypatch):
    engine = install_cache_engine(monkeypatch)
    organization_id = uuid4()
    sales, marketing = uuid4(), uuid4()
    dao = InMemorySecretsDAO(
        projects={sales: organization_id, marketing: organization_id}
    )
    vault = VaultService(dao)
    return dict(
        engine=engine,
        dao=dao,
        vault=vault,
        organization_id=organization_id,
        sales=sales,
        marketing=marketing,
    )


async def _org_key(
    w,
    *,
    slug="openai-company",
    availability=SecretAvailability.ALL_PROJECTS,
    projects=(),
):
    return await w["dao"].create_organization_secret(
        organization_id=w["organization_id"],
        create_secret_dto=CreateSecretDTO.model_validate(org_secret_payload(slug=slug)),
        availability=availability,
        project_ids=list(projects),
        user_id=uuid4(),
    )


def _loads(dao):
    return dao.calls.count("load_effective")


async def test_warm_read_is_one_get(world):
    await world["vault"].list_secrets(project_id=world["sales"])
    world["engine"].commands.clear()
    await world["vault"].list_secrets(project_id=world["sales"])
    assert world["engine"].commands == ["GET"]
    assert _loads(world["dao"]) == 1


async def test_cold_leader_is_get_setnx_one_statement_set_del(world):
    await world["vault"].list_secrets(project_id=world["sales"])
    assert world["engine"].commands == ["GET", "SET NX", "SET", "DEL"]
    assert _loads(world["dao"]) == 1


async def test_cold_follower_is_get_setnx_get(world, monkeypatch):
    vault, engine = world["vault"], world["engine"]
    await vault.list_secrets(project_id=world["sales"])  # fill once
    name = next(k for k in engine.store if ":effective_secrets:" in k)
    filled = engine.store.pop(name)
    engine.store["lock::" + name] = b"1"  # another worker leads

    async def leader_fills(*args, **kwargs):
        engine.store[name] = filled

    monkeypatch.setattr(caching, "_delay", leader_fills)
    engine.commands.clear()
    await vault.list_secrets(project_id=world["sales"])
    assert engine.commands == ["GET", "SET NX", "GET"]
    assert _loads(world["dao"]) == 1


async def test_cache_disabled_is_one_statement_and_no_redis(world, monkeypatch):
    monkeypatch.setattr(env.agenta.api.caching, "enabled", False)
    await world["vault"].list_secrets(project_id=world["sales"])
    assert world["engine"].commands == []
    assert _loads(world["dao"]) == 1


async def test_redis_failing_is_one_statement_and_no_raise(world):
    world["engine"].fail = True
    secrets = await world["vault"].list_secrets(project_id=world["sales"])
    assert secrets == []
    assert world["engine"].commands == ["GET", "SET"]
    assert _loads(world["dao"]) == 1


async def test_key_holds_the_full_project_uuid(world):
    await world["vault"].list_secrets(project_id=world["sales"])
    names = [k for k in world["engine"].store if ":effective_secrets:" in k]
    assert names == [
        caching._pack(
            namespace="effective_secrets",
            project_id=str(world["sales"]),
            key={"p": str(world["sales"])},
        )
    ]
    assert str(world["sales"]) in names[0]


async def test_identity_mismatch_is_a_miss(world):
    vault, engine = world["vault"], world["engine"]
    other = await vault._effective_entry(project_id=world["marketing"])
    name = caching._pack(
        namespace="effective_secrets",
        project_id=str(world["sales"]),
        key={"p": str(world["sales"])},
    )
    engine.store[name] = caching._serialize(other)  # an entry of another project
    loads = _loads(world["dao"])
    entry = await vault._effective_entry(project_id=world["sales"])
    assert entry.project_id == world["sales"]
    assert _loads(world["dao"]) == loads + 1


@pytest.mark.parametrize("same_organization", [True, False])
async def test_equal_suffix_projects_never_share_an_entry(
    monkeypatch, same_organization
):
    engine = install_cache_engine(monkeypatch)
    suffix = "abcdef123456"
    first, second = _uuid_with_suffix(suffix), _uuid_with_suffix(suffix)
    org_a = uuid4()
    org_b = org_a if same_organization else uuid4()
    dao = InMemorySecretsDAO(projects={first: org_a, second: org_b})
    vault = VaultService(dao)
    await vault.create_secret(
        project_id=first,
        create_secret_dto=CreateSecretDTO.model_validate(
            org_secret_payload(slug="only-first")
        ),
    )
    assert [s.slug for s in await vault.list_secrets(project_id=first)] == [
        "only-first"
    ]
    assert await vault.list_secrets(project_id=second) == []
    names = {k for k in engine.store if ":effective_secrets:" in k}
    assert len(names) == 2

    # Project-wide invalidation of one clears both (harmless over-invalidation).
    await caching.invalidate_cache(project_id=str(first))
    assert not any(":effective_secrets:" in k for k in engine.store)


async def test_project_wide_invalidation_still_clears_the_entry(world):
    await world["vault"].list_secrets(project_id=world["sales"])
    assert any(":effective_secrets:" in k for k in world["engine"].store)
    # As an old pod calls it after a project write.
    await caching.invalidate_cache(project_id=str(world["sales"]))
    assert not any(":effective_secrets:" in k for k in world["engine"].store)


async def test_empty_organization_costs_nothing_extra(world):
    entry = await world["vault"]._effective_entry(project_id=world["sales"])
    assert entry.inherited == []
    assert world["engine"].commands == ["GET", "SET NX", "SET", "DEL"]
    assert _loads(world["dao"]) == 1


async def test_second_read_in_the_same_request_uses_the_memo(world, monkeypatch):
    vault = world["vault"]
    await _org_key(world)
    user = uuid4()
    with bearer_request_access(user):
        await vault.list_secrets(project_id=world["sales"])
        world["engine"].commands.clear()
        await vault.list_effective_secrets(
            organization_id=world["organization_id"], project_id=world["sales"]
        )
        await vault.get_effective_secret_by_slug(
            organization_id=world["organization_id"],
            project_id=world["sales"],
            slug="openai-company",
        )
        assert world["engine"].commands == []
    assert _loads(world["dao"]) == 1

    monkeypatch.setattr(env.agenta.api.caching, "enabled", False)
    with bearer_request_access(user):
        await vault.list_secrets(project_id=world["marketing"])
        await vault.list_secrets(project_id=world["marketing"])
    assert _loads(world["dao"]) == 2


async def test_no_memo_outside_a_request(world):
    assert get_request_memo() is None
    await world["vault"].list_secrets(project_id=world["sales"])
    world["engine"].commands.clear()
    await world["vault"].list_secrets(project_id=world["sales"])
    assert world["engine"].commands == ["GET"]


async def test_organization_write_deletes_each_project_key_and_clears_the_memo(world):
    vault, engine = world["vault"], world["engine"]
    other_project = uuid4()
    world["dao"].projects[other_project] = uuid4()  # another organization
    with bearer_request_access(uuid4()):
        for project in (world["sales"], world["marketing"], other_project):
            await vault.list_secrets(project_id=project)
        engine.commands.clear()
        await vault._invalidate_organization(organization_id=world["organization_id"])
        assert get_request_memo() == {}
    assert engine.commands == ["DEL"]
    remaining = {k for k in engine.store if ":effective_secrets:" in k}
    assert remaining == {
        caching._pack(
            namespace="effective_secrets",
            project_id=str(other_project),
            key={"p": str(other_project)},
        )
    }


async def test_failed_invalidation_logs_and_does_not_raise(world, caplog, monkeypatch):
    async def broken(**kwargs):
        raise RuntimeError("database is down")

    monkeypatch.setattr(world["dao"], "list_organization_project_ids", broken)
    with caplog.at_level("WARNING"):
        await world["vault"]._invalidate_organization(
            organization_id=world["organization_id"]
        )
    assert any("cache invalidation failed" in r.getMessage() for r in caplog.records)


async def test_get_effective_by_id_project_kind_is_the_dao_read(world):
    vault = world["vault"]
    own = await vault.create_secret(
        project_id=world["sales"],
        create_secret_dto=CreateSecretDTO.model_validate(
            org_secret_payload(slug="mine")
        ),
    )
    world["dao"].calls.clear()
    found = await vault.get_effective_secret_by_id(
        organization_id=world["organization_id"],
        project_id=world["sales"],
        secret_id=own.id,
        owner_kind=SecretOwnerKind.PROJECT,
    )
    assert found.id == own.id
    assert world["dao"].calls == ["get_by_id"]


async def test_get_effective_by_id_organization_kind_only_answers_available_inherited_ids(
    world,
):
    vault = world["vault"]
    limited = await _org_key(
        world,
        slug="limited",
        availability=SecretAvailability.SELECTED_PROJECTS,
        projects=[world["sales"]],
    )
    own = await vault.create_secret(
        project_id=world["sales"],
        create_secret_dto=CreateSecretDTO.model_validate(
            org_secret_payload(slug="mine")
        ),
    )

    async def by_id(project_id, secret_id, organization_id=None):
        return await vault.get_effective_secret_by_id(
            organization_id=organization_id or world["organization_id"],
            project_id=project_id,
            secret_id=secret_id,
            owner_kind=SecretOwnerKind.ORGANIZATION,
        )

    assert (await by_id(world["sales"], limited.id)).id == limited.id
    assert await by_id(world["marketing"], limited.id) is None
    # A project row never answers an organization reference.
    assert await by_id(world["sales"], own.id) is None
    # Another organization's request gets nothing.
    assert await by_id(world["sales"], limited.id, organization_id=uuid4()) is None
