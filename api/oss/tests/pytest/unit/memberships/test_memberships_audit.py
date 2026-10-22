from uuid import uuid4

import pytest

import oss.src.core.memberships.service as service_module
from oss.src.core.memberships.dtos import MembershipPolicy, MembershipWriteResult
from oss.src.core.memberships.service import MembershipsService
from oss.tests.pytest.utils.memberships import InMemoryMembershipsDAO, make_summary


@pytest.fixture
def events(monkeypatch):
    recorded = []

    class _Log:
        def info(self, event, **fields):
            recorded.append((event, fields))

        def warning(self, event, **fields):
            recorded.append((event, fields))

    monkeypatch.setattr(service_module, "log", _Log())
    return recorded


def _no_email(fields):
    return all("@" not in str(value) for value in fields.values())


async def test_role_change_is_logged_with_ids_and_no_email(events):
    dao = InMemoryMembershipsDAO()
    organization = uuid4()
    dao.add_project(make_summary(organization_id=organization))
    dao.write_results["set_member_role"] = MembershipWriteResult(
        previous_role="viewer", inserted_count=2
    )
    user, actor = uuid4(), uuid4()

    await MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.PROJECT_ROWS
    ).set_member_role(
        organization_id=organization, user_id=user, role="editor", actor_user_id=actor
    )

    role_events = [f for e, f in events if e == "[memberships] role set"]
    assert role_events == [
        {
            "organization_id": str(organization),
            "user_id": str(user),
            "actor_user_id": str(actor),
            "role": "editor",
            "previous_role": "viewer",
            "joined_project_count": 2,
        }
    ]
    assert _no_email(role_events[0])


async def test_remove_member_log_has_no_email(events):
    dao = InMemoryMembershipsDAO()
    organization = uuid4()
    dao.write_results["remove_member"] = MembershipWriteResult(
        user_id=uuid4(), deleted_invitation_count=1
    )

    await MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.PROJECT_ROWS
    ).remove_member(organization_id=organization, email="x@test.agenta.ai")

    removed = [f for e, f in events if e == "[memberships] member removed"]
    assert len(removed) == 1
    assert removed[0]["invitation_count"] == 1
    assert _no_email(removed[0])


async def test_project_create_is_logged_with_ids_and_no_email(events):
    dao = InMemoryMembershipsDAO()
    organization, workspace, actor = uuid4(), uuid4(), uuid4()

    scope = await MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.PROJECT_ROWS
    ).create_project(
        organization_id=organization,
        workspace_id=workspace,
        name="New",
        is_default=False,
        actor_user_id=actor,
    )

    created = [f for e, f in events if e == "[memberships] project created"]
    assert created == [
        {
            "organization_id": str(organization),
            "workspace_id": str(workspace),
            "project_id": str(scope.project_id),
            "actor_user_id": str(actor),
            "seeded_count": 0,
        }
    ]
    assert _no_email(created[0])


async def test_ownership_transfer_is_logged_with_ids_and_no_email(events):
    dao = InMemoryMembershipsDAO()
    organization = uuid4()
    dao.add_project(make_summary(organization_id=organization))
    dao.write_results["transfer_ownership"] = MembershipWriteResult(inserted_count=1)
    current, new = uuid4(), uuid4()

    await MembershipsService(
        memberships_dao=dao, policy=MembershipPolicy.PROJECT_ROWS
    ).transfer_ownership(
        organization_id=organization, new_owner_id=new, current_owner_id=current
    )

    transferred = [f for e, f in events if e == "[memberships] ownership transferred"]
    assert transferred == [
        {
            "organization_id": str(organization),
            "previous_owner_id": str(current),
            "new_owner_id": str(new),
            "seeded_count": 1,
        }
    ]
    assert _no_email(transferred[0])
