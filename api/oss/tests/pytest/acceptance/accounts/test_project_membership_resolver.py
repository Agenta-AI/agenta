"""The membership resolver, end to end through the API."""

import pytest

from oss.tests.pytest.utils.membership_accounts import RBAC_PLAN
from oss.tests.pytest.utils.plans import project_limit
from oss.tests.pytest.utils.membership_accounts import (
    PERMISSION_DENIED,
    Team,
)


@pytest.fixture
def team(admin_api):
    team = Team(admin_api, members={"admin": "admin", "viewer": "viewer"})
    yield team
    team.delete()


def test_viewer_member_is_denied_member_removal(admin_api, team):
    resp = admin_api(
        "DELETE",
        f"/workspaces/{team.workspace_id}/users",
        params={"email": team.emails["admin"]},
        headers=team.headers("viewer"),
    )
    assert resp.status_code == 403, resp.text


def test_role_change_takes_effect_at_once(admin_api, team):
    resp = admin_api(
        "POST", "/projects/", headers=team.headers("viewer"), json={"name": "R1"}
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == PERMISSION_DENIED

    resp = admin_api(
        "POST",
        f"/workspaces/{team.workspace_id}/roles/",
        headers=team.headers("owner"),
        json={
            "email": team.emails["viewer"],
            "organization_id": team.organization_id,
            "role": "admin",
        },
    )
    assert resp.status_code == 200, resp.text

    # No cache delay: the writer cleared the cached denial. The permission check passes;
    # a stack without a license key then refuses a second project.
    resp = admin_api(
        "POST", "/projects/", headers=team.headers("viewer"), json={"name": "R2"}
    )
    if project_limit(admin_api, plan=RBAC_PLAN) == 1:
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["code"] == "project_limit_reached"
    else:
        assert resp.status_code == 201, resp.text


def test_owner_cannot_be_demoted_through_the_role_endpoint(admin_api, team):
    resp = admin_api(
        "POST",
        f"/workspaces/{team.workspace_id}/roles/",
        headers=team.headers("owner"),
        json={
            "email": team.emails["owner"],
            "organization_id": team.organization_id,
            "role": "member",
        },
    )
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"]["message"].startswith("You do not have permission")
