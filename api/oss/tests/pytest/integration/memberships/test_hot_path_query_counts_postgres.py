"""Pins the "after" column of the M1 statement-count table.

These are access-decision statements, not total endpoint statements: each hot path makes
exactly one Postgres statement, whatever the number of organizations and projects.
"""

import pytest

import oss.src.core.access.permissions.service as wrapper_module
import oss.src.core.access.service as access_module
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.rbac import AlwaysEnforcedRbac
from oss.src.core.access.service import AccessService
from oss.src.core.memberships.dtos import MembershipPolicy
from oss.src.core.memberships.service import MembershipsService
from oss.src.dbs.postgres.memberships.dao import MembershipsDAO
from oss.src.dbs.postgres.shared.engine import get_transactions_engine
from oss.src.utils.env import env
from oss.tests.pytest.utils.membership_seed import (
    delete_seeded_organization,
    execute,
    seed_organization,
)
from oss.tests.pytest.utils.statements import count_statements


pytestmark = pytest.mark.integration

POLICIES = [MembershipPolicy.ORGANIZATION_WIDE, MembershipPolicy.PROJECT_ROWS]


@pytest.fixture
async def member_of_three_organizations():
    """A user in 3 organizations with 2 projects each (6 projects)."""

    organizations = [
        await seed_organization(members={"m": "editor"}, projects_per_workspace=2)
    ]
    user = organizations[0].user_ids["m"]
    for _ in range(2):
        seeded = await seed_organization(
            members={"owner": "owner"}, projects_per_workspace=2
        )
        for statement in (
            "INSERT INTO organization_members (id, user_id, organization_id, role) "
            "VALUES (gen_random_uuid(), :u, :o, 'editor')",
            "INSERT INTO project_members (id, user_id, project_id, role) "
            "SELECT gen_random_uuid(), :u, p.id, 'editor' FROM projects p "
            "WHERE p.organization_id = :o",
        ):
            await execute(statement, {"u": user, "o": seeded.organization_id})
        organizations.append(seeded)

    yield user, organizations

    for seeded in organizations:
        await delete_seeded_organization(seeded)


def _service(policy) -> MembershipsService:
    return MembershipsService(
        memberships_dao=MembershipsDAO(engine=get_transactions_engine()),
        policy=policy,
    )


@pytest.mark.parametrize("policy", POLICIES)
async def test_project_list_is_one_statement(policy, member_of_three_organizations):
    user, organizations = member_of_three_organizations
    service = _service(policy)

    with count_statements(get_transactions_engine()) as statements:
        listings = await service.list_for_user(user_id=user)
    assert len(listings) == 6
    assert len(statements) == 1

    # Twelve projects: still one statement.
    for seeded in organizations:
        for name in ("extra-a", "extra-b"):
            await execute(
                "INSERT INTO projects (id, project_name, is_default, organization_id, "
                "workspace_id) VALUES (gen_random_uuid(), :n, false, :o, :w)",
                {
                    "n": name,
                    "o": seeded.organization_id,
                    "w": seeded.workspace_ids[0],
                },
            )
    with count_statements(get_transactions_engine()) as statements:
        await service.list_for_user(user_id=user)
    assert len(statements) == 1


@pytest.mark.parametrize("policy", POLICIES)
async def test_project_fetch_is_one_statement(policy, member_of_three_organizations):
    user, organizations = member_of_three_organizations
    service = _service(policy)

    with count_statements(get_transactions_engine()) as statements:
        listing = await service.fetch_for_user(
            user_id=user, project_id=organizations[1].project_ids[0]
        )
    assert listing is not None
    assert len(statements) == 1


@pytest.mark.parametrize("policy", POLICIES)
async def test_bearer_membership_check_is_one_statement(
    policy, member_of_three_organizations
):
    user, organizations = member_of_three_organizations
    service = _service(policy)

    with count_statements(get_transactions_engine()) as statements:
        assert await service.is_member(
            user_id=user, project_id=organizations[2].project_ids[1]
        )
    assert len(statements) == 1


@pytest.fixture
def registered_access(monkeypatch):
    def _register(policy):
        monkeypatch.setattr(
            access_module,
            "_access_service",
            AccessService(memberships=_service(policy), rbac=AlwaysEnforcedRbac()),
        )

    return _register


@pytest.mark.parametrize("policy", POLICIES)
async def test_check_action_access_miss_is_one_statement(
    policy, member_of_three_organizations, registered_access, monkeypatch
):
    user, organizations = member_of_three_organizations
    registered_access(policy)
    monkeypatch.setattr(env.agenta.api.caching, "enabled", False, raising=False)

    with count_statements(get_transactions_engine()) as statements:
        allowed = await check_action_access(
            user_uid=str(user),
            project_id=str(organizations[0].project_ids[0]),
            permission=Permission.VIEW_APPLICATIONS,
        )
    assert allowed is True
    assert len(statements) == 1


async def test_check_action_access_hit_is_zero_statements(
    member_of_three_organizations, registered_access, monkeypatch
):
    """The stack's Redis is not published to the host, so the cache is a dict with the
    same get/set contract: the second identical call must read no Postgres row."""

    user, organizations = member_of_three_organizations
    registered_access(MembershipPolicy.PROJECT_ROWS)
    store = {}

    def _key(kwargs):
        return (
            kwargs["namespace"],
            kwargs["project_id"],
            kwargs["user_id"],
            str(sorted(kwargs["key"].items())),
        )

    async def _get_cache(**kwargs):
        return store.get(_key(kwargs))

    async def _set_cache(**kwargs):
        store[_key(kwargs)] = kwargs["value"]

    monkeypatch.setattr(wrapper_module, "get_cache", _get_cache)
    monkeypatch.setattr(wrapper_module, "set_cache", _set_cache)
    arguments = dict(
        user_uid=str(user),
        project_id=str(organizations[0].project_ids[0]),
        permission=Permission.VIEW_APPLICATIONS,
    )

    assert await check_action_access(**arguments) is True
    with count_statements(get_transactions_engine()) as statements:
        assert await check_action_access(**arguments) is True
    assert statements == []
