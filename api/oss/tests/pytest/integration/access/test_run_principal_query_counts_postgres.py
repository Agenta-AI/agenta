"""Access-decision statement counts (M2 latency gate).

"Zero" means zero access-decision statements: statements sent while
`AccessService.decide` or `check_eligibility` runs, counted by phase
(`count_statements_by_phase`). The real `PrincipalsDAO` and `MembershipsDAO` read
Postgres; the cache is the fake one with the real serializer. OSS runs with
`AlwaysEnforcedRbac`; under `AGENTA_LICENSE=ee` the EE cases run with the real
`EntitlementsRbacEnforcement`, whose subscription read goes through the same cache.
"""

from uuid import uuid4

import pytest

import oss.src.core.memberships.service as memberships_module
import oss.src.dbs.postgres.access.dao as principals_module
from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.rbac import AlwaysEnforcedRbac
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.dbs.postgres.access.dao import PrincipalsDAO
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.tests.pytest.utils.cache import FakeCache
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    seed_organization,
)
from oss.tests.pytest.utils.statements import (
    count_statements_by_phase,
    patch_access_phase,
)


pytestmark = pytest.mark.integration

EDITIONS = ["oss", "ee"] if is_ee() else ["oss"]


@pytest.fixture
def fake_cache(monkeypatch):
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    modules = [memberships_module, principals_module]
    if is_ee():
        import ee.src.core.access.entitlements.service as entitlements_module

        modules.append(entitlements_module)
    patch_access_phase(monkeypatch)
    return FakeCache().install(monkeypatch, *modules)


@pytest.fixture
async def seeded():
    organization = await seed_organization(
        members={"editor": "editor", "viewer": "viewer"}
    )
    if is_ee():
        await execute(
            "INSERT INTO subscriptions (organization_id, plan, active) "
            "VALUES (:o, 'cloud_v0_business', true)",
            {"o": organization.organization_id},
        )
    yield organization
    await execute(
        "DELETE FROM api_keys WHERE project_id = ANY(CAST(:p AS uuid[]))",
        {"p": organization.project_ids},
    )
    if is_ee():
        await execute(
            "DELETE FROM subscriptions WHERE organization_id = :o",
            {"o": organization.organization_id},
        )
    await delete_seeded_organization(organization)


def _service(edition: str) -> AccessService:
    if edition == "ee":
        from ee.src.core.access.rbac import EntitlementsRbacEnforcement

        rbac = EntitlementsRbacEnforcement()
        policy = MembershipPolicy.PROJECT_ROWS
    else:
        rbac = AlwaysEnforcedRbac()
        policy = MembershipPolicy.ORGANIZATION_WIDE
    engine = get_transactions_engine()
    return AccessService(
        memberships=MembershipsService(
            memberships_dao=MembershipsDAO(engine=engine), policy=policy
        ),
        rbac=rbac,
        principals=PrincipalsDAO(engine=engine),
    )


def _human(user_id) -> PrincipalRef:
    return PrincipalRef(kind=PrincipalKind.HUMAN, id=user_id)


async def _decide(service, principal, project_id, action=Permission.EDIT_WORKFLOWS):
    return await service.decide(
        authority=None, principal=principal, action=action, project_id=project_id
    )


@pytest.mark.parametrize("edition", EDITIONS)
async def test_warm_allow_runs_no_access_statement(edition, seeded, fake_cache):
    service = _service(edition)
    editor = _human(seeded.user_ids["editor"])
    project_id = seeded.project_ids[0]

    assert (await _decide(service, editor, project_id)).allowed
    with count_statements_by_phase(get_transactions_engine()) as s:
        assert (await _decide(service, editor, project_id)).allowed
    assert s["access"] == []


@pytest.mark.parametrize("edition", EDITIONS)
async def test_warm_denial_runs_no_access_statement(edition, seeded, fake_cache):
    service = _service(edition)
    viewer = _human(seeded.user_ids["viewer"])
    outsider = _human(uuid4())
    project_id = seeded.project_ids[0]

    for principal in (viewer, outsider):
        first = await _decide(service, principal, project_id)
        assert not first.allowed
        with count_statements_by_phase(get_transactions_engine()) as s:
            again = await _decide(service, principal, project_id)
        assert (again.allowed, again.reason) == (False, first.reason)
        assert s["access"] == [], principal


@pytest.mark.parametrize("edition", EDITIONS)
async def test_cold_membership_is_one_access_statement(edition, seeded, fake_cache):
    service = _service(edition)
    editor = _human(seeded.user_ids["editor"])
    project_id = seeded.project_ids[0]
    await _decide(service, editor, project_id)  # warms principal and entitlements

    for name in fake_cache.names("resolve_membership"):
        del fake_cache.store[name]
    with count_statements_by_phase(get_transactions_engine()) as s:
        assert (await _decide(service, editor, project_id)).allowed
    assert len(s["access"]) == 1


@pytest.mark.parametrize("edition", EDITIONS)
async def test_cold_principal_adds_one_access_statement(edition, seeded, fake_cache):
    service = _service(edition)
    editor = _human(seeded.user_ids["editor"])
    project_id = seeded.project_ids[0]
    await _decide(service, editor, project_id)

    for name in fake_cache.names("fetch_principal"):
        del fake_cache.store[name]
    with count_statements_by_phase(get_transactions_engine()) as s:
        assert (await _decide(service, editor, project_id)).allowed
    assert len(s["access"]) == 1

    # An API key, cold: one principal statement plus one membership statement.
    key_id = uuid4()
    await execute(
        "INSERT INTO api_keys (id, prefix, hashed_key, project_id, created_by_id, "
        "rate_limit, hidden, created_at, updated_at) "
        "VALUES (:id, :prefix, 'x', :p, :u, 0, false, now(), now())",
        {
            "id": key_id,
            "prefix": f"m2cnt{key_id.hex[:6]}",
            "p": project_id,
            "u": seeded.user_ids["viewer"],
        },
    )
    key = PrincipalRef(kind=PrincipalKind.API_KEY, id=key_id)
    with count_statements_by_phase(get_transactions_engine()) as s:
        await service.decide(
            authority=None,
            principal=key,
            action=Permission.VIEW_APPLICATIONS,
            project_id=project_id,
        )
    assert len(s["access"]) == 2
    with count_statements_by_phase(get_transactions_engine()) as s:
        await service.decide(
            authority=None,
            principal=key,
            action=Permission.VIEW_APPLICATIONS,
            project_id=project_id,
        )
    assert s["access"] == []


@pytest.mark.parametrize("edition", EDITIONS)
async def test_bearer_is_member_is_free_when_resolve_is_warm(
    edition, seeded, fake_cache
):
    service = _service(edition)
    user = seeded.user_ids["editor"]
    project_id = seeded.project_ids[0]

    with count_statements_by_phase(get_transactions_engine()) as s:
        assert await service.memberships.is_member(user_id=user, project_id=project_id)
    assert len(s["endpoint"]) == 1
    with count_statements_by_phase(get_transactions_engine()) as s:
        assert await service.memberships.is_member(user_id=user, project_id=project_id)
    assert s["endpoint"] == [] and s["access"] == []
