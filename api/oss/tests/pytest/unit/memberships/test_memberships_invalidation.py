from uuid import uuid4

import pytest

import oss.src.core.memberships.service as service_module
from oss.src.core.memberships.dtos import MembershipPolicy, MembershipWriteResult
from oss.src.core.memberships.service import MembershipsService
from oss.src.utils.env import env
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, make_summary


NAMESPACES = ("verify_bearer_token", "resolve_membership")


class _Calls(list):
    """Every cleared (namespace, project, user), plus the user-scoped calls."""

    def __init__(self):
        super().__init__()
        self.user_calls: list = []


@pytest.fixture
def recorded(monkeypatch):
    calls = _Calls()

    async def _invalidate_cache(**kwargs):
        calls.append(kwargs)
        return True

    async def _invalidate_user_cache(
        *, user_id, project_ids, namespaces, projectless_namespaces=()
    ):
        # One call clears what these per-pair calls would clear.
        user_calls.append(user_id)
        for p in project_ids:
            for namespace in namespaces:
                calls.append(
                    {"namespace": namespace, "project_id": p, "user_id": user_id}
                )
        for namespace in projectless_namespaces:
            calls.append(
                {"namespace": namespace, "project_id": None, "user_id": user_id}
            )
        return True

    user_calls = calls.user_calls
    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    monkeypatch.setattr(service_module, "invalidate_cache", _invalidate_cache)
    monkeypatch.setattr(service_module, "invalidate_user_cache", _invalidate_user_cache)
    return calls


def _organization(dao, projects=3):
    organization = uuid4()
    summaries = [
        dao.add_project(make_summary(organization_id=organization))
        for _ in range(projects)
    ]
    return organization, [s.project_id for s in summaries]


def _expected_for(user, project_ids):
    expected = []
    for p in project_ids:
        for namespace in NAMESPACES:
            expected.append(
                {"namespace": namespace, "project_id": str(p), "user_id": str(user)}
            )
    expected.append(
        {"namespace": "verify_bearer_token", "project_id": None, "user_id": str(user)}
    )
    return expected


def _normalized(calls):
    triples = [(c["namespace"], c.get("project_id"), c.get("user_id")) for c in calls]
    return sorted(triples, key=lambda t: tuple("" if v is None else v for v in t))


@pytest.mark.parametrize(
    "writer",
    ["set_member_role", "remove_member", "create_project", "transfer_ownership"],
)
async def test_each_writer_invalidates_every_namespace_for_every_project(
    writer, recorded
):
    dao = InMemoryMembershipsDAO()
    organization, project_ids = _organization(dao)
    service = MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.ORGANIZATION_WIDE
    )
    user, other = uuid4(), uuid4()

    if writer == "set_member_role":
        await service.set_member_role(
            organization_id=organization, user_id=user, role="editor"
        )
        expected = _expected_for(user, project_ids)
    elif writer == "remove_member":
        dao.write_results["remove_member"] = MembershipWriteResult(user_id=user)
        await service.remove_member(
            organization_id=organization, email="x@test.agenta.ai"
        )
        expected = _expected_for(user, project_ids)
    elif writer == "transfer_ownership":
        await service.transfer_ownership(
            organization_id=organization, new_owner_id=other, current_owner_id=user
        )
        expected = _expected_for(user, project_ids) + _expected_for(other, project_ids)
    else:
        scope = await service.create_project(
            organization_id=organization,
            workspace_id=uuid4(),
            name="New",
            is_default=False,
        )
        expected = [
            {
                "namespace": namespace,
                "project_id": str(scope.project_id),
                "user_id": None,
            }
            for namespace in NAMESPACES
        ]

    assert _normalized(recorded) == _normalized(expected)


async def test_invalidation_failure_does_not_fail_the_writer(monkeypatch):
    warnings = []

    async def _failing(**kwargs):
        return None

    class _Log:
        def warning(self, event, **fields):
            warnings.append((event, fields))

        def info(self, *args, **kwargs):
            pass

    monkeypatch.setattr(env.agenta.api.caching, "enabled", True, raising=False)
    monkeypatch.setattr(service_module, "invalidate_cache", _failing)
    monkeypatch.setattr(service_module, "invalidate_user_cache", _failing)
    monkeypatch.setattr(service_module, "log", _Log())

    dao = InMemoryMembershipsDAO()
    organization, _ = _organization(dao, projects=1)
    service = MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.ORGANIZATION_WIDE
    )

    await service.set_member_role(
        organization_id=organization, user_id=uuid4(), role="viewer"
    )

    assert warnings
    assert all(
        event == "[memberships] cache invalidation failed" for event, _ in warnings
    )


async def test_a_failed_project_lookup_after_the_commit_does_not_fail_the_writer(
    monkeypatch, recorded
):
    warnings = []

    class _Log:
        def warning(self, event, **fields):
            warnings.append(event)

        def info(self, *args, **kwargs):
            pass

    monkeypatch.setattr(service_module, "log", _Log())
    dao = InMemoryMembershipsDAO()

    async def _broken_list_projects(**kwargs):
        raise RuntimeError("database gone")

    monkeypatch.setattr(dao, "list_projects", _broken_list_projects)
    service = MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.ORGANIZATION_WIDE
    )

    await service.set_member_role(
        organization_id=uuid4(), user_id=uuid4(), role="viewer"
    )

    assert warnings == ["[memberships] cache invalidation failed"]
    assert dao.writes[0][0] == "set_member_role"


async def test_set_member_role_skipped_by_must_be_absent_invalidates_nothing(recorded):
    dao = InMemoryMembershipsDAO()
    organization, _ = _organization(dao)
    service = MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.ORGANIZATION_WIDE
    )
    # The DAO found an existing member under the lock and wrote nothing.
    dao.write_results["set_member_role"] = MembershipWriteResult(
        user_id=None, previous_role="editor"
    )

    joined = await service.set_member_role(
        organization_id=organization,
        user_id=uuid4(),
        role="viewer",
        join_all_projects=True,
        must_be_absent=True,
    )

    assert joined is False
    assert recorded == []


async def test_a_role_change_in_a_large_organization_scans_once_per_user(recorded):
    dao = InMemoryMembershipsDAO()
    organization, project_ids = _organization(dao, projects=72)
    service = MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.ORGANIZATION_WIDE
    )
    user = uuid4()

    await service.set_member_role(
        organization_id=organization, user_id=user, role="editor"
    )

    # One user-scoped call, not 72 x 3 + 1 pattern scans; it covers every pair.
    assert recorded.user_calls == [str(user)]
    assert _normalized(recorded) == _normalized(_expected_for(user, project_ids))


def test_invalidate_access_caches_has_no_check_action_access_line():
    from oss.src.core.memberships.service import ACCESS_CACHE_NAMESPACES

    assert "check_action_access" not in ACCESS_CACHE_NAMESPACES
    assert "resolve_membership" in ACCESS_CACHE_NAMESPACES
